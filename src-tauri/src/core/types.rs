use serde::{Deserialize, Serialize};

/// 仮想時刻 (MT5サーバー基準エポックミリ秒)
pub type VirtualTimeMsc = i64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PlaybackMode {
    Temporal,
    Count,
}

impl Default for PlaybackMode {
    fn default() -> Self {
        Self::Temporal
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PlaybackState {
    Stopped,
    Playing,
    Paused,
}

impl Default for PlaybackState {
    fn default() -> Self {
        Self::Stopped
    }
}

/// A-B ループ設定
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct AbLoopConfig {
    pub enabled: bool,
    pub a_time_msc: i64,
    pub b_time_msc: i64,
    pub a_index: Option<u64>,
    pub b_index: Option<u64>,
}

/// 週末スキップ設定
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct WeekendSkipConfig {
    pub enabled: bool,
    /// 金曜NYクローズ時刻（サーバー時間）
    pub friday_close_hour: u32,
    /// 月曜シドニーオープン時刻（サーバー時間）
    pub monday_open_hour: u32,
}

impl Default for WeekendSkipConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            friday_close_hour: 23,
            monday_open_hour: 0,
        }
    }
}

/// 実戦遅延シミュレーションモデル
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "params")]
pub enum LatencyModel {
    Zero,
    Fixed { latency_ms: u32 },
    Normal { mean_ms: f64, std_dev_ms: f64 },
}

impl Default for LatencyModel {
    fn default() -> Self {
        Self::Zero
    }
}

/// スリッページモデル
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "params")]
pub enum SlippageModel {
    None,
    /// ボラティリティ・ティック差分に応じたスリッページ
    Realistic {
        base_slippage_pips: f64,
        volatility_factor: f64,
    },
}

impl Default for SlippageModel {
    fn default() -> Self {
        Self::None
    }
}

/// Core 内で統一的に扱う高精度ティック表現
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CoreTick {
    pub index: u64,
    pub time_sec: i64,
    pub time_msc: i64,
    pub bid: f64,
    pub ask: f64,
    pub last: f64,
    pub volume: u64,
    pub volume_real: f64,
    pub flags: u32,
}

impl CoreTick {
    #[inline]
    pub fn spread(&self) -> f64 {
        (self.ask - self.bid).max(0.0)
    }

    #[inline]
    pub fn mid(&self) -> f64 {
        (self.bid + self.ask) * 0.5
    }
}

/// Core への操作コマンド
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CoreCommand {
    Play,
    Pause,
    TogglePlay,
    SetMultiplier(f64),
    SetPlaybackMode(PlaybackMode),
    SeekTime(i64),
    SeekIndex(u64),
    StepTicks(i64),
    StepTime(i64),
    SetAbLoop(Option<AbLoopConfig>),
    SetWeekendSkip(bool),
    SetLatencyModel(LatencyModel),
    SetSlippageModel(SlippageModel),
    SubmitOrder {
        symbol: String,
        side: OrderSide,
        volume: f64,
        sl_points: f64,
        tp_points: f64,
        comment: Option<String>,
    },
    ClosePosition {
        ticket: i32,
        volume: Option<f64>,
        reason: Option<String>,
    },
    CloseAllPositions {
        reason: Option<String>,
    },
    ModifyPosition {
        ticket: i32,
        sl: Option<f64>,
        tp: Option<f64>,
    },
    ResetTradingAccount,
    Shutdown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OrderSide {
    Buy,
    Sell,
}

impl OrderSide {
    pub fn as_str(&self) -> &'static str {
        match self {
            OrderSide::Buy => "BUY",
            OrderSide::Sell => "SELL",
        }
    }
}

/// Core から外部へ通知されるスナップショット
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoreStatusSnapshot {
    pub virtual_time_msc: i64,
    pub is_playing: bool,
    pub state: PlaybackState,
    pub multiplier: f64,
    pub speed_mode: PlaybackMode,
    pub current_index: u64,
    pub total_ticks: u64,
    pub seek_epoch: u64,
    pub trade_revision: u64,
    pub current_tick: Option<CoreTick>,
    pub loop_config: Option<AbLoopConfig>,
    pub latest_audits: Vec<crate::core::journal::ExecutionAuditRecord>,
}
