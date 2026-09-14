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
    let mut final_cmd_json = command_json;
    if let Ok(mut val) = serde_json::from_str::<serde_json::Value>(&final_cmd_json) {
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
            } else if command == "INIT" {
                // economic_events_csv が未設定または空の場合、キャッシュまたはロードから自動補完
                let needs_eco_csv = match val.get("economic_events_csv") {
                    Some(serde_json::Value::String(s)) => s.is_empty(),
                    None => true,
                    _ => false,
                };

                if needs_eco_csv {
                    let enable_pseudo = val.get("enable_pseudo_rate").and_then(|v| v.as_bool()).unwrap_or(true);
                    if enable_pseudo {
                        if let (Some(sym), Some(st), Some(et)) = (
                            val.get("source_symbol").and_then(|s| s.as_str()).map(|s| s.to_string()),
                            val.get("start_time").and_then(|s| s.as_str()).map(|s| s.to_string()),
                            val.get("end_time").and_then(|s| s.as_str()).map(|s| s.to_string()),
                        ) {
                            let pm = val.get("preload_mode").and_then(|s| s.as_str()).map(|s| s.to_string());
                            let pd = val.get("preload_date").and_then(|s| s.as_str()).map(|s| s.to_string());
                            
                            let ym_list = crate::pseudo_dmm::get_year_months_between(
                                if pm.as_deref() == Some("DATE") && pd.as_ref().map_or(false, |s| !s.is_empty()) {
                                    pd.as_deref().unwrap()
                                } else {
                                    &st
                                },
                                &et,
                            );

                            let mut all_events = Vec::new();
                            let mut missing_ym = Vec::new();
                            {
                                let cache = state.economic_events.lock().unwrap();
                                for (y, m) in &ym_list {
                                    let ym_str = format!("{:04}-{:02}", y, m);
                                    if let Some(events) = cache.get(&ym_str) {
                                        all_events.extend(events.clone());
                                    } else {
                                        missing_ym.push((*y, *m));
                                    }
                                }
                            }

                            if !missing_ym.is_empty() {
                                if let Ok((_, loaded_events)) = tokio::task::spawn_blocking(move || {
                                    crate::pseudo_dmm::load_and_check_economic_data_range(
                                        &sym,
                                        &st,
                                        &et,
                                        pm.as_deref(),
                                        pd.as_deref(),
                                        None,
                                    )
                                }).await {
                                    let mut cache = state.economic_events.lock().unwrap();
                                    for (ym, events) in loaded_events {
                                        all_events.extend(events.clone());
                                        cache.insert(ym, events);
                                    }
                                }
                            }

                            let csv = crate::pseudo_dmm::format_economic_schedule_csv(&all_events);
                            if !csv.is_empty() {
                                if let Some(obj) = val.as_object_mut() {
                                    obj.insert("economic_events_csv".to_string(), serde_json::Value::String(csv));
                                    if let Ok(updated_json) = serde_json::to_string(&val) {
                                        final_cmd_json = updated_json;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    state.command_tx.send(final_cmd_json).map_err(|e| AppError::Config(e.to_string()))
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
