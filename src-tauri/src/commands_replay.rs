use std::sync::Arc;
use tauri::{AppHandle, State, Manager, Emitter};
use crate::error::AppError;
use crate::state::{ReplayState, SpeedMode};

pub fn emit_trading_status_update(
    app_handle: &AppHandle,
    state: &Arc<ReplayState>,
) {
    let core_opt = state.core_handle.lock().unwrap().clone();
    let snap_opt = core_opt.as_ref().map(|c| c.status());

    let mut last = state.last_status.lock().unwrap();
    let mut val: serde_json::Value = if !last.is_empty() {
        serde_json::from_str(&last).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({ "status": "ACTIVE" })
    };

    if let Some(obj) = val.as_object_mut() {
        if let Some(ref snap) = snap_opt {
            if let Some(ref tick) = snap.current_tick {
                let spread = ((tick.ask - tick.bid) * 100.0).round() / 100.0;
                obj.insert("bid".to_string(), serde_json::json!(tick.bid));
                obj.insert("ask".to_string(), serde_json::json!(tick.ask));
                obj.insert("spread".to_string(), serde_json::json!(spread));
                obj.insert("jfx_bid".to_string(), serde_json::json!(tick.bid));
                obj.insert("jfx_ask".to_string(), serde_json::json!(tick.ask));
                obj.insert("jfx_spread".to_string(), serde_json::json!(spread));
                obj.insert("jfx_real".to_string(), serde_json::json!(true));
            }
            obj.insert("account".to_string(), serde_json::to_value(&snap.account).unwrap_or_default());
            obj.insert("positions".to_string(), serde_json::to_value(&snap.positions).unwrap_or_default());
            if let Some(ref hist) = snap.history {
                let hist_val = serde_json::to_value(hist).unwrap_or_default();
                obj.insert("history".to_string(), hist_val.clone());
                *state.last_history.lock().unwrap() = Some(hist_val);
            }
            obj.insert("trade_revision".to_string(), serde_json::json!(snap.trade_revision));
            obj.insert("history_revision".to_string(), serde_json::json!(snap.history_revision));
            obj.insert("execution_audits".to_string(), serde_json::to_value(&snap.latest_audits).unwrap_or_default());
            obj.insert("time_stop_seconds".to_string(), serde_json::json!(snap.time_stop_seconds));
            obj.insert("time_stop_enabled".to_string(), serde_json::json!(snap.time_stop_enabled));
        }
    }

    if let Ok(json_str) = serde_json::to_string(&val) {
        *last = json_str.clone();
        let _ = app_handle.emit("mt5-status", &json_str);
        let _ = state.sync_tx.send(json_str);
    }
}

pub fn jst_to_server_time_msc(s: &str) -> Option<i64> {
    use chrono::{Datelike, Timelike};
    let s = s.trim().replace('T', " ").replace(['.', '/'], "-");
    if s.is_empty() {
        return None;
    }
    let naive_dt = chrono::NaiveDateTime::parse_from_str(&s, "%Y-%m-%d %H:%M:%S")
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(&s, "%Y-%m-%d %H:%M"))
        .or_else(|_| chrono::NaiveDate::parse_from_str(&s, "%Y-%m-%d").map(|d| d.and_hms_opt(0, 0, 0).unwrap()))
        .ok()?;
    let is_dst = crate::pseudo_dmm::PseudoDmmEngine::is_us_dst(
        naive_dt.year(),
        naive_dt.month(),
        naive_dt.day(),
        naive_dt.hour(),
    );
    let offset_hours = if is_dst { 6 } else { 7 };
    let server_dt = naive_dt - chrono::Duration::hours(offset_hours);
    Some(server_dt.and_utc().timestamp_millis())
}

fn get_session_times_for_date(cur_date: chrono::NaiveDate, session: &str) -> Vec<(&'static str, u32, u32)> {
    use chrono::Datelike;
    let y = cur_date.year();
    let m = cur_date.month();
    let d = cur_date.day();
    // サーバー時間 12:00 (NY市場開始前・ロンドン昼) のDST状態で判定
    let is_dst = crate::pseudo_dmm::PseudoDmmEngine::is_us_dst(y, m, d, 12);
    // サーバー時間 (GMT+2冬 / GMT+3夏) でのセッション開始時刻 (HH, MM)
    // TYO: JST 08:45 -> 冬 01:45 / 夏 02:45
    // LDN: 欧州開始 (現地08:00) -> 冬 10:00 / 夏 10:00 (常にサーバー時間10:00)
    // NY:  米国コア開始 (現地08:00) -> 冬 15:00 / 夏 15:00 (常にサーバー時間15:00)
    let tyo_hour = if is_dst { 2 } else { 1 };
    match session {
        "TYO" => vec![("TYO", tyo_hour, 45)],
        "LDN" => vec![("LDN", 10, 0)],
        "NY" => vec![("NY", 15, 0)],
        _ => vec![
            ("TYO", tyo_hour, 45),
            ("LDN", 10, 0),
            ("NY", 15, 0),
        ],
    }
}

pub fn calculate_session_jump_target(cur_msc: i64, session: &str, is_next: bool) -> i64 {
    use chrono::{Datelike, DateTime};

    let cur_sec = (cur_msc / 1000).max(0);
    let naive_dt = DateTime::from_timestamp(cur_sec, 0).map(|dt| dt.naive_utc()).unwrap_or_default();

    if is_next {
        for day_offset in 0..14 {
            let cur_date = naive_dt.date() + chrono::Duration::days(day_offset);
            let weekday = cur_date.weekday();
            if weekday == chrono::Weekday::Sat || weekday == chrono::Weekday::Sun {
                continue;
            }
            let session_times = get_session_times_for_date(cur_date, session);
            for &(_, hour, min) in &session_times {
                if let Some(target_time) = cur_date.and_hms_opt(hour, min, 0) {
                    let target_sec = target_time.and_utc().timestamp();
                    if target_sec > cur_sec {
                        return target_sec * 1000;
                    }
                }
            }
        }
    } else {
        for day_offset in 0..14 {
            let cur_date = naive_dt.date() - chrono::Duration::days(day_offset);
            let weekday = cur_date.weekday();
            if weekday == chrono::Weekday::Sat || weekday == chrono::Weekday::Sun {
                continue;
            }
            let mut rev_times = get_session_times_for_date(cur_date, session);
            rev_times.reverse();
            for &(_, hour, min) in &rev_times {
                if let Some(target_time) = cur_date.and_hms_opt(hour, min, 0) {
                    let target_sec = target_time.and_utc().timestamp();
                    if target_sec < cur_sec {
                        return target_sec * 1000;
                    }
                }
            }
        }
    }

    cur_msc
}

/// Replay Core v2 への再生制御コマンド共通ディスパッチャ
/// UIからのsend_command、外部WSクライアント(Drenhis/TickScope/Tracely)、グローバルショートカットなどから一元的に呼び出される
pub fn dispatch_replay_command(
    state: &ReplayState,
    cmd_json: &str,
    app_handle: Option<&AppHandle>,
) -> Result<(), AppError> {
    let val: serde_json::Value = match serde_json::from_str(cmd_json) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };

    let Some(command) = val.get("command").and_then(|c| c.as_str()) else {
        return Ok(());
    };

    let core_opt = state.core_handle.lock().unwrap().clone();

    match command {
        "PLAY" => {
            state.playback.lock().unwrap().is_playing = true;
            if let Some(core) = core_opt {
                core.play();
            }
        }
        "PAUSE" => {
            state.playback.lock().unwrap().is_playing = false;
            if let Some(core) = core_opt {
                core.pause();
            }
        }
        "CONTROL" => {
            let mut p = state.playback.lock().unwrap();
            let mut playing_opt = None;
            if let Some(playing) = val.get("is_playing").and_then(|p| p.as_bool()) {
                p.is_playing = playing;
                playing_opt = Some(playing);
            }
            let mut mult_opt = None;
            if let Some(mult) = val.get("multiplier").and_then(|m| m.as_f64()) {
                p.multiplier = mult;
                mult_opt = Some(mult);
            }
            let mut mode_opt = None;
            if let Some(mode_val) = val.get("speed_mode").and_then(|s| s.as_str()) {
                if mode_val == "COUNT" || mode_val == "TICK" {
                    p.speed_mode = SpeedMode::Tick;
                    mode_opt = Some(crate::core::types::PlaybackMode::Count);
                } else {
                    p.speed_mode = SpeedMode::Temporal;
                    mode_opt = Some(crate::core::types::PlaybackMode::Temporal);
                }
            }
            let mut step_opt = None;
            if let Some(step) = val.get("tick_step").and_then(|t| t.as_i64()) {
                p.tick_step = step as i32;
                step_opt = Some(step.max(1) as f64);
            }
            let weekend_opt = val.get("auto_skip_weekend").and_then(|w| w.as_bool());
            drop(p);

            if let Some(core) = core_opt {
                if let Some(playing) = playing_opt {
                    if playing { core.play(); } else { core.pause(); }
                }
                if let Some(mult) = mult_opt {
                    core.set_multiplier(mult);
                }
                if let Some(mode) = mode_opt {
                    core.set_playback_mode(mode);
                }
                if let Some(tps) = step_opt {
                    core.set_ticks_per_second(tps);
                }
                if let Some(skip) = weekend_opt {
                    core.set_weekend_skip(skip);
                }
            }
        }
        "SEEK" => {
            if let Some(idx) = val.get("target_index").or_else(|| val.get("target_idx")).and_then(|i| i.as_i64()) {
                if let Some(core) = core_opt {
                    core.seek_index(idx.max(0) as u64);
                }
            }
        }
        "SEEK_TIME" => {
            let target_time = val.get("target_time_msc")
                .or_else(|| val.get("virtual_time_msc"))
                .and_then(|t| t.as_i64())
                .or_else(|| {
                    val.get("target_time")
                        .and_then(|t| t.as_str())
                        .and_then(jst_to_server_time_msc)
                });
            if let Some(time_msc) = target_time {
                if let Some(core) = core_opt {
                    core.seek_time(time_msc);
                }
            }
        }
        "STEP" => {
            let delta = val.get("delta").and_then(|d| d.as_i64()).unwrap_or(1);
            if let Some(core) = core_opt {
                core.step_ticks(delta);
            }
        }
        "SEEK_RELATIVE" => {
            let delta = val.get("delta").and_then(|d| d.as_i64()).unwrap_or(0);
            if delta != 0 {
                if let Some(core) = core_opt {
                    core.step_ticks(delta);
                }
            }
        }
        "TIME_JUMP" => {
            let delta_sec = val.get("delta_seconds").and_then(|d| d.as_i64()).unwrap_or(0);
            if let Some(core) = core_opt {
                core.step_time(delta_sec * 1000);
            }
        }
        "SESSION_JUMP" => {
            let session = val.get("session").and_then(|s| s.as_str()).unwrap_or("ANY");
            let direction = val.get("direction").and_then(|d| d.as_str()).unwrap_or("NEXT");
            let is_next = direction.eq_ignore_ascii_case("NEXT");
            let cur_msc = *state.current_virtual_time_msc.lock().unwrap();
            let target_msc = calculate_session_jump_target(cur_msc, session, is_next);
            if let Some(core) = core_opt {
                core.seek_time(target_msc);
            }
        }
        "LOOP_SET_A" => {
            if let Some(core) = core_opt {
                let cur_msc = *state.current_virtual_time_msc.lock().unwrap();
                let b_time = core.status().loop_config.map(|c| c.b_time_msc).unwrap_or(0);
                core.set_ab_loop(Some(crate::core::types::AbLoopConfig {
                    enabled: b_time > cur_msc,
                    a_time_msc: cur_msc,
                    b_time_msc: b_time,
                    a_index: None,
                    b_index: None,
                }));
            }
        }
        "LOOP_SET_B" => {
            if let Some(core) = core_opt {
                let cur_msc = *state.current_virtual_time_msc.lock().unwrap();
                let a_time = core.status().loop_config.map(|c| c.a_time_msc).unwrap_or(0);
                core.set_ab_loop(Some(crate::core::types::AbLoopConfig {
                    enabled: cur_msc > a_time,
                    a_time_msc: a_time,
                    b_time_msc: cur_msc,
                    a_index: None,
                    b_index: None,
                }));
            }
        }
        "LOOP_CLEAR" => {
            if let Some(core) = core_opt {
                core.set_ab_loop(None);
            }
        }
        "RESET" => {
            if let Some(core) = core_opt {
                core.seek_index(0);
            }
        }
        "TERMINATE" => {
            state.playback.lock().unwrap().is_playing = false;
            if let Some(core) = core_opt {
                core.shutdown();
            }
            if let Some(ref pipe) = *state.render_pipe_handle.lock().unwrap() {
                pipe.send_terminate(0);
                println!("[commands_replay] MT5 Renderer EA へ TERMINATE (チャート全クローズ) コマンド送信");
            }
            if let Some(app) = app_handle {
                if let Some(speed_order) = app.get_webview_window("speed_order") {
                    let _ = speed_order.close();
                }
                if let Some(positions) = app.get_webview_window("positions") {
                    let _ = positions.close();
                }
            }
            {
                let mut child_guard = state.tick_scope_child.lock().unwrap();
                if let Some(mut child) = child_guard.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                    println!("[commands_replay] TickScope Replay プロセス終了完了");
                }
            }
            let _ = state.sync_tx.send(r#"{"status":"TERMINATE","command":"TERMINATE","is_playing":false}"#.to_string());
        }
        _ => {}
    }

    Ok(())
}

#[tauri::command]
pub async fn send_command(
    command_json: String,
    app_handle: AppHandle,
    state: State<'_, Arc<ReplayState>>,
) -> Result<(), AppError> {
    let final_cmd_json = command_json;
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&final_cmd_json) {
        if let Some(command) = val.get("command").and_then(|c| c.as_str()) {
            // --- 仮想取引エンジンのコマンド直接処理 (MT5 Named Pipe への転送不要) ---
            match command {
                "ORDER_OPEN" => {
                    let type_str = val.get("type").and_then(|t| t.as_str()).unwrap_or("BUY");
                    let volume = val.get("volume").and_then(|v| v.as_f64()).unwrap_or(1.0);
                    let sl_points = val.get("sl_points").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let tp_points = val.get("tp_points").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let comment = val.get("comment").and_then(|c| c.as_str()).map(|s| s.to_string());
                    let sym = val.get("symbol").and_then(|s| s.as_str()).unwrap_or("USDJPY").to_string();

                    let core_opt = state.core_handle.lock().unwrap().clone();
                    if let Some(core) = core_opt {
                        let side = if type_str == "BUY" {
                            crate::core::types::OrderSide::Buy
                        } else {
                            crate::core::types::OrderSide::Sell
                        };
                        core.submit_order(sym, side, volume, sl_points, tp_points, comment);
                    }
                    return Ok(());
                }
                "ORDER_CLOSE" => {
                    let ticket = val.get("ticket").and_then(|t| t.as_i64()).unwrap_or(0) as i32;
                    let volume = val.get("volume").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let core_opt = state.core_handle.lock().unwrap().clone();
                    if let Some(core) = core_opt {
                        let vol_opt = if volume > 0.0 { Some(volume) } else { None };
                        core.close_position(ticket, vol_opt, Some("MANUAL".to_string()));
                    }
                    return Ok(());
                }
                "ORDER_CLOSE_ALL" => {
                    let core_opt = state.core_handle.lock().unwrap().clone();
                    if let Some(core) = core_opt {
                        core.close_all_positions(Some("MANUAL".to_string()));
                    }
                    return Ok(());
                }
                "ORDER_CLOSE_BUY" => {
                    let core_opt = state.core_handle.lock().unwrap().clone();
                    if let Some(core) = core_opt {
                        core.close_buy_positions(Some("MANUAL".to_string()));
                    }
                    return Ok(());
                }
                "ORDER_CLOSE_SELL" => {
                    let core_opt = state.core_handle.lock().unwrap().clone();
                    if let Some(core) = core_opt {
                        core.close_sell_positions(Some("MANUAL".to_string()));
                    }
                    return Ok(());
                }
                "ORDER_MODIFY" => {
                    let ticket = val.get("ticket").and_then(|t| t.as_i64()).unwrap_or(0) as i32;
                    let sl = val.get("sl").and_then(|s| s.as_f64());
                    let tp = val.get("tp").and_then(|t| t.as_f64());
                    let core_opt = state.core_handle.lock().unwrap().clone();
                    if let Some(core) = core_opt {
                        core.modify_position(ticket, sl, tp);
                    }
                    return Ok(());
                }
                "SET_CONTRACT_SIZE" => {
                    if let Some(size) = val.get("size").and_then(|s| s.as_f64()) {
                        let core_opt = state.core_handle.lock().unwrap().clone();
                        if let Some(core) = core_opt {
                            core.set_contract_size(size);
                        }
                    }
                    return Ok(());
                }
                "SET_HEDGING" => {
                    if let Some(allowed) = val.get("allowed").and_then(|a| a.as_bool()) {
                        let core_opt = state.core_handle.lock().unwrap().clone();
                        if let Some(core) = core_opt {
                            core.set_hedging(allowed);
                        }
                    }
                    return Ok(());
                }
                "SET_TIME_STOP" => {
                    let enabled = val.get("enabled").and_then(|e| e.as_bool()).unwrap_or(false);
                    let seconds = val.get("seconds").and_then(|s| s.as_u64()).unwrap_or(20) as u32;
                    let mode_str = val.get("mode").and_then(|m| m.as_str()).unwrap_or("loss_only");
                    let mode = if mode_str.eq_ignore_ascii_case("always") {
                        crate::core::types::TimeStopMode::Always
                    } else {
                        crate::core::types::TimeStopMode::LossOnly
                    };
                    let core_opt = state.core_handle.lock().unwrap().clone();
                    if let Some(core) = core_opt {
                        core.set_time_stop(enabled, seconds, mode);
                    }
                    return Ok(());
                }
                "SET_LATENCY" => {
                    if let Some(latency) = val.get("latency_ms").and_then(|l| l.as_i64()) {
                        let core_opt = state.core_handle.lock().unwrap().clone();
                        if let Some(core) = core_opt {
                            let model = if latency <= 0 {
                                crate::core::types::LatencyModel::Zero
                            } else {
                                crate::core::types::LatencyModel::Fixed { latency_ms: latency as u32 }
                            };
                            core.set_latency_model(model);
                        }
                    }
                    return Ok(());
                }
                "ACCOUNT_RESET" => {
                    let balance = val.get("balance").or_else(|| val.get("initial_balance")).and_then(|b| b.as_f64()).unwrap_or(1_000_000.0);
                    let leverage_opt = val.get("leverage").and_then(|l| l.as_f64());
                    let core_opt = state.core_handle.lock().unwrap().clone();
                    if let Some(core) = core_opt {
                        core.reset_account_with_balance(balance);
                        if let Some(lev) = leverage_opt {
                            core.set_leverage(lev);
                        }
                    }
                    return Ok(());
                }
                "ACCOUNT_TRANSACTION" => {
                    let tx_type = val.get("transaction_type").and_then(|t| t.as_str()).unwrap_or("DEPOSIT");
                    let amount = val.get("amount").and_then(|a| a.as_f64()).unwrap_or(0.0);
                    let comment = val.get("comment").and_then(|c| c.as_str()).map(|s| s.to_string());
                    let is_deposit = tx_type.eq_ignore_ascii_case("DEPOSIT");
                    let core_opt = state.core_handle.lock().unwrap().clone();
                    if let Some(core) = core_opt {
                        core.account_transaction(is_deposit, amount, comment);
                    }
                    return Ok(());
                }
                "RESTORE_ACCOUNT" => {
                    let balance = val.get("balance").and_then(|b| b.as_f64()).unwrap_or(1_000_000.0);
                    let initial_balance = val.get("initial_balance").and_then(|b| b.as_f64()).unwrap_or(balance);
                    let equity = val.get("equity").and_then(|e| e.as_f64()).unwrap_or(balance);
                    let leverage = val.get("leverage").and_then(|l| l.as_f64()).unwrap_or(25.0);
                    let margin = val.get("margin").and_then(|m| m.as_f64()).unwrap_or(0.0);
                    let free_margin = val.get("free_margin").and_then(|f| f.as_f64()).unwrap_or(equity);
                    let margin_level = val.get("margin_level").and_then(|m| m.as_f64()).unwrap_or(0.0);
                    let next_ticket = val.get("next_ticket").and_then(|t| t.as_i64()).unwrap_or(1) as i32;
                    let account = crate::virtual_trading::VirtualAccount {
                        balance,
                        equity,
                        margin,
                        free_margin,
                        margin_level,
                        leverage,
                        currency: "JPY".to_string(),
                        profit: equity - balance,
                        total_profit: balance - initial_balance,
                    };
                    let core_opt = state.core_handle.lock().unwrap().clone();
                    if let Some(core) = core_opt {
                        core.restore_account(account, next_ticket);
                    }
                    return Ok(());
                }
                "RESTORE_POSITION" => {
                    let ticket = val.get("ticket").and_then(|t| t.as_i64()).unwrap_or(1) as i32;
                    let r#type = val.get("type").and_then(|t| t.as_str()).unwrap_or("BUY").to_string();
                    let symbol = val.get("symbol").and_then(|s| s.as_str()).unwrap_or("USDJPY").to_string();
                    let volume = val.get("volume").and_then(|v| v.as_f64()).unwrap_or(1.0);
                    let open_price = val.get("open_price").and_then(|p| p.as_f64()).unwrap_or(0.0);
                    let open_time_msc = val.get("open_time_msc").and_then(|t| t.as_i64()).unwrap_or(0);
                    let pos = crate::virtual_trading::VirtualPosition {
                        ticket,
                        symbol,
                        r#type,
                        volume,
                        open_price,
                        open_time: open_time_msc / 1000,
                        open_time_msc,
                        close_price: None,
                        close_time: None,
                        close_time_msc: None,
                        sl: val.get("sl").and_then(|v| v.as_f64()),
                        tp: val.get("tp").and_then(|v| v.as_f64()),
                        current_price: val.get("current_price").and_then(|v| v.as_f64()).or(Some(open_price)),
                        commission: 0.0,
                        swap: 0.0,
                        profit: val.get("profit").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        close_reason: None,
                        mfe_pips: val.get("mfe_pips").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        mae_pips: val.get("mae_pips").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        spread_entry: val.get("spread_entry").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        volatility: val.get("volatility").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        volume_60s: val.get("volume_60s").and_then(|v| v.as_u64()).unwrap_or(0),
                        accumulated_real_time: val.get("accumulated_real_time").and_then(|v| v.as_f64()).unwrap_or(0.0),
                    };
                    let core_opt = state.core_handle.lock().unwrap().clone();
                    if let Some(core) = core_opt {
                        core.restore_position(pos);
                    }
                    return Ok(());
                }
                "RESTORE_HISTORY" => {
                    let ticket = val.get("ticket").and_then(|t| t.as_i64()).unwrap_or(1) as i32;
                    let r#type = val.get("type").and_then(|t| t.as_str()).unwrap_or("BUY").to_string();
                    let symbol = val.get("symbol").and_then(|s| s.as_str()).unwrap_or("USDJPY").to_string();
                    let volume = val.get("volume").and_then(|v| v.as_f64()).unwrap_or(1.0);
                    let open_price = val.get("open_price").and_then(|p| p.as_f64()).unwrap_or(0.0);
                    let open_time_msc = val.get("open_time_msc").and_then(|t| t.as_i64()).unwrap_or(0);
                    let close_time_msc = val.get("close_time_msc").and_then(|t| t.as_i64());
                    let hist = crate::virtual_trading::VirtualPosition {
                        ticket,
                        symbol,
                        r#type,
                        volume,
                        open_price,
                        open_time: open_time_msc / 1000,
                        open_time_msc,
                        close_price: val.get("close_price").and_then(|v| v.as_f64()),
                        close_time: close_time_msc.map(|t| t / 1000),
                        close_time_msc,
                        sl: val.get("sl").and_then(|v| v.as_f64()),
                        tp: val.get("tp").and_then(|v| v.as_f64()),
                        current_price: val.get("close_price").and_then(|v| v.as_f64()),
                        commission: 0.0,
                        swap: 0.0,
                        profit: val.get("profit").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        close_reason: val.get("close_reason").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        mfe_pips: val.get("mfe_pips").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        mae_pips: val.get("mae_pips").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        spread_entry: val.get("spread_entry").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        volatility: val.get("volatility").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        volume_60s: val.get("volume_60s").and_then(|v| v.as_u64()).unwrap_or(0),
                        accumulated_real_time: val.get("accumulated_real_time").and_then(|v| v.as_f64()).unwrap_or(0.0),
                    };
                    let core_opt = state.core_handle.lock().unwrap().clone();
                    if let Some(core) = core_opt {
                        core.restore_history(hist);
                    }
                    return Ok(());
                }
                _ => {}
            }

            if command == "INIT" {
                // JFX 実行フィードのロード & 単一 TickStore の構築 (重複メモリを保持しない)
                let source_sym = val.get("source_symbol").and_then(|s| s.as_str()).unwrap_or("USDJPY");
                let st = val.get("start_time").and_then(|s| s.as_str()).unwrap_or("");
                let et = val.get("end_time").and_then(|s| s.as_str()).unwrap_or("");
                let balance = val.get("initial_balance").and_then(|b| b.as_f64()).unwrap_or(1_000_000.0);
                let contract_size = val.get("contract_size").and_then(|c| c.as_f64()).unwrap_or(10_000.0);
                let leverage = val.get("leverage").and_then(|l| l.as_f64()).unwrap_or(25.0);
                let hedging = val.get("hedging").and_then(|h| h.as_bool()).unwrap_or(false);
                let latency_ms = val.get("latency_ms").and_then(|l| l.as_i64()).unwrap_or(0);

                // --- Replay Core v2 自律駆動エンジンの初期化 ---
                let render_pipe_opt = state.render_pipe_handle.lock().unwrap().clone();
                let is_renderer_connected = render_pipe_opt.as_ref().map(|p| p.is_connected()).unwrap_or(false);
                println!("[commands_replay] Replay Core v2 自律駆動モードで初期化を開始します (RendererEA接続={})", is_renderer_connected);

                // 1. 単一 TickStore の直接構築
                let (store, is_real_jfx) = match crate::jfx_feed::JfxExecutionFeed::load(source_sym, st, et, None) {
                    Ok(feed) => {
                        let is_real = feed.is_real_jfx;
                        let count = feed.ticks.len();
                        let ts = crate::core::store::TickStore::from_execution_ticks(&feed.ticks);
                        println!("[commands_replay] 単一TickStore構築完了: real={}, ticks={}", is_real, count);
                        (ts, is_real)
                    }
                    Err(e) => {
                        eprintln!("[commands_replay] JFX実行フィード初期化失敗: {}", e);
                        (crate::core::store::TickStore::empty(), false)
                    }
                };

                let total_ticks = store.len() as u64;
                let first_msc = store.min_time_msc().unwrap_or(0);

                // 2. 既存の Core ハンドルがあれば停止
                if let Some(old_handle) = state.core_handle.lock().unwrap().take() {
                    old_handle.shutdown();
                }
                if let Some(old_join) = state.core_join_handle.lock().unwrap().take() {
                    old_join.abort();
                }

                *state.tick_store.lock().unwrap() = Some(store.clone());

                // 3. Replay Core の起動
                let (core_handle, core_join) = crate::core::ReplayCore::start_with_sinks(
                    store,
                    None,
                    render_pipe_opt.clone(),
                    None,
                );
                core_handle.reset_account_with_balance(balance);
                core_handle.set_contract_size(contract_size);
                core_handle.set_leverage(leverage);
                core_handle.set_hedging(hedging);
                let latency_model = if latency_ms <= 0 {
                    crate::core::types::LatencyModel::Zero
                } else {
                    crate::core::types::LatencyModel::Fixed { latency_ms: latency_ms as u32 }
                };
                core_handle.set_latency_model(latency_model);

                state.playback.lock().unwrap().is_playing = false;
                *state.core_handle.lock().unwrap() = Some(core_handle.clone());
                *state.core_join_handle.lock().unwrap() = Some(core_join);

                // 4. MT5 Renderer EA へ INIT パケットを送信 (カスタムシンボル・ティック・過去足事前描画・プロファイルチャートの一括構築)
                let profile_name = val.get("profile_name").and_then(|s| s.as_str()).unwrap_or("");
                let sub_sym = val.get("sub_source_symbol").and_then(|s| s.as_str()).unwrap_or("");
                let additional_symbols = val.get("additional_symbols").and_then(|s| s.as_str()).unwrap_or("");
                let preloaded_bars = val.get("preloaded_bars").and_then(|b| b.as_u64()).unwrap_or(300) as u32;
                let preload_mode_str = val.get("preload_mode").and_then(|m| m.as_str()).unwrap_or("BARS");
                let preload_mode = if preload_mode_str == "DATE" { 1u32 } else { 0u32 };
                let preload_date_str = val.get("preload_date").and_then(|d| d.as_str()).unwrap_or("");
                let raw_start_msc = jst_to_server_time_msc(st).unwrap_or(first_msc);
                let end_msc = jst_to_server_time_msc(et).unwrap_or(0);
                let preload_date_msc = jst_to_server_time_msc(preload_date_str).unwrap_or(0);

                // 指定開始時刻がデータの先頭時刻より前である場合は、データが存在する先頭時刻に補正してMT5描画とCoreクロックを完全に一致させる
                let effective_start_msc = if first_msc > 0 && (raw_start_msc <= 0 || raw_start_msc < first_msc) {
                    println!("[commands_replay] 指定開始時刻({})がデータ先頭({})より前のため、データ先頭に自動補正します", raw_start_msc, first_msc);
                    first_msc
                } else {
                    raw_start_msc
                };

                if let Some(ref pipe) = render_pipe_opt {
                    pipe.send_init(
                        1,
                        effective_start_msc,
                        end_msc,
                        preload_date_msc,
                        preloaded_bars,
                        preload_mode,
                        source_sym,
                        sub_sym,
                        profile_name,
                        additional_symbols,
                    );
                    println!("[commands_replay] MT5 Renderer EA へ INIT 要求送信: sym={}, profile={}, sync={}, start_msc={}", source_sym, profile_name, additional_symbols, effective_start_msc);
                }

                // Replay Core の初期時刻を effective_start_msc にシーク
                if effective_start_msc > 0 {
                    core_handle.seek_time(effective_start_msc);
                }
                *state.current_virtual_time_msc.lock().unwrap() = effective_start_msc;

                // 5. Core ステータスを フロントエンド & WebSocket へ継続ストリーミングする UI Streamer タスクを起動
                let mut rx = core_handle.subscribe();
                let app_h = app_handle.clone();
                let state_c = state.inner().clone();
                tauri::async_runtime::spawn(async move {
                    #[derive(serde::Serialize)]
                    struct UiStreamPayload<'a> {
                        status: &'static str,
                        is_playing: bool,
                        current_idx: u64,
                        total_ticks: u64,
                        virtual_time_msc: i64,
                        speed_mode: &'static str,
                        multiplier: f64,
                        tick_step: i32,
                        trade_revision: u64,
                        history_revision: u64,
                        seek_epoch: u64,
                        #[serde(skip_serializing_if = "Option::is_none")]
                        bid: Option<f64>,
                        #[serde(skip_serializing_if = "Option::is_none")]
                        ask: Option<f64>,
                        #[serde(skip_serializing_if = "Option::is_none")]
                        spread: Option<f64>,
                        #[serde(skip_serializing_if = "Option::is_none")]
                        jfx_bid: Option<f64>,
                        #[serde(skip_serializing_if = "Option::is_none")]
                        jfx_ask: Option<f64>,
                        #[serde(skip_serializing_if = "Option::is_none")]
                        jfx_spread: Option<f64>,
                        jfx_real: bool,
                        account: &'a crate::virtual_trading::VirtualAccount,
                        positions: &'a [crate::virtual_trading::VirtualPosition],
                        #[serde(skip_serializing_if = "Option::is_none")]
                        execution_audits: Option<&'a [crate::core::journal::ExecutionAuditRecord]>,
                        #[serde(skip_serializing_if = "Option::is_none")]
                        history: Option<&'a [crate::virtual_trading::VirtualPosition]>,
                        pub time_stop_seconds: u32,
                        pub time_stop_enabled: bool,
                    }

                    let mut last_trade_rev = 0u64;
                    while rx.changed().await.is_ok() {
                        let (cur_msc, is_playing, hist_json_opt, json_str) = {
                            let snap = rx.borrow_and_update();
                            let cur_msc = snap.virtual_time_msc;
                            let is_playing = snap.is_playing;
                            let hist_json_opt = snap.history.as_ref().and_then(|h| serde_json::to_value(h).ok());

                            let bid = snap.current_tick.map(|t| t.bid);
                            let ask = snap.current_tick.map(|t| t.ask);
                            let spread = snap.current_tick.map(|t| ((t.ask - t.bid) * 100.0).round() / 100.0);

                            let execution_audits = if snap.trade_revision != last_trade_rev {
                                last_trade_rev = snap.trade_revision;
                                if !snap.latest_audits.is_empty() {
                                    *state_c.latest_audits.lock().unwrap() = (*snap.latest_audits).clone();
                                }
                                Some(snap.latest_audits.as_slice())
                            } else {
                                None
                            };

                            let payload = UiStreamPayload {
                                status: if is_playing { "ACTIVE" } else { "READY" },
                                is_playing,
                                current_idx: snap.current_index,
                                total_ticks: snap.total_ticks,
                                virtual_time_msc: cur_msc,
                                speed_mode: match snap.speed_mode {
                                    crate::core::types::PlaybackMode::Temporal => "TEMPORAL",
                                    crate::core::types::PlaybackMode::Count => "COUNT",
                                },
                                multiplier: snap.multiplier,
                                tick_step: 1,
                                trade_revision: snap.trade_revision,
                                history_revision: snap.history_revision,
                                seek_epoch: snap.seek_epoch,
                                bid,
                                ask,
                                spread,
                                jfx_bid: bid,
                                jfx_ask: ask,
                                jfx_spread: spread,
                                jfx_real: is_real_jfx,
                                account: &snap.account,
                                positions: &snap.positions,
                                execution_audits,
                                history: snap.history.as_deref(),
                                time_stop_seconds: snap.time_stop_seconds,
                                time_stop_enabled: snap.time_stop_enabled,
                            };

                            let s = serde_json::to_string(&payload).unwrap_or_default();
                            (cur_msc, is_playing, hist_json_opt, s)
                        };

                        *state_c.current_virtual_time_msc.lock().unwrap() = cur_msc;
                        state_c.playback.lock().unwrap().is_playing = is_playing;
                        if let Some(hist_val) = hist_json_opt {
                            *state_c.last_history.lock().unwrap() = Some(hist_val);
                        }
                        if !json_str.is_empty() {
                            *state_c.last_status.lock().unwrap() = json_str.clone();
                            let _ = app_h.emit("mt5-status", &json_str);
                            let _ = state_c.sync_tx.send(json_str);
                        }
                    }
                });

                // 6. 即座にフロントエンドへ READY ステータスを送信して UI 遷移を完了させる
                let snap = core_handle.status();
                let hist_val = snap
                    .history
                    .as_ref()
                    .and_then(|h| serde_json::to_value(h).ok())
                    .unwrap_or_else(|| serde_json::json!([]));
                *state.last_history.lock().unwrap() = Some(hist_val.clone());

                let initial_status = serde_json::json!({
                    "status": "READY",
                    "is_playing": false,
                    "current_idx": 0,
                    "total_ticks": total_ticks,
                    "virtual_time_msc": effective_start_msc,
                    "speed_mode": "TEMPORAL",
                    "multiplier": 1.0,
                    "tick_step": 1,
                    "seek_epoch": snap.seek_epoch,
                    "trade_revision": snap.trade_revision,
                    "history_revision": snap.history_revision,
                    "account": snap.account,
                    "positions": snap.positions,
                    "history": hist_val,
                    "message": "Replay Core v2 初期化完了",
                });
                let init_str = initial_status.to_string();
                *state.last_status.lock().unwrap() = init_str.clone();
                let _ = app_handle.emit("mt5-status", &init_str);
                let _ = state.sync_tx.send(init_str);

                // 4. ワークスペースのワンクリック完全自動連動:
                // スピード発注画面の自動表示 (前回の位置/サイズ/最前面)
                let _ = crate::commands_window::open_speed_order_window(app_handle.clone()).await;

                // tick-scope-replay.exe の自動起動 (前回の位置/サイズ、同一銘柄・データパス・WSポート)
                let tick_dir = crate::custom_symbol::get_default_tick_dir();
                let candidates = [
                    std::path::PathBuf::from(r"D:\DevCache\cargo-target\release\tick-scope-replay.exe"),
                    std::path::PathBuf::from(r"D:\DevCache\cargo-target\debug\tick-scope-replay.exe"),
                    std::path::PathBuf::from(r"d:\dev\TickScope\target\release\tick-scope-replay.exe"),
                    std::path::PathBuf::from(r"d:\dev\TickScope\target\debug\tick-scope-replay.exe"),
                ];

                let mut existing_candidates: Vec<std::path::PathBuf> = candidates
                    .into_iter()
                    .filter(|p| p.exists())
                    .collect();
                // Pick the candidate with the newest modification timestamp
                existing_candidates.sort_by_key(|p| {
                    std::fs::metadata(p)
                        .and_then(|m| m.modified())
                        .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
                });
                let replay_bin = existing_candidates.last();
                if let Some(bin_path) = replay_bin {
                    let mut child_guard = state.tick_scope_child.lock().unwrap();
                    if let Some(mut existing) = child_guard.take() {
                        let _ = existing.kill();
                        let _ = existing.wait();
                    }

                    let clean_sym = source_sym.split(['.', '_', '/']).next().unwrap_or(source_sym);
                    let mut cmd = std::process::Command::new(bin_path);
                    cmd.arg("--ws").arg("ws://127.0.0.1:49210")
                       .arg("--tick-dir").arg(&tick_dir)
                       .arg("--symbol").arg(clean_sym);

                    match cmd.spawn() {
                        Ok(child) => {
                            state.job_guard.assign_child(&child);
                            println!("[commands_replay] TickScope Replay 自動起動成功: {} (銘柄: {}, tick_dir: {})", bin_path.display(), clean_sym, tick_dir.display());
                            *child_guard = Some(child);
                        }
                        Err(e) => {
                            eprintln!("[commands_replay] TickScope Replay 起動エラー: {}", e);
                        }
                    }
                } else {
                    println!("[commands_replay] tick-scope-replay.exe が見つかりませんでした。手動起動またはビルドを確認してください。");
                }


                return Ok(());
            }
        }
    }

    dispatch_replay_command(&state, &final_cmd_json, Some(&app_handle))
}

#[tauri::command]
pub async fn read_trade_ticks(app_handle: AppHandle, ticket: i32) -> Result<String, AppError> {
    let state = app_handle.state::<Arc<ReplayState>>();

    let mut time_range = None;
    if let Some(ref hist_val) = *state.last_history.lock().unwrap() {
        if let Some(arr) = hist_val.as_array() {
            for item in arr {
                if item.get("ticket").and_then(|t| t.as_i64()) == Some(ticket as i64) {
                    if let (Some(open_msc), Some(close_msc)) = (
                        item.get("open_time_msc").and_then(|t| t.as_i64()),
                        item.get("close_time_msc").and_then(|t| t.as_i64()),
                    ) {
                        time_range = Some((open_msc, close_msc));
                        break;
                    }
                }
            }
        }
    }

    if let Some((open_msc, close_msc)) = time_range {
        let store_guard = state.tick_store.lock().unwrap();
        if let Some(ref store) = *store_guard {
            if let Some((start_idx, end_idx)) = store.range_for_time_interval(open_msc, close_msc) {
                let slice = store.slice(start_idx, end_idx);
                if let Ok(json) = serde_json::to_string(slice) {
                    return Ok(json);
                }
            }
        }
    }

    Ok("[]".to_string())
}

#[tauri::command]
pub async fn get_last_status(state: State<'_, Arc<ReplayState>>) -> Result<String, AppError> {
    let mut last = state.last_status.lock().unwrap();
    let render_pipe_opt = state.render_pipe_handle.lock().unwrap().clone();
    let is_connected = render_pipe_opt.as_ref().map(|p| p.is_connected()).unwrap_or(false);

    if is_connected {
        let need_update = if last.is_empty() {
            true
        } else if let Ok(val) = serde_json::from_str::<serde_json::Value>(&last) {
            val.get("status").and_then(|s| s.as_str()) == Some("DISCONNECTED")
        } else {
            false
        };

        if need_update {
            let status_val = serde_json::json!({
                "status": "CONNECTED",
                "message": "MT5 Renderer EA connected",
                "protocol": "TRR2",
                "symbol": "USDJPY",
            });
            *last = status_val.to_string();
        }
    }
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

#[tauri::command]
pub async fn get_core_v2_status(
    state: State<'_, Arc<ReplayState>>,
) -> Result<Option<crate::core::types::CoreStatusSnapshot>, AppError> {
    let handle_guard = state.core_handle.lock().unwrap();
    Ok(handle_guard.as_ref().map(|h| h.status()))
}

#[tauri::command]
pub async fn set_use_core_v2(
    _enabled: bool,
    _state: State<'_, Arc<ReplayState>>,
) -> Result<(), AppError> {
    // 新アーキテクチャでは常に Replay Core v2 に一本化
    Ok(())
}

#[tauri::command]
pub async fn is_use_core_v2(
    _state: State<'_, Arc<ReplayState>>,
) -> Result<bool, AppError> {
    // 新アーキテクチャでは常に true
    Ok(true)
}

#[tauri::command]
pub async fn get_execution_audit_log(
    state: State<'_, Arc<ReplayState>>,
) -> Result<Vec<crate::core::journal::ExecutionAuditRecord>, AppError> {
    Ok(state.latest_audits.lock().unwrap().clone())
}

#[tauri::command]
pub async fn set_execution_models(
    latency_model: Option<crate::core::types::LatencyModel>,
    slippage_model: Option<crate::core::types::SlippageModel>,
    state: State<'_, Arc<ReplayState>>,
) -> Result<(), AppError> {
    let handle_guard = state.core_handle.lock().unwrap();
    if let Some(ref handle) = *handle_guard {
        if let Some(model) = latency_model {
            handle.set_latency_model(model);
        }
        if let Some(model) = slippage_model {
            handle.set_slippage_model(model);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_day_timeline_activity(
    virtual_time_msc: Option<i64>,
    app_handle: tauri::AppHandle,
    state: State<'_, Arc<ReplayState>>,
) -> Result<crate::core::volatility::DayTimelineActivity, AppError> {
    let v_time = virtual_time_msc.unwrap_or_else(|| {
        *state.current_virtual_time_msc.lock().unwrap()
    });

    let (min_floor, max_cap) = match crate::commands_settings::load_settings(app_handle).await {
        Ok(Some(settings)) => (
            settings.timeline_activity_min_floor.unwrap_or(1500),
            settings.timeline_activity_max_cap.unwrap_or(2800),
        ),
        _ => (1500, 2800),
    };

    let store_guard = state.tick_store.lock().unwrap();
    if let Some(ref store) = *store_guard {
        Ok(crate::core::volatility::compute_day_timeline_activity(store, v_time, min_floor, max_cap))
    } else {
        Ok(crate::core::volatility::DayTimelineActivity::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{NaiveDate, NaiveDateTime, NaiveTime};

    fn make_ts(year: i32, month: u32, day: u32, hour: u32, min: u32, sec: u32) -> i64 {
        let date = NaiveDate::from_ymd_opt(year, month, day).unwrap();
        let time = NaiveTime::from_hms_opt(hour, min, sec).unwrap();
        let dt = NaiveDateTime::new(date, time);
        dt.and_utc().timestamp_millis()
    }

    #[test]
    fn test_calculate_session_jump_target_forward_winter() {
        // 2024-01-15 は月曜日、冬時間 (GMT+2)
        // TYO: 01:45, LDN: 10:00, NY: 15:00
        let cur = make_ts(2024, 1, 15, 0, 0, 0);

        // +TYO -> 2024-01-15 01:45:00
        let target_tyo = calculate_session_jump_target(cur, "TYO", true);
        assert_eq!(target_tyo, make_ts(2024, 1, 15, 1, 45, 0));

        // +LDN -> 2024-01-15 10:00:00
        let target_ldn = calculate_session_jump_target(cur, "LDN", true);
        assert_eq!(target_ldn, make_ts(2024, 1, 15, 10, 0, 0));

        // +NY -> 2024-01-15 15:00:00
        let target_ny = calculate_session_jump_target(cur, "NY", true);
        assert_eq!(target_ny, make_ts(2024, 1, 15, 15, 0, 0));

        // +ANY -> 2024-01-15 01:45:00 (直近の次セッションは TYO)
        let target_any = calculate_session_jump_target(cur, "ANY", true);
        assert_eq!(target_any, make_ts(2024, 1, 15, 1, 45, 0));

        // 02:00 から +ANY -> 2024-01-15 10:00:00 (LDN)
        let cur_mid = make_ts(2024, 1, 15, 2, 0, 0);
        assert_eq!(
            calculate_session_jump_target(cur_mid, "ANY", true),
            make_ts(2024, 1, 15, 10, 0, 0)
        );
    }

    #[test]
    fn test_calculate_session_jump_target_forward_summer() {
        // 2024-06-17 は月曜日、夏時間 (GMT+3)
        // TYO: 02:45, LDN: 10:00, NY: 15:00
        let cur = make_ts(2024, 6, 17, 0, 0, 0);

        // +TYO -> 2024-06-17 02:45:00
        let target_tyo = calculate_session_jump_target(cur, "TYO", true);
        assert_eq!(target_tyo, make_ts(2024, 6, 17, 2, 45, 0));
    }

    #[test]
    fn test_calculate_session_jump_target_weekend_skip() {
        // 金曜日 2024-01-19 16:00:00 (NY市場開始後)
        let cur_fri_night = make_ts(2024, 1, 19, 16, 0, 0);

        // +TYO -> 土日(20, 21)をスキップして月曜 2024-01-22 01:45:00 (冬時間)
        let target_mon_tyo = calculate_session_jump_target(cur_fri_night, "TYO", true);
        assert_eq!(target_mon_tyo, make_ts(2024, 1, 22, 1, 45, 0));
    }

    #[test]
    fn test_calculate_session_jump_target_rewind_weekend_skip() {
        // 月曜日 2024-01-22 01:00:00 (東京前)
        let cur_mon_dawn = make_ts(2024, 1, 22, 1, 0, 0);

        // -ANY -> 日・土をスキップして金曜 2024-01-19 15:00:00 (NY)
        let target_fri_ny = calculate_session_jump_target(cur_mon_dawn, "ANY", false);
        assert_eq!(target_fri_ny, make_ts(2024, 1, 19, 15, 0, 0));

        // -TYO -> 金曜 2024-01-19 01:45:00 (TYO)
        let target_fri_tyo = calculate_session_jump_target(cur_mon_dawn, "TYO", false);
        assert_eq!(target_fri_tyo, make_ts(2024, 1, 19, 1, 45, 0));
    }

    #[test]
    fn test_calculate_session_jump_target_dst_transition() {
        // 2024年の米国夏時間開始は 2024-03-10（日）。
        // 金曜 2024-03-08 は冬時間 (GMT+2)
        // 月曜 2024-03-11 は夏時間 (GMT+3)
        // 金曜夜 2024-03-08 16:00:00 から +TYO で次週月曜にジャンプする場合、
        // ジャンプ先 2024-03-11 では夏時間なので 02:45:00 になる必要がある。
        let cur_fri_night = make_ts(2024, 3, 8, 16, 0, 0);
        let target_mon_tyo = calculate_session_jump_target(cur_fri_night, "TYO", true);
        assert_eq!(target_mon_tyo, make_ts(2024, 3, 11, 2, 45, 0));

        // 逆に月曜早朝 2024-03-11 01:00:00 (夏時間) から -TYO で巻き戻す場合、
        // ジャンプ先 2024-03-08 は冬時間なので 01:45:00 になる必要がある。
        let cur_mon_dawn = make_ts(2024, 3, 11, 1, 0, 0);
        let target_fri_tyo = calculate_session_jump_target(cur_mon_dawn, "TYO", false);
        assert_eq!(target_fri_tyo, make_ts(2024, 3, 8, 1, 45, 0));
    }
}
