use tauri_plugin_global_shortcut::Shortcut;
use crate::state::ReplayState;
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

// ショートカットキーの処理ロジック
pub async fn handle_shortcut_trigger(app_handle: AppHandle, shortcut_str: &str, state: &ReplayState) {
    let (is_playing, speed_mode, mut multiplier, mut tick_step) = {
        let p = state.playback.lock().unwrap();
        (p.is_playing, p.speed_mode.clone(), p.multiplier, p.tick_step)
    };

    let hotkeys = {
        let s = state.settings.read().unwrap();
        s.hotkeys.clone()
    };

    let mut action = None;
    for (act, key_def) in &hotkeys {
        if matches_shortcut(key_def, shortcut_str) {
            action = Some(act.clone());
            break;
        }
    }

    let Some(action_str) = action else {
        return;
    };

    if action_str == "order_buy"
        || action_str == "order_sell"
        || action_str == "order_close_buy"
        || action_str == "order_close_sell"
        || action_str == "order_close_all"
    {
        let _ = app_handle.emit("trigger-action", serde_json::json!({ "action": action_str }));
        return;
    }

    let mut cmd = None;

    if action_str == "play_pause" {
        let next_playing = !is_playing;
        {
            let mut p = state.playback.lock().unwrap();
            p.is_playing = next_playing;
        }
        cmd = Some(serde_json::json!({
            "command": "CONTROL",
            "is_playing": next_playing,
            "speed_mode": speed_mode,
            "multiplier": multiplier,
            "tick_step": tick_step
        }));
    } else if action_str == "step_forward" {
        if !is_playing {
            cmd = Some(serde_json::json!({
                "command": "SEEK_RELATIVE",
                "delta": 1
            }));
        }
    } else if action_str == "step_backward" {
        if !is_playing {
            cmd = Some(serde_json::json!({
                "command": "SEEK_RELATIVE",
                "delta": -1
            }));
        }
    } else if action_str == "session_jump_next" {
        cmd = Some(serde_json::json!({
            "command": "SESSION_JUMP",
            "session": "ANY",
            "direction": "NEXT"
        }));
    } else if action_str == "session_jump_prev" {
        cmd = Some(serde_json::json!({
            "command": "SESSION_JUMP",
            "session": "ANY",
            "direction": "PREV"
        }));
    } else if action_str == "time_jump_forward" {
        cmd = Some(serde_json::json!({
            "command": "TIME_JUMP",
            "delta_seconds": 3600
        }));
    } else if action_str == "time_jump_backward" {
        cmd = Some(serde_json::json!({
            "command": "TIME_JUMP",
            "delta_seconds": -3600
        }));
    } else if action_str == "time_jump_forward_1m" {
        cmd = Some(serde_json::json!({
            "command": "TIME_JUMP",
            "delta_seconds": 60
        }));
    } else if action_str == "time_jump_backward_1m" {
        cmd = Some(serde_json::json!({
            "command": "TIME_JUMP",
            "delta_seconds": -60
        }));
    } else if action_str == "time_jump_forward_10m" {
        cmd = Some(serde_json::json!({
            "command": "TIME_JUMP",
            "delta_seconds": 600
        }));
    } else if action_str == "time_jump_backward_10m" {
        cmd = Some(serde_json::json!({
            "command": "TIME_JUMP",
            "delta_seconds": -600
        }));
    } else if action_str == "coarse_speed_up" {
        if speed_mode == "TEMPORAL" {
            let presets = {
                let s = state.settings.read().unwrap();
                s.time_presets.clone()
            };
            let presets = if presets.is_empty() { vec![1.0, 5.0, 10.0, 60.0, 300.0, 3600.0] } else { presets };
            if let Some(&next) = presets.iter().find(|&&p| p > multiplier + 0.0001) {
                multiplier = next;
            }
            let mut p = state.playback.lock().unwrap();
            p.multiplier = multiplier;
        } else {
            let presets = {
                let s = state.settings.read().unwrap();
                s.tick_presets.clone()
            };
            let presets = if presets.is_empty() { vec![1, 5, 10, 50, 100, 500] } else { presets };
            if let Some(&next) = presets.iter().find(|&&p| p > tick_step) {
                tick_step = next;
            }
            let mut p = state.playback.lock().unwrap();
            p.tick_step = tick_step;
        }
        cmd = Some(serde_json::json!({
            "command": "CONTROL",
            "is_playing": is_playing,
            "speed_mode": speed_mode,
            "multiplier": multiplier,
            "tick_step": tick_step
        }));
    } else if action_str == "coarse_speed_down" {
        if speed_mode == "TEMPORAL" {
            let presets = {
                let s = state.settings.read().unwrap();
                s.time_presets.clone()
            };
            let presets = if presets.is_empty() { vec![1.0, 5.0, 10.0, 60.0, 300.0, 3600.0] } else { presets };
            if let Some(&prev) = presets.iter().rev().find(|&&p| p < multiplier - 0.0001) {
                multiplier = prev;
            }
            let mut p = state.playback.lock().unwrap();
            p.multiplier = multiplier;
        } else {
            let presets = {
                let s = state.settings.read().unwrap();
                s.tick_presets.clone()
            };
            let presets = if presets.is_empty() { vec![1, 5, 10, 50, 100, 500] } else { presets };
            if let Some(&prev) = presets.iter().rev().find(|&&p| p < tick_step) {
                tick_step = prev;
            }
            let mut p = state.playback.lock().unwrap();
            p.tick_step = tick_step;
        }
        cmd = Some(serde_json::json!({
            "command": "CONTROL",
            "is_playing": is_playing,
            "speed_mode": speed_mode,
            "multiplier": multiplier,
            "tick_step": tick_step
        }));
    } else if action_str == "fine_speed_up" {
        if speed_mode == "TEMPORAL" {
            let step = if multiplier < 1.0 { 0.1 }
                       else if multiplier < 10.0 { 1.0 }
                       else if multiplier < 60.0 { 5.0 }
                       else if multiplier < 300.0 { 50.0 }
                       else if multiplier < 3600.0 { 500.0 }
                       else { 1000.0 };
            multiplier += step;
            if multiplier > 10000.0 { multiplier = 10000.0; }
            let mut p = state.playback.lock().unwrap();
            p.multiplier = multiplier;
        } else {
            let step = if tick_step < 10 { 1 }
                       else if tick_step < 50 { 5 }
                       else if tick_step < 100 { 10 }
                       else if tick_step < 500 { 50 }
                       else { 100 };
            tick_step += step;
            if tick_step > 1000 { tick_step = 1000; }
            let mut p = state.playback.lock().unwrap();
            p.tick_step = tick_step;
        }
        cmd = Some(serde_json::json!({
            "command": "CONTROL",
            "is_playing": is_playing,
            "speed_mode": speed_mode,
            "multiplier": multiplier,
            "tick_step": tick_step
        }));
    } else if action_str == "fine_speed_down" {
        if speed_mode == "TEMPORAL" {
            let step = if multiplier <= 1.0 { 0.1 }
                       else if multiplier <= 10.0 { 1.0 }
                       else if multiplier <= 60.0 { 5.0 }
                       else if multiplier <= 300.0 { 50.0 }
                       else if multiplier <= 3600.0 { 500.0 }
                       else { 1000.0 };
            multiplier -= step;
            if multiplier < 0.1 { multiplier = 0.1; }
            let mut p = state.playback.lock().unwrap();
            p.multiplier = multiplier;
        } else {
            let step = if tick_step <= 10 { 1 }
                       else if tick_step <= 50 { 5 }
                       else if tick_step <= 100 { 10 }
                       else if tick_step <= 500 { 50 }
                       else { 100 };
            tick_step -= step;
            if tick_step < 1 { tick_step = 1; }
            let mut p = state.playback.lock().unwrap();
            p.tick_step = tick_step;
        }
        cmd = Some(serde_json::json!({
            "command": "CONTROL",
            "is_playing": is_playing,
            "speed_mode": speed_mode,
            "multiplier": multiplier,
            "tick_step": tick_step
        }));
    } else if action_str == "loop_set_a" {
        cmd = Some(serde_json::json!({ "command": "LOOP_SET_A" }));
    } else if action_str == "loop_set_b" {
        cmd = Some(serde_json::json!({ "command": "LOOP_SET_B" }));
    } else if action_str == "loop_clear" {
        cmd = Some(serde_json::json!({ "command": "LOOP_CLEAR" }));
    } else if action_str == "reset" {
        cmd = Some(serde_json::json!({ "command": "RESET" }));
    }

    if let Some(cmd_val) = cmd {
        if let Ok(cmd_str) = serde_json::to_string(&cmd_val) {
            let _ = state.command_tx.send(cmd_str);
        }
    }
}
