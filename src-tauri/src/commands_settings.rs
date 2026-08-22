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

#[tauri::command]
pub async fn save_settings(
    app_handle: AppHandle,
    mut settings: ReplaySettings,
) -> Result<(), AppError> {
    let existing = load_settings(app_handle.clone()).await.unwrap_or(None);

    if settings.main_window_x.is_none() {
        if let Some(ref existing_settings) = existing {
            settings.main_window_x = existing_settings.main_window_x;
            settings.main_window_y = existing_settings.main_window_y;
        }
    }
    if settings.speed_order_window_x.is_none() {
        if let Some(ref existing_settings) = existing {
            settings.speed_order_window_x = existing_settings.speed_order_window_x;
            settings.speed_order_window_y = existing_settings.speed_order_window_y;
        }
    }
    if settings.positions_window_x.is_none() {
        if let Some(ref existing_settings) = existing {
            settings.positions_window_x = existing_settings.positions_window_x;
            settings.positions_window_y = existing_settings.positions_window_y;
        }
    }
    if settings.terminal_names.is_none() {
        if let Some(ref existing_settings) = existing {
            settings.terminal_names = existing_settings.terminal_names.clone();
        }
    }

    let config_dir = app_handle.path().app_config_dir()?;
    if !config_dir.exists() {
        tokio::fs::create_dir_all(&config_dir).await?;
    }
    let config_file = config_dir.join("settings.json");
    let json_str = serde_json::to_string_pretty(&settings)?;
    tokio::fs::write(config_file, json_str).await?;
    Ok(())
}

pub async fn save_window_position_to_disk(
    app_handle: &AppHandle,
    label: &str,
    x: i32,
    y: i32,
) -> Result<(), AppError> {
    let config_dir = app_handle.path().app_config_dir()?;
    let config_file = config_dir.join("settings.json");
    
    let mut settings = if config_file.exists() {
        let json_str = tokio::fs::read_to_string(&config_file).await?;
        serde_json::from_str::<ReplaySettings>(&json_str).ok()
    } else {
        None
    };

    if let Some(ref mut s) = settings {
        if label == "main" {
            if s.main_window_x == Some(x) && s.main_window_y == Some(y) {
                return Ok(());
            }
            s.main_window_x = Some(x);
            s.main_window_y = Some(y);
        } else if label == "speed_order" {
            if s.speed_order_window_x == Some(x) && s.speed_order_window_y == Some(y) {
                return Ok(());
            }
            s.speed_order_window_x = Some(x);
            s.speed_order_window_y = Some(y);
        } else if label == "positions" {
            if s.positions_window_x == Some(x) && s.positions_window_y == Some(y) {
                return Ok(());
            }
            s.positions_window_x = Some(x);
            s.positions_window_y = Some(y);
        } else {
            return Ok(());
        }

        if !config_dir.exists() {
            tokio::fs::create_dir_all(&config_dir).await?;
        }
        let json_str = serde_json::to_string_pretty(s)?;
        tokio::fs::write(config_file, json_str).await?;
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
