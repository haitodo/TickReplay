pub mod types;
pub mod clock;
pub mod journal;
pub mod matching;
pub mod store;
pub mod scheduler;
pub mod render_pipe;
pub mod sink_tickscope;

use tokio::sync::{mpsc, watch};
use crate::core::scheduler::{CoreScheduler, SchedulerConfig};
use crate::core::store::TickStore;
use crate::core::types::{
    AbLoopConfig, CoreCommand, CoreStatusSnapshot, LatencyModel, OrderSide, PlaybackMode,
    PlaybackState, SlippageModel,
};

/// 外部（Tauri コマンド、IPC、UI）から Replay Core を操作・監視するためのハンドル
#[derive(Clone, Debug)]
pub struct ReplayCoreHandle {
    cmd_tx: mpsc::UnboundedSender<CoreCommand>,
    status_rx: watch::Receiver<CoreStatusSnapshot>,
}

impl ReplayCoreHandle {
    pub fn play(&self) {
        let _ = self.cmd_tx.send(CoreCommand::Play);
    }

    pub fn pause(&self) {
        let _ = self.cmd_tx.send(CoreCommand::Pause);
    }

    pub fn toggle_play(&self) {
        let _ = self.cmd_tx.send(CoreCommand::TogglePlay);
    }

    pub fn set_multiplier(&self, mult: f64) {
        let _ = self.cmd_tx.send(CoreCommand::SetMultiplier(mult));
    }

    pub fn set_playback_mode(&self, mode: PlaybackMode) {
        let _ = self.cmd_tx.send(CoreCommand::SetPlaybackMode(mode));
    }

    pub fn seek_time(&self, target_msc: i64) {
        let _ = self.cmd_tx.send(CoreCommand::SeekTime(target_msc));
    }

    pub fn seek_index(&self, target_idx: u64) {
        let _ = self.cmd_tx.send(CoreCommand::SeekIndex(target_idx));
    }

    pub fn step_ticks(&self, delta_ticks: i64) {
        let _ = self.cmd_tx.send(CoreCommand::StepTicks(delta_ticks));
    }

    pub fn step_time(&self, delta_msc: i64) {
        let _ = self.cmd_tx.send(CoreCommand::StepTime(delta_msc));
    }

    pub fn set_ab_loop(&self, cfg: Option<AbLoopConfig>) {
        let _ = self.cmd_tx.send(CoreCommand::SetAbLoop(cfg));
    }

    pub fn set_weekend_skip(&self, enabled: bool) {
        let _ = self.cmd_tx.send(CoreCommand::SetWeekendSkip(enabled));
    }

    pub fn set_latency_model(&self, model: LatencyModel) {
        let _ = self.cmd_tx.send(CoreCommand::SetLatencyModel(model));
    }

    pub fn set_slippage_model(&self, model: SlippageModel) {
        let _ = self.cmd_tx.send(CoreCommand::SetSlippageModel(model));
    }

    pub fn submit_order(
        &self,
        symbol: String,
        side: OrderSide,
        volume: f64,
        sl_points: f64,
        tp_points: f64,
        comment: Option<String>,
    ) {
        let _ = self.cmd_tx.send(CoreCommand::SubmitOrder {
            symbol,
            side,
            volume,
            sl_points,
            tp_points,
            comment,
        });
    }

    pub fn close_position(&self, ticket: i32, volume: Option<f64>, reason: Option<String>) {
        let _ = self.cmd_tx.send(CoreCommand::ClosePosition {
            ticket,
            volume,
            reason,
        });
    }

    pub fn close_all_positions(&self, reason: Option<String>) {
        let _ = self.cmd_tx.send(CoreCommand::CloseAllPositions { reason });
    }

    pub fn modify_position(&self, ticket: i32, sl: Option<f64>, tp: Option<f64>) {
        let _ = self.cmd_tx.send(CoreCommand::ModifyPosition { ticket, sl, tp });
    }

    pub fn reset_account(&self) {
        let _ = self.cmd_tx.send(CoreCommand::ResetTradingAccount);
    }

    pub fn shutdown(&self) {
        let _ = self.cmd_tx.send(CoreCommand::Shutdown);
    }

    pub fn status(&self) -> CoreStatusSnapshot {
        self.status_rx.borrow().clone()
    }

    pub fn subscribe(&self) -> watch::Receiver<CoreStatusSnapshot> {
        self.status_rx.clone()
    }
}

/// Replay Core エンジンファクトリ
pub struct ReplayCore;

impl ReplayCore {
    /// 新規 Replay Core スケジューラを起動し、操作ハンドルと JoinHandle を返す
    pub fn start(
        store: TickStore,
        config: Option<SchedulerConfig>,
    ) -> (ReplayCoreHandle, tauri::async_runtime::JoinHandle<()>) {
        Self::start_with_sinks(store, config, None, None)
    }

    /// Sinks（MT5 Renderer パイプ、TickScope ブリッジ）を接続して起動
    pub fn start_with_sinks(
        store: TickStore,
        config: Option<SchedulerConfig>,
        render_pipe: Option<crate::core::render_pipe::RenderPipeHandle>,
        tickscope_bridge: Option<crate::core::sink_tickscope::TickScopeBridge>,
    ) -> (ReplayCoreHandle, tauri::async_runtime::JoinHandle<()>) {
        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();

        let initial_snapshot = CoreStatusSnapshot {
            virtual_time_msc: store.min_time_msc().unwrap_or(0),
            is_playing: false,
            state: PlaybackState::Stopped,
            multiplier: 1.0,
            speed_mode: PlaybackMode::Temporal,
            current_index: 0,
            total_ticks: store.len() as u64,
            seek_epoch: 1,
            trade_revision: 1,
            current_tick: store.get(0).copied(),
            loop_config: None,
            latest_audits: Vec::new(),
        };

        let (status_tx, status_rx) = watch::channel(initial_snapshot);
        let mut scheduler = CoreScheduler::new(store, cmd_rx, status_tx, config.unwrap_or_default());

        if let Some(pipe) = render_pipe {
            scheduler = scheduler.with_render_pipe(pipe);
        }
        if let Some(bridge) = tickscope_bridge {
            scheduler = scheduler.with_tickscope_bridge(bridge);
        }

        let join_handle = tauri::async_runtime::spawn(async move {
            scheduler.run().await;
        });

        let handle = ReplayCoreHandle { cmd_tx, status_rx };
        (handle, join_handle)
    }
}

#[cfg(test)]
pub(crate) mod mod_test_helper {
    use super::*;
    use crate::core::types::CoreTick;

    pub fn create_test_core() -> (ReplayCoreHandle, tauri::async_runtime::JoinHandle<()>) {
        let ticks = vec![
            CoreTick { index: 0, time_sec: 1, time_msc: 1000, bid: 150.0, ask: 150.005, last: 0.0, volume: 1, volume_real: 0.0, flags: 6 },
            CoreTick { index: 1, time_sec: 2, time_msc: 2000, bid: 150.010, ask: 150.015, last: 0.0, volume: 1, volume_real: 0.0, flags: 6 },
            CoreTick { index: 2, time_sec: 3, time_msc: 3000, bid: 150.020, ask: 150.025, last: 0.0, volume: 1, volume_real: 0.0, flags: 6 },
        ];
        let store = TickStore::from_core_ticks(ticks);
        ReplayCore::start(store, Some(SchedulerConfig { timer_interval_ms: 5, ui_emit_interval_ms: 10 }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::types::CoreTick;
    use std::time::Duration;

    fn generate_test_ticks(count: usize) -> Vec<CoreTick> {
        let mut ticks = Vec::with_capacity(count);
        let mut price = 150.0;
        for i in 0..count {
            let msc = 1_000_000 + (i as i64 * 100); // 100ms ごと
            if i % 2 == 0 {
                price += 0.005;
            } else {
                price -= 0.003;
            }
            ticks.push(CoreTick {
                index: i as u64,
                time_sec: msc / 1000,
                time_msc: msc,
                bid: price,
                ask: price + 0.004,
                last: price,
                volume: 1,
                volume_real: 1.0,
                flags: 6,
            });
        }
        ticks
    }

    #[tokio::test]
    async fn test_100x_multiplier_stress() {
        let ticks = generate_test_ticks(1000);
        let store = TickStore::from_core_ticks(ticks);
        let (handle, join_handle) = ReplayCore::start(
            store,
            Some(SchedulerConfig {
                timer_interval_ms: 10,
                ui_emit_interval_ms: 10,
            }),
        );

        handle.set_multiplier(100.0);
        handle.play();

        // 150ms 待機 (仮想時間では 150ms * 100 = 15,000ms = 15秒分 = 150ティック分進む)
        tokio::time::sleep(Duration::from_millis(150)).await;

        let status = handle.status();
        assert!(status.is_playing);
        assert!(status.current_index > 20, "100x playback must advance significantly (got {})", status.current_index);

        handle.shutdown();
        let _ = join_handle.await;
    }

    #[tokio::test]
    async fn test_rapid_random_seek_and_rewind() {
        let ticks = generate_test_ticks(1000);
        let store = TickStore::from_core_ticks(ticks);
        let (handle, join_handle) = ReplayCore::start(
            store,
            Some(SchedulerConfig {
                timer_interval_ms: 10,
                ui_emit_interval_ms: 10,
            }),
        );

        let seek_targets = [500, 100, 800, 50, 950, 0, 400];
        let mut prev_epoch = handle.status().seek_epoch;

        for &target in &seek_targets {
            handle.seek_index(target);
            tokio::time::sleep(Duration::from_millis(20)).await;
            let status = handle.status();
            assert_eq!(status.current_index, target);
            assert!(status.seek_epoch > prev_epoch);
            prev_epoch = status.seek_epoch;
        }

        handle.shutdown();
        let _ = join_handle.await;
    }

    #[tokio::test]
    async fn test_high_frequency_scalping_orders_and_audit() {
        let ticks = generate_test_ticks(500);
        let store = TickStore::from_core_ticks(ticks);
        let (handle, join_handle) = ReplayCore::start(
            store,
            Some(SchedulerConfig {
                timer_interval_ms: 5,
                ui_emit_interval_ms: 10,
            }),
        );

        handle.set_latency_model(LatencyModel::Fixed { latency_ms: 10 });
        handle.set_slippage_model(SlippageModel::Realistic {
            base_slippage_pips: 0.1,
            volatility_factor: 1.0,
        });

        handle.play();

        // 3件連続で注文
        handle.submit_order("USDJPY".to_string(), OrderSide::Buy, 1.0, 0.0, 0.0, None);
        handle.submit_order("USDJPY".to_string(), OrderSide::Sell, 0.5, 0.0, 0.0, None);
        handle.submit_order("USDJPY".to_string(), OrderSide::Buy, 2.0, 0.0, 0.0, None);

        // タイマーを進めて約定させる
        tokio::time::sleep(Duration::from_millis(150)).await;

        let status = handle.status();
        assert!(!status.latest_audits.is_empty(), "Orders must be filled and audited");
        assert!(status.latest_audits.iter().any(|a| a.symbol == "USDJPY"));

        handle.shutdown();
        let _ = join_handle.await;
    }

    #[tokio::test]
    async fn test_pause_and_instant_resume() {
        let ticks = generate_test_ticks(500);
        let store = TickStore::from_core_ticks(ticks);
        let (handle, join_handle) = ReplayCore::start(
            store,
            Some(SchedulerConfig {
                timer_interval_ms: 10,
                ui_emit_interval_ms: 10,
            }),
        );

        handle.set_multiplier(5.0);
        handle.play();
        tokio::time::sleep(Duration::from_millis(60)).await;
        handle.pause();
        tokio::time::sleep(Duration::from_millis(40)).await;

        let paused_idx = handle.status().current_index;
        tokio::time::sleep(Duration::from_millis(60)).await;
        let still_paused_idx = handle.status().current_index;
        assert_eq!(paused_idx, still_paused_idx, "Must stay stationary during pause");

        handle.play();
        tokio::time::sleep(Duration::from_millis(80)).await;
        let resumed_idx = handle.status().current_index;
        assert!(resumed_idx > still_paused_idx, "Must instantly resume playback");

        handle.shutdown();
        let _ = join_handle.await;
    }
}


