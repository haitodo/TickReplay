use std::sync::Arc;
use tauri::{AppHandle, State, Manager};
use crate::error::AppError;
use crate::state::{ReplayState, SpeedMode};

#[tauri::command]
pub async fn send_command(
    command_json: String,
    app_handle: AppHandle,
    state: State<'_, Arc<ReplayState>>,
) -> Result<(), AppError> {
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&command_json) {
        if let Some(command) = val.get("command").and_then(|c| c.as_str()) {
            if command == "CONTROL" {
                let mut p = state.playback.lock().unwrap();
                if let Some(playing) = val.get("is_playing").and_then(|p| p.as_bool()) {
                    p.is_playing = playing;
                }
                if let Some(mode_val) = val.get("speed_mode") {
                    if let Ok(mode) = serde_json::from_value::<SpeedMode>(mode_val.clone()) {
                        p.speed_mode = mode;
                    }
                }
                if let Some(mult) = val.get("multiplier").and_then(|m| m.as_f64()) {
                    p.multiplier = mult;
                }
                if let Some(step) = val.get("tick_step").and_then(|t| t.as_i64()) {
                    p.tick_step = step as i32;
                }
            } else if command == "TERMINATE" {
                if let Some(speed_order) = app_handle.get_webview_window("speed_order") {
                    let _ = speed_order.close();
                }
            }
        }
    }

    state.command_tx.send(command_json).map_err(|e| AppError::Config(e.to_string()))
}

#[tauri::command]
pub async fn read_trade_ticks(app_handle: AppHandle, ticket: i32) -> Result<String, AppError> {
    let state = app_handle.state::<Arc<ReplayState>>();
    let files_path = {
        let path_guard = state.files_path.lock().unwrap();
        path_guard.clone()
    };

    let Some(files_path) = files_path else {
        return Err(AppError::Config("MT5 Files path not configured".to_string()));
    };
    
    let ticks_file = files_path.join(format!("trade_ticks_{}.json", ticket));
    if !ticks_file.exists() {
        return Ok("[]".to_string());
    }
    
    let content = tokio::fs::read_to_string(&ticks_file).await?;
    
    let _ = tokio::fs::remove_file(ticks_file).await;
    
    Ok(content)
}

#[tauri::command]
pub async fn get_last_status(state: State<'_, Arc<ReplayState>>) -> Result<String, AppError> {
    let last = state.last_status.lock().unwrap();
    Ok(last.clone())
}

#[tauri::command]
pub async fn read_replay_news(
    state: State<'_, Arc<ReplayState>>,
) -> Result<String, AppError> {
    crate::ipc::read_replay_news(&state).await
}

#[tauri::command]
pub async fn sync_presets(
    time_presets: Vec<f64>,
    tick_presets: Vec<i32>,
    state: State<'_, Arc<ReplayState>>,
) -> Result<(), AppError> {
    {
        let mut s = state.settings.write().unwrap();
        s.time_presets = time_presets;
        s.time_presets.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        s.tick_presets = tick_presets;
        s.tick_presets.sort();
    }
    Ok(())
}
