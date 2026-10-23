use std::time::{Duration, Instant};
use tokio::sync::{mpsc, watch};
use crate::core::clock::{ClockAdvanceResult, VirtualClock};
use crate::core::matching::CoreMatchingEngine;
use crate::core::render_pipe::RenderPipeHandle;
use crate::core::sink_tickscope::TickScopeBridge;
use crate::core::store::TickStore;
use crate::core::types::{CoreCommand, CoreStatusSnapshot};

pub struct SchedulerConfig {
    pub timer_interval_ms: u64,
    pub ui_emit_interval_ms: u64,
}

impl Default for SchedulerConfig {
    fn default() -> Self {
        Self {
            timer_interval_ms: 2, // 2ms 周期の高精度自律評価
            ui_emit_interval_ms: 16, // 約 60Hz での間引き配信
        }
    }
}

/// Core スケジューラー本体
pub struct CoreScheduler {
    clock: VirtualClock,
    store: TickStore,
    matching: CoreMatchingEngine,
    config: SchedulerConfig,

    current_index: usize,
    last_published_history_rev: u64,
    last_published_trade_rev: u64,
    cached_latest_audits: std::sync::Arc<Vec<crate::core::journal::ExecutionAuditRecord>>,
    cmd_rx: mpsc::UnboundedReceiver<CoreCommand>,
    status_tx: watch::Sender<CoreStatusSnapshot>,

    render_pipe: Option<RenderPipeHandle>,
    tickscope_bridge: Option<TickScopeBridge>,
}

impl CoreScheduler {
    pub fn new(
        store: TickStore,
        cmd_rx: mpsc::UnboundedReceiver<CoreCommand>,
        status_tx: watch::Sender<CoreStatusSnapshot>,
        config: SchedulerConfig,
    ) -> Self {
        let min_msc = store.min_time_msc().unwrap_or(0);
        let max_msc = store.max_time_msc().unwrap_or(0);
        let clock = VirtualClock::new(min_msc, min_msc, max_msc);

        Self {
            clock,
            store,
            matching: CoreMatchingEngine::default(),
            config,
            current_index: 0,
            last_published_history_rev: 0,
            last_published_trade_rev: 0,
            cached_latest_audits: std::sync::Arc::new(Vec::new()),
            cmd_rx,
            status_tx,
            render_pipe: None,
            tickscope_bridge: None,
        }
    }

    pub fn with_render_pipe(mut self, pipe: RenderPipeHandle) -> Self {
        self.render_pipe = Some(pipe);
        self
    }

    pub fn with_tickscope_bridge(mut self, bridge: TickScopeBridge) -> Self {
        self.tickscope_bridge = Some(bridge);
        self
    }

    /// メイン実行ループ (専用スレッドで起動)
    pub async fn run(mut self) {
        let mut last_ui_emit = Instant::now();
        let loop_interval = Duration::from_millis(self.config.timer_interval_ms);
        let ui_interval = Duration::from_millis(self.config.ui_emit_interval_ms);

        let mut interval_timer = tokio::time::interval(loop_interval);
        interval_timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            // 一時停止中はイベント駆動で待機し、CPU負荷を0%に抑制
            if !self.clock.is_playing() {
                match self.cmd_rx.recv().await {
                    Some(cmd) => {
                        if !self.handle_command(cmd) {
                            break; // Shutdown
                        }
                        while let Ok(next_cmd) = self.cmd_rx.try_recv() {
                            if !self.handle_command(next_cmd) {
                                return;
                            }
                        }
                        self.publish_status();
                    }
                    None => break, // チャネル切断
                }
                last_ui_emit = Instant::now();
                continue;
            }

            // 再生中は高頻度タイマーで進行
            tokio::select! {
                _ = interval_timer.tick() => {
                    self.tick_advance();
                    // UI スナップショットの間引き送信 (終端到達による自動停止時も即時送信)
                    let now = Instant::now();
                    if !self.clock.is_playing() || now.duration_since(last_ui_emit) >= ui_interval {
                        self.publish_status();
                        last_ui_emit = now;
                    }
                }
                cmd_opt = self.cmd_rx.recv() => {
                    match cmd_opt {
                        Some(cmd) => {
                            if !self.handle_command(cmd) {
                                break;
                            }
                            while let Ok(next_cmd) = self.cmd_rx.try_recv() {
                                if !self.handle_command(next_cmd) {
                                    return;
                                }
                            }
                            // コマンド処理後は即座にステータスを配信 (Pause 遷移時等の取りこぼしを完全防止)
                            self.publish_status();
                            last_ui_emit = Instant::now();
                        }
                        None => break,
                    }
                }
            }
        }
    }

    /// タイマー進行時の処理
    fn tick_advance(&mut self) {
        let now = Instant::now();
        let res = self.clock.advance_realtime(now);

        match res {
            ClockAdvanceResult::Advanced { from_msc, to_msc } => {
                let range = if self.current_index < self.store.len() {
                    self.store.advance_from_cursor(self.current_index, to_msc)
                } else {
                    self.store.range_for_time_interval(from_msc, to_msc)
                };

                if let Some((start_idx, end_idx)) = range {
                    self.current_index = end_idx;
                    let slice = self.store.slice(start_idx, end_idx);
                    self.matching.on_tick_batch(slice, to_msc);

                    // 1. MT5 Renderer EA への ADVANCE 送信
                    if let Some(ref pipe) = self.render_pipe {
                        pipe.send_advance(
                            self.clock.seek_epoch() as u32,
                            self.current_index as u64,
                            0,
                            to_msc,
                        );
                    }

                    // 2. TickScope への TICK_BATCH ストリーミング送信
                    if let Some(ref mut bridge) = self.tickscope_bridge {
                        let _ = bridge.send_tick_batch(slice);
                    }
                } else {
                    if self.matching.has_pending_triggers() {
                        // ティック区間がない静寂時間帯でも、遅延保留注文・決済を execute_after_msc に正確に評価・約定
                        if let Some(tick) = self.store.get(self.current_index) {
                            self.matching.on_tick_advance(tick, to_msc);
                        }
                    }

                    // 仮想時間が進行している場合、ストアに新規ティックがない静寂時間帯でも MT5 Renderer EA へ ADVANCE を送信
                    // (MT5側カスタムシンボルの独自ティック描画および時間同期をリアルタイムに維持)
                    if let Some(ref pipe) = self.render_pipe {
                        pipe.send_advance(
                            self.clock.seek_epoch() as u32,
                            self.current_index as u64,
                            0,
                            to_msc,
                        );
                    }
                }
            }
            ClockAdvanceResult::LoopWrapped { from_msc: _, to_msc, epoch: _ } => {
                // A-B ループによる巻き戻し
                if let Some(idx) = self.store.find_index_at_or_before(to_msc) {
                    self.current_index = idx;
                }
                let cur_tick = self.store.get(self.current_index);
                self.matching.rewind_to(to_msc, cur_tick);

                if let Some(ref pipe) = self.render_pipe {
                    pipe.send_reset(
                        self.clock.seek_epoch() as u32,
                        self.current_index as u64,
                        0,
                        to_msc,
                    );
                }
            }
            ClockAdvanceResult::WeekendSkipped { from_msc: _, to_msc } => {
                // 週末スキップ
                if let Some(idx) = self.store.find_index_at_or_before(to_msc) {
                    self.current_index = idx;
                }
                if let Some(tick) = self.store.get(self.current_index) {
                    self.matching.on_tick_advance(tick, to_msc);
                }
                if let Some(ref pipe) = self.render_pipe {
                    pipe.send_advance(
                        self.clock.seek_epoch() as u32,
                        self.current_index as u64,
                        0,
                        to_msc,
                    );
                }
            }
            ClockAdvanceResult::Unchanged { .. } => {}
        }
    }

    /// コマンドディスパッチ
    fn handle_command(&mut self, cmd: CoreCommand) -> bool {
        match cmd {
            CoreCommand::Play => {
                self.clock.play();
            }
            CoreCommand::Pause => {
                self.clock.pause();
                let cur_msc = self.clock.virtual_time_msc();
                if let Some(ref pipe) = self.render_pipe {
                    pipe.send_advance(
                        self.clock.seek_epoch() as u32,
                        self.current_index as u64,
                        0,
                        cur_msc,
                    );
                }
            }
            CoreCommand::TogglePlay => {
                self.clock.toggle_play();
                if !self.clock.is_playing() {
                    let cur_msc = self.clock.virtual_time_msc();
                    if let Some(ref pipe) = self.render_pipe {
                        pipe.send_advance(
                            self.clock.seek_epoch() as u32,
                            self.current_index as u64,
                            0,
                            cur_msc,
                        );
                    }
                }
            }
            CoreCommand::SetMultiplier(mult) => {
                self.clock.set_multiplier(mult);
            }
            CoreCommand::SetPlaybackMode(mode) => {
                self.clock.set_playback_mode(mode);
            }
            CoreCommand::SetTicksPerSecond(tps) => {
                self.clock.set_ticks_per_second(tps);
            }
            CoreCommand::SeekTime(target_msc) => {
                self.clock.seek(target_msc);
                if let Some(idx) = self.store.find_index_at_or_before(target_msc) {
                    self.current_index = idx;
                }
                let cur_tick = self.store.get(self.current_index);
                self.matching.rewind_to(target_msc, cur_tick);

                if let Some(ref pipe) = self.render_pipe {
                    pipe.send_reset(
                        self.clock.seek_epoch() as u32,
                        self.current_index as u64,
                        0,
                        target_msc,
                    );
                }
            }
            CoreCommand::SeekIndex(target_idx) => {
                let idx = target_idx as usize;
                if let Some(tick) = self.store.get(idx) {
                    let tick_msc = tick.time_msc;
                    self.current_index = idx;
                    self.clock.seek(tick_msc);
                    self.matching.rewind_to(tick_msc, Some(tick));

                    if let Some(ref pipe) = self.render_pipe {
                        pipe.send_reset(
                            self.clock.seek_epoch() as u32,
                            self.current_index as u64,
                            0,
                            tick_msc,
                        );
                    }
                }
            }
            CoreCommand::StepTicks(delta_ticks) => {
                let new_idx = (self.current_index as i64 + delta_ticks).max(0) as usize;
                let clamped_idx = new_idx.min(self.store.len().saturating_sub(1));
                if let Some(tick) = self.store.get(clamped_idx) {
                    let tick_msc = tick.time_msc;
                    self.current_index = clamped_idx;
                    self.clock.seek(tick_msc);
                    if delta_ticks < 0 {
                        self.matching.rewind_to(tick_msc, Some(tick));
                        if let Some(ref pipe) = self.render_pipe {
                            pipe.send_reset(
                                self.clock.seek_epoch() as u32,
                                self.current_index as u64,
                                0,
                                tick_msc,
                            );
                        }
                    } else {
                        self.matching.on_tick_advance(tick, tick_msc);
                        if let Some(ref pipe) = self.render_pipe {
                            pipe.send_advance(
                                self.clock.seek_epoch() as u32,
                                self.current_index as u64,
                                0,
                                tick_msc,
                            );
                        }
                    }
                }
            }
            CoreCommand::StepTime(delta_msc) => {
                let (target_msc, _) = self.clock.step_time(delta_msc);
                if let Some(idx) = self.store.find_index_at_or_before(target_msc) {
                    self.current_index = idx;
                }
                let cur_tick = self.store.get(self.current_index);
                if delta_msc < 0 {
                    self.matching.rewind_to(target_msc, cur_tick);
                } else if let Some(tick) = cur_tick {
                    self.matching.on_tick_advance(tick, target_msc);
                }
                if let Some(ref pipe) = self.render_pipe {
                    pipe.send_reset(
                        self.clock.seek_epoch() as u32,
                        self.current_index as u64,
                        0,
                        target_msc,
                    );
                }
            }
            CoreCommand::SetAbLoop(cfg) => {
                self.clock.set_ab_loop(cfg);
            }
            CoreCommand::SetWeekendSkip(enabled) => {
                self.clock.set_weekend_skip(enabled);
            }
            CoreCommand::SetLatencyModel(model) => {
                self.matching.set_latency_model(model);
            }
            CoreCommand::SetSlippageModel(model) => {
                self.matching.set_slippage_model(model);
            }
            CoreCommand::SubmitOrder { symbol, side, volume, sl_points, tp_points, comment } => {
                let cur_tick = self.store.get(self.current_index);
                self.matching.submit_order(
                    symbol,
                    side,
                    volume,
                    sl_points,
                    tp_points,
                    comment,
                    self.clock.virtual_time_msc(),
                    self.clock.is_playing(),
                    cur_tick,
                );
            }
            CoreCommand::ClosePosition { ticket, volume, reason } => {
                let cur_tick = self.store.get(self.current_index);
                self.matching.close_position(
                    ticket,
                    volume,
                    reason.unwrap_or_else(|| "MANUAL".to_string()),
                    self.clock.virtual_time_msc(),
                    self.clock.is_playing(),
                    cur_tick,
                );
            }
            CoreCommand::CloseAllPositions { reason } => {
                let cur_tick = self.store.get(self.current_index);
                self.matching.close_all_positions(
                    reason.unwrap_or_else(|| "CLOSE_ALL".to_string()),
                    self.clock.virtual_time_msc(),
                    self.clock.is_playing(),
                    cur_tick,
                );
            }
            CoreCommand::CloseBuyPositions { reason } => {
                let cur_tick = self.store.get(self.current_index);
                self.matching.close_buy_positions(
                    reason.unwrap_or_else(|| "MANUAL".to_string()),
                    self.clock.virtual_time_msc(),
                    self.clock.is_playing(),
                    cur_tick,
                );
            }
            CoreCommand::CloseSellPositions { reason } => {
                let cur_tick = self.store.get(self.current_index);
                self.matching.close_sell_positions(
                    reason.unwrap_or_else(|| "MANUAL".to_string()),
                    self.clock.virtual_time_msc(),
                    self.clock.is_playing(),
                    cur_tick,
                );
            }
            CoreCommand::ModifyPosition { ticket, sl, tp } => {
                if let Some(pos) = self.matching.positions.iter_mut().find(|p| p.ticket == ticket) {
                    if sl.is_some() { pos.sl = sl; }
                    if tp.is_some() { pos.tp = tp; }
                }
            }
            CoreCommand::SetTimeStop { enabled, seconds, mode } => {
                self.matching.set_time_stop(enabled, seconds, mode);
            }
            CoreCommand::SetHedging(hedging) => {
                self.matching.set_hedging(hedging);
            }
            CoreCommand::SetContractSize(size) => {
                self.matching.set_contract_size(size);
            }
            CoreCommand::SetLeverage(leverage) => {
                self.matching.set_leverage(leverage);
            }
            CoreCommand::ResetTradingAccount => {
                self.matching.reset(1_000_000.0, self.clock.virtual_time_msc());
            }
            CoreCommand::ResetAccount { initial_balance } => {
                self.matching.reset(initial_balance, self.clock.virtual_time_msc());
            }
            CoreCommand::AccountTransaction { is_deposit, amount, comment } => {
                self.matching.account_transaction(is_deposit, amount, comment, self.clock.virtual_time_msc());
            }
            CoreCommand::RestoreAccount { account, next_ticket } => {
                self.matching.restore_account(account, next_ticket);
            }
            CoreCommand::RestorePosition(pos) => {
                self.matching.restore_position(pos);
            }
            CoreCommand::RestoreHistory(hist) => {
                self.matching.restore_history(hist);
            }
            CoreCommand::Shutdown => {
                return false;
            }
        }
        true
    }

    /// スナップショット生成 & watch 送信
    fn publish_status(&mut self) {
        let trade_rev = self.matching.revision();
        if trade_rev != self.last_published_trade_rev {
            self.last_published_trade_rev = trade_rev;
            let audit_len = self.matching.audit_log.len();
            let slice = if audit_len == 0 {
                Vec::new()
            } else {
                let audit_start = audit_len.saturating_sub(50);
                self.matching.audit_log[audit_start..].to_vec()
            };
            self.cached_latest_audits = std::sync::Arc::new(slice);
        }
        let latest_audits = std::sync::Arc::clone(&self.cached_latest_audits);

        let hist_rev = self.matching.history_revision;
        let history = if hist_rev != self.last_published_history_rev {
            self.last_published_history_rev = hist_rev;
            Some(self.matching.history.clone())
        } else {
            None
        };

        let snapshot = CoreStatusSnapshot {
            virtual_time_msc: self.clock.virtual_time_msc(),
            is_playing: self.clock.is_playing(),
            state: self.clock.state(),
            multiplier: self.clock.multiplier(),
            speed_mode: self.clock.mode(),
            current_index: self.current_index as u64,
            total_ticks: self.store.len() as u64,
            seek_epoch: self.clock.seek_epoch(),
            trade_revision: self.matching.revision(),
            history_revision: hist_rev,
            current_tick: self.store.get(self.current_index).copied(),
            loop_config: self.clock.ab_loop(),
            account: self.matching.account.clone(),
            positions: self.matching.positions.clone(),
            history,
            latest_audits,
            time_stop_seconds: self.matching.time_stop_seconds,
            time_stop_enabled: self.matching.time_stop_enabled,
        };
        let _ = self.status_tx.send(snapshot);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::mod_test_helper::create_test_core;
    use crate::core::types::OrderSide;

    #[tokio::test]
    async fn test_scheduler_lifecycle() {
        let (handle, join_handle) = create_test_core();

        // 1. 初期状態
        let status = handle.status();
        assert_eq!(status.is_playing, false);
        assert_eq!(status.current_index, 0);

        // 2. シーク
        handle.seek_time(2000);
        // 少し待機してステータス更新を受ける
        tokio::time::sleep(Duration::from_millis(20)).await;
        let status = handle.status();
        assert_eq!(status.virtual_time_msc, 2000);
        assert_eq!(status.seek_epoch, 2);

        let status_before_order = handle.status();
        let rev_before = status_before_order.trade_revision;

        // 3. 発注
        handle.submit_order(
            "USDJPY".to_string(),
            OrderSide::Buy,
            1.0,
            0.0,
            0.0,
            Some("test".to_string()),
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
        let status_after_order = handle.status();
        assert!(status_after_order.trade_revision > rev_before);
        assert_eq!(status_after_order.is_playing, false);

        // 4. シャットダウン
        handle.shutdown();
        let _ = join_handle.await;
    }

    #[tokio::test]
    async fn test_play_pause_publishes_status_immediately() {
        let (handle, join_handle) = create_test_core();

        handle.play();
        tokio::time::sleep(Duration::from_millis(5)).await;
        assert!(handle.status().is_playing, "Play must immediately publish is_playing=true");

        // 16ms の UI 配信間隔を待たずに即座に Pause を送信しても確実に is_playing=false が配信されること
        handle.pause();
        tokio::time::sleep(Duration::from_millis(5)).await;
        assert!(!handle.status().is_playing, "Pause must immediately publish is_playing=false");

        handle.shutdown();
        let _ = join_handle.await;
    }
}

