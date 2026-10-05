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
            // 一時停止中はコマンド待ちを優先してアイドル負荷を抑制
            if !self.clock.is_playing() {
                tokio::select! {
                    cmd_opt = self.cmd_rx.recv() => {
                        match cmd_opt {
                            Some(cmd) => {
                                if !self.handle_command(cmd) {
                                    break; // Shutdown
                                }
                            }
                            None => break, // チャネル切断
                        }
                    }
                    _ = tokio::time::sleep(Duration::from_millis(50)) => {
                        // 一時停止中の低頻度ポーリング (CPU負荷 < 1%)
                    }
                }
            } else {
                // 再生中は高頻度タイマーで進行
                tokio::select! {
                    _ = interval_timer.tick() => {
                        self.tick_advance();
                    }
                    cmd_opt = self.cmd_rx.recv() => {
                        match cmd_opt {
                            Some(cmd) => {
                                if !self.handle_command(cmd) {
                                    break;
                                }
                            }
                            None => break,
                        }
                    }
                }
            }

            // UI スナップショットの間引き送信
            let now = Instant::now();
            if now.duration_since(last_ui_emit) >= ui_interval {
                self.publish_status();
                last_ui_emit = now;
            }
        }
    }

    /// タイマー進行時の処理
    fn tick_advance(&mut self) {
        let now = Instant::now();
        let res = self.clock.advance_realtime(now);

        match res {
            ClockAdvanceResult::Advanced { from_msc, to_msc } => {
                if let Some((start_idx, end_idx)) = self.store.range_for_time_interval(from_msc, to_msc) {
                    self.current_index = end_idx;
                    if let Some(tick) = self.store.get(end_idx) {
                        self.matching.on_tick_advance(tick, to_msc);
                    }

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
                        let slice = self.store.slice(start_idx, end_idx);
                        let _ = bridge.send_tick_batch(slice);
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
                    let preload_from = self.current_index.saturating_sub(300) as u64;
                    pipe.send_reset(
                        self.clock.seek_epoch() as u32,
                        self.current_index as u64,
                        preload_from,
                        0,
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
            }
            CoreCommand::TogglePlay => {
                self.clock.toggle_play();
            }
            CoreCommand::SetMultiplier(mult) => {
                self.clock.set_multiplier(mult);
            }
            CoreCommand::SetPlaybackMode(mode) => {
                self.clock.set_playback_mode(mode);
            }
            CoreCommand::SeekTime(target_msc) => {
                self.clock.seek(target_msc);
                if let Some(idx) = self.store.find_index_at_or_before(target_msc) {
                    self.current_index = idx;
                }
                let cur_tick = self.store.get(self.current_index);
                self.matching.rewind_to(target_msc, cur_tick);

                if let Some(ref pipe) = self.render_pipe {
                    let preload_from = self.current_index.saturating_sub(300) as u64;
                    pipe.send_reset(
                        self.clock.seek_epoch() as u32,
                        self.current_index as u64,
                        preload_from,
                        0,
                        0,
                        target_msc,
                    );
                }

                self.publish_status();
            }
            CoreCommand::SeekIndex(target_idx) => {
                let idx = target_idx as usize;
                if let Some(tick) = self.store.get(idx) {
                    let tick_msc = tick.time_msc;
                    self.current_index = idx;
                    self.clock.seek(tick_msc);
                    self.matching.rewind_to(tick_msc, Some(tick));

                    if let Some(ref pipe) = self.render_pipe {
                        let preload_from = self.current_index.saturating_sub(300) as u64;
                        pipe.send_reset(
                            self.clock.seek_epoch() as u32,
                            self.current_index as u64,
                            preload_from,
                            0,
                            0,
                            tick_msc,
                        );
                    }

                    self.publish_status();
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
                            let preload_from = self.current_index.saturating_sub(300) as u64;
                            pipe.send_reset(
                                self.clock.seek_epoch() as u32,
                                self.current_index as u64,
                                preload_from,
                                0,
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
                    self.publish_status();
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
                    if let Some(ref pipe) = self.render_pipe {
                        let preload_from = self.current_index.saturating_sub(300) as u64;
                        pipe.send_reset(
                            self.clock.seek_epoch() as u32,
                            self.current_index as u64,
                            preload_from,
                            0,
                            0,
                            target_msc,
                        );
                    }
                } else if let Some(tick) = cur_tick {
                    self.matching.on_tick_advance(tick, target_msc);
                    if let Some(ref pipe) = self.render_pipe {
                        pipe.send_advance(
                            self.clock.seek_epoch() as u32,
                            self.current_index as u64,
                            0,
                            target_msc,
                        );
                    }
                }
                self.publish_status();
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
                self.publish_status();
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
                self.publish_status();
            }
            CoreCommand::CloseAllPositions { reason } => {
                let cur_tick = self.store.get(self.current_index);
                self.matching.close_all_positions(
                    reason.unwrap_or_else(|| "CLOSE_ALL".to_string()),
                    self.clock.virtual_time_msc(),
                    self.clock.is_playing(),
                    cur_tick,
                );
                self.publish_status();
            }
            CoreCommand::ModifyPosition { ticket, sl, tp } => {
                if let Some(pos) = self.matching.positions.iter_mut().find(|p| p.ticket == ticket) {
                    if sl.is_some() { pos.sl = sl; }
                    if tp.is_some() { pos.tp = tp; }
                }
                self.publish_status();
            }
            CoreCommand::ResetTradingAccount => {
                self.matching.reset(1_000_000.0, self.clock.virtual_time_msc());
                self.publish_status();
            }
            CoreCommand::Shutdown => {
                return false;
            }
        }
        true
    }

    /// スナップショット生成 & watch 送信
    fn publish_status(&self) {
        let audit_len = self.matching.audit_log.len();
        let audit_start = audit_len.saturating_sub(50);
        let latest_audits = self.matching.audit_log[audit_start..].to_vec();

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
            current_tick: self.store.get(self.current_index).copied(),
            loop_config: self.clock.ab_loop(),
            latest_audits,
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
}

