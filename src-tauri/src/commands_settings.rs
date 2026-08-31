use std::sync::Arc;
use tauri::{AppHandle, State, Manager};
use crate::error::AppError;
use crate::state::{ReplayState, ReplaySettings};

pub fn validate_session_id(session_id: &str) -> Result<(), AppError> {
    if session_id.is_empty() || !session_id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err(AppError::Config("無効なセッションIDです".to_string()));
    }
    Ok(())
}

#[tauri::command]
pub async fn set_shortcuts_active(
    active: bool,
    hotkeys: std::collections::HashMap<String, String>,
    app_handle: AppHandle,
    state: State<'_, Arc<ReplayState>>,
) -> Result<(), AppError> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    let shortcut_manager = app_handle.global_shortcut();

    {
        let current_hotkeys = {
            let s = state.settings.read().unwrap();
            s.hotkeys.clone()
        };
        for key in current_hotkeys.values() {
            if key.trim().is_empty() {
                continue;
            }
            if let Ok(shortcut) = key.parse::<Shortcut>() {
                let _ = shortcut_manager.unregister(shortcut);
            }
        }
    }

    {
        let mut s = state.settings.write().unwrap();
        s.hotkeys = hotkeys.clone();
    }

    if active {
        for key in hotkeys.values() {
            if key.trim().is_empty() {
                continue;
            }
            if let Ok(shortcut) = key.parse::<Shortcut>() {
                let _ = shortcut_manager.unregister(shortcut.clone());
                if let Err(e) = shortcut_manager.register(shortcut) {
                    eprintln!("Failed to register global shortcut {}: {}", key, e);
                }
            }
        }
    }
    Ok(())
}

static SETTINGS_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static POSITION_QUEUE: std::sync::OnceLock<tokio::sync::mpsc::UnboundedSender<(AppHandle, String, i32, i32)>> = std::sync::OnceLock::new();

/// ウィンドウ移動イベントをデバウンスして非同期に保存キューへ追加
pub fn queue_window_position_save(app_handle: AppHandle, label: String, x: i32, y: i32) {
    let tx = POSITION_QUEUE.get_or_init(|| {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<(AppHandle, String, i32, i32)>();
        tauri::async_runtime::spawn(async move {
            let mut pending: std::collections::HashMap<String, (AppHandle, i32, i32)> = std::collections::HashMap::new();
            loop {
                match rx.recv().await {
                    Some((handle, lbl, pos_x, pos_y)) => {
                        pending.insert(lbl, (handle, pos_x, pos_y));
                        while let Ok((h, l, px, py)) = rx.try_recv() {
                            pending.insert(l, (h, px, py));
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                        while let Ok((h, l, px, py)) = rx.try_recv() {
                            pending.insert(l, (h, px, py));
                        }
                        for (l, (h, px, py)) in pending.drain() {
                            let _ = save_window_position_to_disk(&h, &l, px, py).await;
                        }
                    }
                    None => break,
                }
            }
        });
        tx
    });
    let _ = tx.send((app_handle, label, x, y));
}

/// 一時ファイルを経由したアトミックな設定書き込み
async fn atomic_write_settings(config_dir: &std::path::Path, settings: &ReplaySettings) -> Result<(), AppError> {
    if !config_dir.exists() {
        tokio::fs::create_dir_all(config_dir).await?;
    }
    let config_file = config_dir.join("settings.json");
    let temp_file = config_dir.join("settings.json.tmp");
    let json_str = serde_json::to_string_pretty(settings)?;
    tokio::fs::write(&temp_file, &json_str).await?;
    tokio::fs::rename(&temp_file, &config_file).await?;
    Ok(())
}

#[tauri::command]
pub async fn save_settings(
    app_handle: AppHandle,
    mut settings: ReplaySettings,
) -> Result<(), AppError> {
    let _guard = SETTINGS_LOCK.lock().await;
    let existing = load_settings(app_handle.clone()).await.unwrap_or(None);

    if let Some(ref existing_settings) = existing {
        if settings.selected_terminal.is_empty() {
            settings.selected_terminal = existing_settings.selected_terminal.clone();
        }
        if settings.selected_profile.is_empty() {
            settings.selected_profile = existing_settings.selected_profile.clone();
        }
        if settings.source_symbol.is_empty() {
            settings.source_symbol = existing_settings.source_symbol.clone();
        }
        if settings.start_time.is_empty() {
            settings.start_time = existing_settings.start_time.clone();
        }
        if settings.end_time.is_empty() {
            settings.end_time = existing_settings.end_time.clone();
        }
        if settings.preloaded_bars == 0 && existing_settings.preloaded_bars != 0 {
            settings.preloaded_bars = existing_settings.preloaded_bars;
        }
        if settings.preload_mode.is_none() {
            settings.preload_mode = existing_settings.preload_mode.clone();
        }
        if settings.preload_date.is_none() {
            settings.preload_date = existing_settings.preload_date.clone();
        }
        if settings.preload_timeframe.is_none() {
            settings.preload_timeframe = existing_settings.preload_timeframe.clone();
        }
        if settings.hotkeys.is_none() {
            settings.hotkeys = existing_settings.hotkeys.clone();
        }
        if settings.time_presets.is_none() {
            settings.time_presets = existing_settings.time_presets.clone();
        }
        if settings.tick_presets.is_none() {
            settings.tick_presets = existing_settings.tick_presets.clone();
        }
        if settings.news_filters.is_none() {
            settings.news_filters = existing_settings.news_filters.clone();
        }
        if settings.glass_effect.is_none() {
            settings.glass_effect = existing_settings.glass_effect;
        }
        if settings.theme_mode.is_none() {
            settings.theme_mode = existing_settings.theme_mode.clone();
        }
        if settings.news_auto_scroll.is_none() {
            settings.news_auto_scroll = existing_settings.news_auto_scroll;
        }
        if settings.always_on_top.is_none() {
            settings.always_on_top = existing_settings.always_on_top;
        }
        if settings.is_shortcuts_active.is_none() {
            settings.is_shortcuts_active = existing_settings.is_shortcuts_active;
        }
        if settings.limit_tick_history.is_none() {
            settings.limit_tick_history = existing_settings.limit_tick_history;
        }
        if settings.tick_history_timeframe.is_none() {
            settings.tick_history_timeframe = existing_settings.tick_history_timeframe.clone();
        }
        if settings.max_history_bars.is_none() {
            settings.max_history_bars = existing_settings.max_history_bars;
        }
        if settings.timezone_mode.is_none() {
            settings.timezone_mode = existing_settings.timezone_mode.clone();
        }
        if settings.auto_skip_weekend.is_none() {
            settings.auto_skip_weekend = existing_settings.auto_skip_weekend;
        }
        if settings.pl_color_style.is_none() {
            settings.pl_color_style = existing_settings.pl_color_style.clone();
        }
        if settings.order_color_style.is_none() {
            settings.order_color_style = existing_settings.order_color_style.clone();
        }
        if settings.hedging.is_none() {
            settings.hedging = existing_settings.hedging;
        }
        if settings.enable_virtual_trading.is_none() {
            settings.enable_virtual_trading = existing_settings.enable_virtual_trading;
        }
        if settings.initial_balance.is_none() {
            settings.initial_balance = existing_settings.initial_balance;
        }
        if settings.leverage.is_none() {
            settings.leverage = existing_settings.leverage;
        }
        if settings.enable_pseudo_rate.is_none() {
            settings.enable_pseudo_rate = existing_settings.enable_pseudo_rate;
        }
        if settings.pseudo_base_spread.is_none() {
            settings.pseudo_base_spread = existing_settings.pseudo_base_spread;
        }
        if settings.pseudo_threshold.is_none() {
            settings.pseudo_threshold = existing_settings.pseudo_threshold;
        }
        if settings.pseudo_sensitivity.is_none() {
            settings.pseudo_sensitivity = existing_settings.pseudo_sensitivity;
        }
        if settings.pseudo_mode.is_none() {
            settings.pseudo_mode = existing_settings.pseudo_mode.clone();
        }
        if settings.pseudo_rollover_enabled.is_none() {
            settings.pseudo_rollover_enabled = existing_settings.pseudo_rollover_enabled;
        }
        if settings.pseudo_rollover_spread.is_none() {
            settings.pseudo_rollover_spread = existing_settings.pseudo_rollover_spread;
        }
        if settings.pseudo_rollover_recovery_min.is_none() {
            settings.pseudo_rollover_recovery_min = existing_settings.pseudo_rollover_recovery_min;
        }
        if settings.show_holding_time.is_none() {
            settings.show_holding_time = existing_settings.show_holding_time;
        }
        if settings.holding_time_mode.is_none() {
            settings.holding_time_mode = existing_settings.holding_time_mode.clone();
        }
        if settings.additional_symbols.is_none() {
            settings.additional_symbols = existing_settings.additional_symbols.clone();
        }
        if settings.main_window_x.is_none() {
            settings.main_window_x = existing_settings.main_window_x;
            settings.main_window_y = existing_settings.main_window_y;
        }
        if settings.speed_order_window_x.is_none() {
            settings.speed_order_window_x = existing_settings.speed_order_window_x;
            settings.speed_order_window_y = existing_settings.speed_order_window_y;
        }
        if settings.positions_window_x.is_none() {
            settings.positions_window_x = existing_settings.positions_window_x;
            settings.positions_window_y = existing_settings.positions_window_y;
        }
        if settings.controller_window_x.is_none() {
            settings.controller_window_x = existing_settings.controller_window_x;
            settings.controller_window_y = existing_settings.controller_window_y;
        }
        if settings.settings_window_x.is_none() {
            settings.settings_window_x = existing_settings.settings_window_x;
            settings.settings_window_y = existing_settings.settings_window_y;
        }
        if settings.terminal_names.is_none() {
            settings.terminal_names = existing_settings.terminal_names.clone();
        }
    }

    let config_dir = app_handle.path().app_config_dir()?;
    atomic_write_settings(&config_dir, &settings).await?;
    Ok(())
}

pub async fn save_window_position_to_disk(
    app_handle: &AppHandle,
    label: &str,
    x: i32,
    y: i32,
) -> Result<(), AppError> {
    let _guard = SETTINGS_LOCK.lock().await;
    let config_dir = app_handle.path().app_config_dir()?;
    let config_file = config_dir.join("settings.json");
    
    let mut settings = if config_file.exists() {
        let json_str = tokio::fs::read_to_string(&config_file).await?;
        serde_json::from_str::<ReplaySettings>(&json_str).ok()
    } else {
        None
    };

    if let Some(ref mut s) = settings {
        let mut changed = false;
        if label == "main" {
            if s.main_window_x != Some(x) || s.main_window_y != Some(y) {
                s.main_window_x = Some(x);
                s.main_window_y = Some(y);
                changed = true;
            }
        } else if label == "speed_order" {
            if s.speed_order_window_x != Some(x) || s.speed_order_window_y != Some(y) {
                s.speed_order_window_x = Some(x);
                s.speed_order_window_y = Some(y);
                changed = true;
            }
        } else if label == "positions" {
            if s.positions_window_x != Some(x) || s.positions_window_y != Some(y) {
                s.positions_window_x = Some(x);
                s.positions_window_y = Some(y);
                changed = true;
            }
        } else if label == "controller" {
            if s.controller_window_x != Some(x) || s.controller_window_y != Some(y) {
                s.controller_window_x = Some(x);
                s.controller_window_y = Some(y);
                changed = true;
            }
        } else if label == "settings" {
            if s.settings_window_x != Some(x) || s.settings_window_y != Some(y) {
                s.settings_window_x = Some(x);
                s.settings_window_y = Some(y);
                changed = true;
            }
        } else {
            return Ok(());
        }

        if changed {
            atomic_write_settings(&config_dir, s).await?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn load_settings(
    app_handle: AppHandle,
) -> Result<Option<ReplaySettings>, AppError> {
    let config_dir = app_handle.path().app_config_dir()?;
    let config_file = config_dir.join("settings.json");
    if !config_file.exists() {
        return Ok(None);
    }
    let json_str = tokio::fs::read_to_string(config_file).await?;
    let settings = serde_json::from_str::<ReplaySettings>(&json_str)?;
    Ok(Some(settings))
}

#[tauri::command]
pub async fn save_session(
    app_handle: AppHandle,
    session_id: String,
    session_data: serde_json::Value,
) -> Result<(), AppError> {
    validate_session_id(&session_id)?;
    let config_dir = app_handle.path().app_config_dir()?;
    let sessions_dir = config_dir.join("sessions");
    if !sessions_dir.exists() {
        tokio::fs::create_dir_all(&sessions_dir).await?;
    }
    let session_file = sessions_dir.join(format!("{}.json", session_id));
    let json_str = serde_json::to_string_pretty(&session_data)?;
    tokio::fs::write(session_file, json_str).await?;
    Ok(())
}

#[tauri::command]
pub async fn get_saved_sessions(
    app_handle: AppHandle,
) -> Result<Vec<serde_json::Value>, AppError> {
    let config_dir = app_handle.path().app_config_dir()?;
    let sessions_dir = config_dir.join("sessions");
    if !sessions_dir.exists() {
        return Ok(vec![]);
    }
    
    let mut sessions = Vec::new();
    let mut dir_entries = tokio::fs::read_dir(sessions_dir).await?;
    while let Some(entry) = dir_entries.next_entry().await? {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
            if let Ok(json_str) = tokio::fs::read_to_string(&path).await {
                if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&json_str) {
                    sessions.push(json_val);
                }
            }
        }
    }
    
    sessions.sort_by(|a, b| {
        let a_time = a.get("saved_at").and_then(|v| v.as_str()).unwrap_or("");
        let b_time = b.get("saved_at").and_then(|v| v.as_str()).unwrap_or("");
        b_time.cmp(a_time)
    });
    
    Ok(sessions)
}

#[tauri::command]
pub async fn delete_session(
    app_handle: AppHandle,
    session_id: String,
) -> Result<(), AppError> {
    validate_session_id(&session_id)?;
    let config_dir = app_handle.path().app_config_dir()?;
    let session_file = config_dir.join("sessions").join(format!("{}.json", session_id));
    if session_file.exists() {
        tokio::fs::remove_file(session_file).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn clear_all_sessions(app_handle: AppHandle) -> Result<(), AppError> {
    let config_dir = app_handle.path().app_config_dir()?;
    let sessions_dir = config_dir.join("sessions");
    if sessions_dir.exists() {
        let mut dir_entries = tokio::fs::read_dir(sessions_dir).await?;
        while let Some(entry) = dir_entries.next_entry().await? {
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
                tokio::fs::remove_file(path).await?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_session_id() {
        assert!(validate_session_id("session-123_abc").is_ok());
        assert!(validate_session_id("").is_err());
        assert!(validate_session_id("invalid/session").is_err());
        assert!(validate_session_id("invalid session").is_err());
    }
}
