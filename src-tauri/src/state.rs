use std::path::PathBuf;
use std::sync::{Mutex, RwLock};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SpeedMode {
    Temporal,
    Tick,
}

impl Default for SpeedMode {
    fn default() -> Self {
        Self::Temporal
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PlaybackState {
    pub is_playing: bool,
    pub speed_mode: SpeedMode,
    pub multiplier: f64,
    pub tick_step: i32,
}


#[derive(Debug, Clone)]
pub struct SettingsState {
    pub hotkeys: std::collections::HashMap<String, String>,
    pub time_presets: Vec<f64>,
    pub tick_presets: Vec<i32>,
}

pub struct ReplayState {
    // EA とのIPCに使用するMQL5/Filesパス (プロファイル転送用に維持)
    pub files_path: Mutex<Option<PathBuf>>,
    // 再生コントロール状態（ロック単位の最小化のため一つの構造体に集約）
    pub playback: Mutex<PlaybackState>,
    // 読込頻度が高く、書込頻度が極めて低い設定系（RwLockを適用して並行読込を許容）
    pub settings: RwLock<SettingsState>,
    // 前回のステータス内容（変化検知用）
    pub last_status: Mutex<String>,
    // メモリ上にキャッシュされた経済指標イベント (キー: "YYYY-MM")
    pub economic_events: Mutex<std::collections::HashMap<String, Vec<crate::pseudo_dmm::EconomicEvent>>>,
    // Named Pipe へコマンドを送るための送信チャネル
    pub command_tx: tokio::sync::mpsc::UnboundedSender<String>,
    // 外部ツール（Drenhisなど）へステータスを配信するためのブロードキャストチャネル
    pub sync_tx: tokio::sync::broadcast::Sender<String>,
}

impl ReplayState {
    pub fn new(
        command_tx: tokio::sync::mpsc::UnboundedSender<String>,
        sync_tx: tokio::sync::broadcast::Sender<String>,
    ) -> Self {
        let default_hotkeys = std::collections::HashMap::from([
            ("play_pause".to_string(), "Control+Alt+Space".to_string()),
            ("step_forward".to_string(), "Control+Alt+ArrowRight".to_string()),
            ("step_backward".to_string(), "Control+Alt+ArrowLeft".to_string()),
            ("session_jump_next".to_string(), "Control+Alt+Home".to_string()),
            ("session_jump_prev".to_string(), "Control+Alt+End".to_string()),
            ("time_jump_forward".to_string(), "Control+Alt+Shift+PageUp".to_string()),
            ("time_jump_backward".to_string(), "Control+Alt+Shift+PageDown".to_string()),
            ("time_jump_forward_1m".to_string(), "Control+Alt+ArrowUp".to_string()),
            ("time_jump_backward_1m".to_string(), "Control+Alt+ArrowDown".to_string()),
            ("time_jump_forward_10m".to_string(), "Control+Alt+PageUp".to_string()),
            ("time_jump_backward_10m".to_string(), "Control+Alt+PageDown".to_string()),
            ("coarse_speed_up".to_string(), "Control+Alt+BracketRight".to_string()),
            ("coarse_speed_down".to_string(), "Control+Alt+BracketLeft".to_string()),
            ("fine_speed_up".to_string(), "Control+Alt+Equal".to_string()),
            ("fine_speed_down".to_string(), "Control+Alt+Minus".to_string()),
            ("loop_set_a".to_string(), "Control+Alt+KeyA".to_string()),
            ("loop_set_b".to_string(), "Control+Alt+KeyB".to_string()),
            ("loop_clear".to_string(), "Control+Alt+KeyC".to_string()),
            ("reset".to_string(), "Control+Alt+KeyR".to_string()),
            ("order_buy".to_string(), "".to_string()),
            ("order_sell".to_string(), "".to_string()),
            ("order_close_buy".to_string(), "".to_string()),
            ("order_close_sell".to_string(), "".to_string()),
            ("order_close_all".to_string(), "".to_string()),
        ]);

        let default_time_presets = vec![1.0, 5.0, 10.0, 60.0, 300.0, 3600.0];
        let default_tick_presets = vec![1, 5, 10, 50, 100, 500];

        Self {
            files_path: Mutex::new(None),
            playback: Mutex::new(PlaybackState {
                is_playing: false,
                speed_mode: SpeedMode::Temporal,
                multiplier: 1.0,
                tick_step: 1,
            }),
            settings: RwLock::new(SettingsState {
                hotkeys: default_hotkeys,
                time_presets: default_time_presets,
                tick_presets: default_tick_presets,
            }),
            last_status: Mutex::new(String::new()),
            economic_events: Mutex::new(std::collections::HashMap::new()),
            command_tx,
            sync_tx,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
pub struct ReplaySettings {
    #[serde(default)]
    pub selected_terminal: String,
    #[serde(default)]
    pub selected_profile: String,
    #[serde(default)]
    pub source_symbol: String,
    #[serde(default)]
    pub start_time: String,
    #[serde(default)]
    pub end_time: String,
    #[serde(default)]
    pub preloaded_bars: i32,
    #[serde(default)]
    pub auto_scroll_sync: bool,
    #[serde(default)]
    pub preload_mode: Option<String>,
    #[serde(default)]
    pub preload_date: Option<String>,
    #[serde(default)]
    pub preload_timeframe: Option<String>,
    #[serde(default)]
    pub hotkeys: Option<std::collections::HashMap<String, String>>,
    #[serde(default)]
    pub time_presets: Option<Vec<f64>>,
    #[serde(default)]
    pub tick_presets: Option<Vec<i32>>,
    #[serde(default)]
    pub news_filters: Option<serde_json::Value>,
    #[serde(default)]
    pub glass_effect: Option<bool>,
    #[serde(default)]
    pub theme_mode: Option<String>,
    #[serde(default)]
    pub news_auto_scroll: Option<bool>,
    #[serde(default)]
    pub always_on_top: Option<bool>,
    #[serde(default)]
    pub is_shortcuts_active: Option<bool>,
    #[serde(default)]
    pub limit_tick_history: Option<bool>,
    #[serde(default)]
    pub tick_history_timeframe: Option<String>,
    #[serde(default)]
    pub max_history_bars: Option<i32>,
    #[serde(default)]
    pub timezone_mode: Option<String>,
    #[serde(default)]
    pub auto_skip_weekend: Option<bool>,
    #[serde(default)]
    pub pl_color_style: Option<String>,
    #[serde(default)]
    pub order_color_style: Option<String>,
    #[serde(default)]
    pub hedging: Option<bool>,
    #[serde(default)]
    pub enable_virtual_trading: Option<bool>,
    #[serde(default)]
    pub initial_balance: Option<f64>,
    #[serde(default)]
    pub leverage: Option<f64>,
    #[serde(default)]
    pub enable_pseudo_rate: Option<bool>,
    #[serde(default)]
    pub pseudo_base_spread: Option<f64>,
    #[serde(default)]
    pub pseudo_threshold: Option<f64>,
    #[serde(default)]
    pub pseudo_sensitivity: Option<f64>,
    #[serde(default)]
    pub pseudo_mode: Option<String>,
    #[serde(default)]
    pub pseudo_rollover_enabled: Option<bool>,
    #[serde(default)]
    pub pseudo_rollover_spread: Option<f64>,
    #[serde(default)]
    pub pseudo_rollover_recovery_min: Option<i32>,
    #[serde(default)]
    pub show_holding_time: Option<bool>,
    #[serde(default)]
    pub holding_time_mode: Option<String>,
    #[serde(default)]
    pub additional_symbols: Option<String>,
    #[serde(default)]
    pub main_window_x: Option<i32>,
    #[serde(default)]
    pub main_window_y: Option<i32>,
    #[serde(default)]
    pub speed_order_window_x: Option<i32>,
    #[serde(default)]
    pub speed_order_window_y: Option<i32>,
    #[serde(default)]
    pub positions_window_x: Option<i32>,
    #[serde(default)]
    pub positions_window_y: Option<i32>,
    #[serde(default)]
    pub controller_window_x: Option<i32>,
    #[serde(default)]
    pub controller_window_y: Option<i32>,
    #[serde(default)]
    pub settings_window_x: Option<i32>,
    #[serde(default)]
    pub settings_window_y: Option<i32>,
    #[serde(default)]
    pub terminal_names: Option<std::collections::HashMap<String, String>>,
}

