use tauri_plugin_global_shortcut::Shortcut;
use crate::state::{ReplayState, SpeedMode};
use tauri::{AppHandle, Emitter};

// ショートカットキーが一致するかどうかの判定ヘルパー
pub fn matches_shortcut(registered_key: &str, triggered_shortcut: &str) -> bool {
    if let Ok(shortcut) = registered_key.parse::<Shortcut>() {
        let reg_str = shortcut.to_string().to_lowercase();
        if reg_str == triggered_shortcut {
            return true;
        }
    }
    
    let reg_lower = registered_key.to_lowercase();
    if reg_lower == triggered_shortcut {
        return true;
    }
    
    let reg_norm = reg_lower.replace("control", "ctrl");
    let trig_norm = triggered_shortcut.replace("control", "ctrl");
    if reg_norm == trig_norm {
        return true;
    }
    
    if reg_lower.starts_with("key") && reg_lower.len() == 4 {
        let char_part = &reg_lower[3..];
        if char_part == trig_norm {
            return true;
        }
    }
    
    if reg_norm == "bracketright" && trig_norm == "]" { return true; }
    if reg_norm == "bracketleft" && trig_norm == "[" { return true; }
    if reg_norm == "]" && trig_norm == "bracketright" { return true; }
    if reg_norm == "[" && trig_norm == "bracketleft" { return true; }
    if reg_norm == "equal" && trig_norm == "=" { return true; }
    if reg_norm == "=" && trig_norm == "equal" { return true; }
    if reg_norm == "minus" && trig_norm == "-" { return true; }
    if reg_norm == "-" && trig_norm == "minus" { return true; }

    false
}

// 大まかな速度調整（プリセット選択）の純粋計算ヘルパー
fn get_next_coarse_time_preset(presets: &[f64], current: f64) -> f64 {
    let default = [1.0, 5.0, 10.0, 60.0, 300.0, 3600.0];
    let list = if presets.is_empty() { &default[..] } else { presets };
    list.iter().copied().find(|&p| p > current + 0.0001).unwrap_or(current)
}

fn get_prev_coarse_time_preset(presets: &[f64], current: f64) -> f64 {
    let default = [1.0, 5.0, 10.0, 60.0, 300.0, 3600.0];
    let list = if presets.is_empty() { &default[..] } else { presets };
    list.iter().copied().rev().find(|&p| p < current - 0.0001).unwrap_or(current)
}

fn get_next_coarse_tick_preset(presets: &[i32], current: i32) -> i32 {
    let default = [1, 5, 10, 50, 100, 500];
    let list = if presets.is_empty() { &default[..] } else { presets };
    list.iter().copied().find(|&p| p > current).unwrap_or(current)
}

fn get_prev_coarse_tick_preset(presets: &[i32], current: i32) -> i32 {
    let default = [1, 5, 10, 50, 100, 500];
    let list = if presets.is_empty() { &default[..] } else { presets };
    list.iter().copied().rev().find(|&p| p < current).unwrap_or(current)
}

// 微調整の純粋計算ヘルパー
fn calculate_fine_speed_up_time(current: f64) -> f64 {
    let step = if current < 1.0 { 0.1 }
    else if current < 10.0 { 1.0 }
    else if current < 60.0 { 5.0 }
    else if current < 300.0 { 50.0 }
    else if current < 3600.0 { 500.0 }
    else { 1000.0 };
    (current + step).min(10000.0)
}

fn calculate_fine_speed_down_time(current: f64) -> f64 {
    let step = if current <= 1.0 { 0.1 }
    else if current <= 10.0 { 1.0 }
    else if current <= 60.0 { 5.0 }
    else if current <= 300.0 { 50.0 }
    else if current <= 3600.0 { 500.0 }
    else { 1000.0 };
    (current - step).max(0.1)
}

fn calculate_fine_speed_up_tick(current: i32) -> i32 {
    let step = if current < 10 { 1 }
    else if current < 50 { 5 }
    else if current < 100 { 10 }
    else if current < 500 { 50 }
    else { 100 };
    (current + step).min(1000)
}

fn calculate_fine_speed_down_tick(current: i32) -> i32 {
    let step = if current <= 10 { 1 }
    else if current <= 50 { 5 }
    else if current <= 100 { 10 }
    else if current <= 500 { 50 }
    else { 100 };
    (current - step).max(1)
}

// ショートカットキーの処理ロジック
pub async fn handle_shortcut_trigger(app_handle: AppHandle, shortcut_str: &str, state: &ReplayState) {
    let (is_playing, speed_mode, mut multiplier, mut tick_step) = {
        let p = state.playback.lock().unwrap();
        (p.is_playing, p.speed_mode, p.multiplier, p.tick_step)
    };

    let hotkeys = {
        let s = state.settings.read().unwrap();
        s.hotkeys.clone()
    };

    let mut action = None;
    for (act, key_def) in &hotkeys {
        if matches_shortcut(key_def, shortcut_str) {
            action = Some(act.as_str());
            break;
        }
    }

    let Some(action_str) = action else {
        return;
    };

    if matches!(
        action_str,
        "order_buy" | "order_sell" | "order_close_buy" | "order_close_sell" | "order_close_all"
    ) {
        let _ = app_handle.emit("trigger-action", serde_json::json!({ "action": action_str }));
        return;
    }

    let mut cmd = None;

    match action_str {
        "play_pause" => {
            let next_playing = !is_playing;
            state.playback.lock().unwrap().is_playing = next_playing;
            cmd = Some(serde_json::json!({
                "command": "CONTROL",
                "is_playing": next_playing,
                "speed_mode": speed_mode,
                "multiplier": multiplier,
                "tick_step": tick_step
            }));
        }
        "step_forward" => {
            if !is_playing {
                cmd = Some(serde_json::json!({ "command": "SEEK_RELATIVE", "delta": 1 }));
            }
        }
        "step_backward" => {
            if !is_playing {
                cmd = Some(serde_json::json!({ "command": "SEEK_RELATIVE", "delta": -1 }));
            }
        }
        "session_jump_next" => {
            cmd = Some(serde_json::json!({ "command": "SESSION_JUMP", "session": "ANY", "direction": "NEXT" }));
        }
        "session_jump_prev" => {
            cmd = Some(serde_json::json!({ "command": "SESSION_JUMP", "session": "ANY", "direction": "PREV" }));
        }
        "time_jump_forward" => {
            cmd = Some(serde_json::json!({ "command": "TIME_JUMP", "delta_seconds": 3600 }));
        }
        "time_jump_backward" => {
            cmd = Some(serde_json::json!({ "command": "TIME_JUMP", "delta_seconds": -3600 }));
        }
        "time_jump_forward_1m" => {
            cmd = Some(serde_json::json!({ "command": "TIME_JUMP", "delta_seconds": 60 }));
        }
        "time_jump_backward_1m" => {
            cmd = Some(serde_json::json!({ "command": "TIME_JUMP", "delta_seconds": -60 }));
        }
        "time_jump_forward_10m" => {
            cmd = Some(serde_json::json!({ "command": "TIME_JUMP", "delta_seconds": 600 }));
        }
        "time_jump_backward_10m" => {
            cmd = Some(serde_json::json!({ "command": "TIME_JUMP", "delta_seconds": -600 }));
        }
        "coarse_speed_up" => {
            let (time_presets, tick_presets) = {
                let s = state.settings.read().unwrap();
                (s.time_presets.clone(), s.tick_presets.clone())
            };
            match speed_mode {
                SpeedMode::Temporal => {
                    multiplier = get_next_coarse_time_preset(&time_presets, multiplier);
                    state.playback.lock().unwrap().multiplier = multiplier;
                }
                SpeedMode::Tick => {
                    tick_step = get_next_coarse_tick_preset(&tick_presets, tick_step);
                    state.playback.lock().unwrap().tick_step = tick_step;
                }
            }
            cmd = Some(serde_json::json!({
                "command": "CONTROL",
                "is_playing": is_playing,
                "speed_mode": speed_mode,
                "multiplier": multiplier,
                "tick_step": tick_step
            }));
        }
        "coarse_speed_down" => {
            let (time_presets, tick_presets) = {
                let s = state.settings.read().unwrap();
                (s.time_presets.clone(), s.tick_presets.clone())
            };
            match speed_mode {
                SpeedMode::Temporal => {
                    multiplier = get_prev_coarse_time_preset(&time_presets, multiplier);
                    state.playback.lock().unwrap().multiplier = multiplier;
                }
                SpeedMode::Tick => {
                    tick_step = get_prev_coarse_tick_preset(&tick_presets, tick_step);
                    state.playback.lock().unwrap().tick_step = tick_step;
                }
            }
            cmd = Some(serde_json::json!({
                "command": "CONTROL",
                "is_playing": is_playing,
                "speed_mode": speed_mode,
                "multiplier": multiplier,
                "tick_step": tick_step
            }));
        }
        "fine_speed_up" => {
            match speed_mode {
                SpeedMode::Temporal => {
                    multiplier = calculate_fine_speed_up_time(multiplier);
                    state.playback.lock().unwrap().multiplier = multiplier;
                }
                SpeedMode::Tick => {
                    tick_step = calculate_fine_speed_up_tick(tick_step);
                    state.playback.lock().unwrap().tick_step = tick_step;
                }
            }
            cmd = Some(serde_json::json!({
                "command": "CONTROL",
                "is_playing": is_playing,
                "speed_mode": speed_mode,
                "multiplier": multiplier,
                "tick_step": tick_step
            }));
        }
        "fine_speed_down" => {
            match speed_mode {
                SpeedMode::Temporal => {
                    multiplier = calculate_fine_speed_down_time(multiplier);
                    state.playback.lock().unwrap().multiplier = multiplier;
                }
                SpeedMode::Tick => {
                    tick_step = calculate_fine_speed_down_tick(tick_step);
                    state.playback.lock().unwrap().tick_step = tick_step;
                }
            }
            cmd = Some(serde_json::json!({
                "command": "CONTROL",
                "is_playing": is_playing,
                "speed_mode": speed_mode,
                "multiplier": multiplier,
                "tick_step": tick_step
            }));
        }
        "loop_set_a" => cmd = Some(serde_json::json!({ "command": "LOOP_SET_A" })),
        "loop_set_b" => cmd = Some(serde_json::json!({ "command": "LOOP_SET_B" })),
        "loop_clear" => cmd = Some(serde_json::json!({ "command": "LOOP_CLEAR" })),
        "reset" => cmd = Some(serde_json::json!({ "command": "RESET" })),
        _ => {}
    }

    if let Some(cmd_val) = cmd {
        if let Ok(cmd_str) = serde_json::to_string(&cmd_val) {
            let _ = state.command_tx.send(cmd_str);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_matches_shortcut() {
        assert!(matches_shortcut("Control+Alt+Space", "control+alt+space"));
        assert!(matches_shortcut("Ctrl+Alt+Space", "control+alt+space"));
        assert!(matches_shortcut("BracketRight", "]"));
        assert!(matches_shortcut("Control+Alt+BracketRight", "control+alt+bracketright"));
        assert!(!matches_shortcut("Control+Alt+Space", "control+alt+arrowleft"));
    }

    #[test]
    fn test_coarse_preset_helpers() {
        let presets = vec![1.0, 5.0, 10.0, 60.0];
        assert_eq!(get_next_coarse_time_preset(&presets, 1.0), 5.0);
        assert_eq!(get_prev_coarse_time_preset(&presets, 5.0), 1.0);
        assert_eq!(get_next_coarse_time_preset(&presets, 60.0), 60.0);
    }

    #[test]
    fn test_fine_speed_helpers() {
        assert_eq!(calculate_fine_speed_up_time(1.0), 2.0);
        assert_eq!(calculate_fine_speed_down_time(1.0), 0.9);
        assert_eq!(calculate_fine_speed_up_tick(1), 2);
        assert_eq!(calculate_fine_speed_down_tick(1), 1);
    }
}



