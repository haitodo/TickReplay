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
    ) -> (ReplayCoreHandle, tokio::task::JoinHandle<()>) {
        Self::start_with_sinks(store, config, None, None)
    }

    /// Sinks（MT5 Renderer パイプ、TickScope ブリッジ）を接続して起動
    pub fn start_with_sinks(
        store: TickStore,
        config: Option<SchedulerConfig>,
        render_pipe: Option<crate::core::render_pipe::RenderPipeHandle>,
        tickscope_bridge: Option<crate::core::sink_tickscope::TickScopeBridge>,
    ) -> (ReplayCoreHandle, tokio::task::JoinHandle<()>) {
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

        let join_handle = tokio::spawn(async move {
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

    pub fn create_test_core() -> (ReplayCoreHandle, tokio::task::JoinHandle<()>) {
        let ticks = vec![
            CoreTick { index: 0, time_sec: 1, time_msc: 1000, bid: 150.0, ask: 150.005, last: 0.0, volume: 1, volume_real: 0.0, flags: 6 },
            CoreTick { index: 1, time_sec: 2, time_msc: 2000, bid: 150.010, ask: 150.015, last: 0.0, volume: 1, volume_real: 0.0, flags: 6 },
            CoreTick { index: 2, time_sec: 3, time_msc: 3000, bid: 150.020, ask: 150.025, last: 0.0, volume: 1, volume_real: 0.0, flags: 6 },
        ];
        let store = TickStore::from_core_ticks(ticks);
        ReplayCore::start(store, Some(SchedulerConfig { timer_interval_ms: 5, ui_emit_interval_ms: 10 }))
    }
}

