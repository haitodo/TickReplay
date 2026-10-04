use std::sync::Arc;
use tauri::{AppHandle, State, Manager, Emitter};
use crate::error::AppError;
use crate::state::{ReplayState, SpeedMode};

pub fn emit_trading_status_update(
    app_handle: &AppHandle,
    state: &Arc<ReplayState>,
) {
    let mut last = state.last_status.lock().unwrap();
    let mut val: serde_json::Value = if !last.is_empty() {
        serde_json::from_str(&last).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({ "status": "ACTIVE" })
    };

    let v_time = *state.current_virtual_time_msc.lock().unwrap();
    let mut feed_guard = state.execution_feed.lock().unwrap();
    let current_quote = feed_guard.as_mut().and_then(|f| f.get_quote_at(v_time));

    let engine = state.trading_engine.lock().unwrap();

    if let Some(obj) = val.as_object_mut() {
        if let Some(ref quote) = current_quote {
            obj.insert("dmm_bid".to_string(), serde_json::json!(quote.bid));
            obj.insert("dmm_ask".to_string(), serde_json::json!(quote.ask));
            obj.insert("dmm_spread".to_string(), serde_json::json!(quote.spread));
            obj.insert("jfx_bid".to_string(), serde_json::json!(quote.bid));
            obj.insert("jfx_ask".to_string(), serde_json::json!(quote.ask));
            obj.insert("jfx_spread".to_string(), serde_json::json!(quote.spread));
            obj.insert("jfx_real".to_string(), serde_json::json!(quote.is_real));
        }
        obj.insert("account".to_string(), serde_json::to_value(&engine.account).unwrap_or_default());
        obj.insert("positions".to_string(), serde_json::to_value(&engine.positions).unwrap_or_default());
        obj.insert("history".to_string(), serde_json::to_value(&engine.history).unwrap_or_default());
    }

    if let Ok(json_str) = serde_json::to_string(&val) {
        *last = json_str.clone();
        let _ = app_handle.emit("mt5-status", &json_str);
        let _ = state.sync_tx.send(json_str);
    }
}

#[tauri::command]
pub async fn send_command(
    command_json: String,
    app_handle: AppHandle,
    state: State<'_, Arc<ReplayState>>,
) -> Result<(), AppError> {
    let mut final_cmd_json = command_json;
    if let Ok(mut val) = serde_json::from_str::<serde_json::Value>(&final_cmd_json) {
        if let Some(command) = val.get("command").and_then(|c| c.as_str()) {
            // --- 仮想取引エンジンのコマンド直接処理 (MT5 Named Pipe への転送不要) ---
            match command {
                "ORDER_OPEN" => {
                    let type_str = val.get("type").and_then(|t| t.as_str()).unwrap_or("BUY");
                    let volume = val.get("volume").and_then(|v| v.as_f64()).unwrap_or(1.0);
                    let sl_points = val.get("sl_points").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let tp_points = val.get("tp_points").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let v_time = *state.current_virtual_time_msc.lock().unwrap();
                    let is_playing = state.playback.lock().unwrap().is_playing;

                    let mut feed_guard = state.execution_feed.lock().unwrap();
                    if let Some(ref mut feed) = *feed_guard {
                        let mut engine = state.trading_engine.lock().unwrap();
                        let latency = engine.latency_ms;
                        let match_time = if !is_playing && latency > 0 {
                            v_time + latency
                        } else {
                            v_time
                        };
                        if let Some(quote) = feed.get_quote_at(match_time) {
                            let sym = feed.symbol.clone();
                            engine.open_order(&sym, type_str, volume, sl_points, tp_points, &quote, v_time, is_playing);
                            drop(engine);
                            drop(feed_guard);
                            emit_trading_status_update(&app_handle, &state);
                        }
                    }
                    return Ok(());
                }
                "ORDER_CLOSE" => {
                    let ticket = val.get("ticket").and_then(|t| t.as_i64()).unwrap_or(0) as i32;
                    let volume = val.get("volume").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let v_time = *state.current_virtual_time_msc.lock().unwrap();
                    let is_playing = state.playback.lock().unwrap().is_playing;

                    let mut feed_guard = state.execution_feed.lock().unwrap();
                    if let Some(ref mut feed) = *feed_guard {
                        let mut engine = state.trading_engine.lock().unwrap();
                        let latency = engine.latency_ms;
                        if is_playing && latency > 0 {
                            engine.pending_closes.push(crate::virtual_trading::PendingClose {
                                execute_after_msc: v_time + latency,
                                ticket,
                                volume,
                                reason: "MANUAL".to_string(),
                            });
                            drop(engine);
                            drop(feed_guard);
                            emit_trading_status_update(&app_handle, &state);
                        } else {
                            let match_time = if !is_playing && latency > 0 { v_time + latency } else { v_time };
                            if let Some(quote) = feed.get_quote_at(match_time) {
                                let is_buy = engine.positions.iter().find(|p| p.ticket == ticket).map(|p| p.r#type == "BUY").unwrap_or(true);
                                let close_price = if is_buy { quote.bid } else { quote.ask };
                                engine.close_position_by_ticket(ticket, volume, "MANUAL", close_price, match_time);
                                engine.recalculate_account(&quote);
                                drop(engine);
                                drop(feed_guard);
                                emit_trading_status_update(&app_handle, &state);
                            }
                        }
                    }
                    return Ok(());
                }
                "ORDER_CLOSE_ALL" => {
                    let v_time = *state.current_virtual_time_msc.lock().unwrap();
                    let is_playing = state.playback.lock().unwrap().is_playing;
                    let mut feed_guard = state.execution_feed.lock().unwrap();
                    if let Some(ref mut feed) = *feed_guard {
                        let mut engine = state.trading_engine.lock().unwrap();
                        let latency = engine.latency_ms;
                        if is_playing && latency > 0 {
                            let to_close: Vec<(i32, f64)> = engine.positions.iter().map(|p| (p.ticket, p.volume)).collect();
                            for (t, v) in to_close {
                                engine.pending_closes.push(crate::virtual_trading::PendingClose {
                                    execute_after_msc: v_time + latency,
                                    ticket: t,
                                    volume: v,
                                    reason: "MANUAL".to_string(),
                                });
                            }
                            drop(engine);
                            drop(feed_guard);
                            emit_trading_status_update(&app_handle, &state);
                        } else {
                            let match_time = if !is_playing && latency > 0 { v_time + latency } else { v_time };
                            if let Some(quote) = feed.get_quote_at(match_time) {
                                engine.close_all("MANUAL", &quote, match_time);
                                drop(engine);
                                drop(feed_guard);
                                emit_trading_status_update(&app_handle, &state);
                            }
                        }
                    }
                    return Ok(());
                }
                "ORDER_CLOSE_BUY" => {
                    let v_time = *state.current_virtual_time_msc.lock().unwrap();
                    let is_playing = state.playback.lock().unwrap().is_playing;
                    let mut feed_guard = state.execution_feed.lock().unwrap();
                    if let Some(ref mut feed) = *feed_guard {
                        let mut engine = state.trading_engine.lock().unwrap();
                        let latency = engine.latency_ms;
                        if is_playing && latency > 0 {
                            let to_close: Vec<(i32, f64)> = engine.positions.iter().filter(|p| p.r#type == "BUY").map(|p| (p.ticket, p.volume)).collect();
                            for (t, v) in to_close {
                                engine.pending_closes.push(crate::virtual_trading::PendingClose {
                                    execute_after_msc: v_time + latency,
                                    ticket: t,
                                    volume: v,
                                    reason: "MANUAL".to_string(),
                                });
                            }
                            drop(engine);
                            drop(feed_guard);
                            emit_trading_status_update(&app_handle, &state);
                        } else {
                            let match_time = if !is_playing && latency > 0 { v_time + latency } else { v_time };
                            if let Some(quote) = feed.get_quote_at(match_time) {
                                engine.close_buy("MANUAL", &quote, match_time);
                                drop(engine);
                                drop(feed_guard);
                                emit_trading_status_update(&app_handle, &state);
                            }
                        }
                    }
                    return Ok(());
                }
                "ORDER_CLOSE_SELL" => {
                    let v_time = *state.current_virtual_time_msc.lock().unwrap();
                    let is_playing = state.playback.lock().unwrap().is_playing;
                    let mut feed_guard = state.execution_feed.lock().unwrap();
                    if let Some(ref mut feed) = *feed_guard {
                        let mut engine = state.trading_engine.lock().unwrap();
                        let latency = engine.latency_ms;
                        if is_playing && latency > 0 {
                            let to_close: Vec<(i32, f64)> = engine.positions.iter().filter(|p| p.r#type == "SELL").map(|p| (p.ticket, p.volume)).collect();
                            for (t, v) in to_close {
                                engine.pending_closes.push(crate::virtual_trading::PendingClose {
                                    execute_after_msc: v_time + latency,
                                    ticket: t,
                                    volume: v,
                                    reason: "MANUAL".to_string(),
                                });
                            }
                            drop(engine);
                            drop(feed_guard);
                            emit_trading_status_update(&app_handle, &state);
                        } else {
                            let match_time = if !is_playing && latency > 0 { v_time + latency } else { v_time };
                            if let Some(quote) = feed.get_quote_at(match_time) {
                                engine.close_sell("MANUAL", &quote, match_time);
                                drop(engine);
                                drop(feed_guard);
                                emit_trading_status_update(&app_handle, &state);
                            }
                        }
                    }
                    return Ok(());
                }
                "ORDER_MODIFY" => {
                    let ticket = val.get("ticket").and_then(|t| t.as_i64()).unwrap_or(0) as i32;
                    let sl = val.get("sl").and_then(|s| s.as_f64());
                    let tp = val.get("tp").and_then(|t| t.as_f64());
                    let mut engine = state.trading_engine.lock().unwrap();
                    engine.modify_order(ticket, sl, tp);
                    drop(engine);
                    emit_trading_status_update(&app_handle, &state);
                    return Ok(());
                }
                "SET_CONTRACT_SIZE" => {
                    if let Some(size) = val.get("size").and_then(|s| s.as_f64()) {
                        state.trading_engine.lock().unwrap().contract_size = size;
                    }
                    return Ok(());
                }
                "SET_HEDGING" => {
                    if let Some(allowed) = val.get("allowed").and_then(|a| a.as_bool()) {
                        state.trading_engine.lock().unwrap().hedging = allowed;
                    }
                    return Ok(());
                }
                "SET_LATENCY" => {
                    if let Some(latency) = val.get("latency_ms").and_then(|l| l.as_i64()) {
                        state.trading_engine.lock().unwrap().latency_ms = latency;
                    }
                    return Ok(());
                }
                _ => {}
            }

            if command == "RESET" {
                state.seek_epoch.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                *state.last_eval_msc.lock().unwrap() = 0;
                let balance = state.trading_engine.lock().unwrap().account.balance;
                state.trading_engine.lock().unwrap().reset(balance);
                emit_trading_status_update(&app_handle, &state);
            } else if command == "SEEK" || command == "SEEK_TIME" || command == "SEEK_RELATIVE" || command == "TIME_JUMP" {
                state.seek_epoch.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                let target_time_opt = val.get("target_time_msc")
                    .or_else(|| val.get("virtual_time_msc"))
                    .or_else(|| val.get("target_time"))
                    .and_then(|v| v.as_i64());
                if let Some(target_time) = target_time_opt {
                    let cur_v = *state.current_virtual_time_msc.lock().unwrap();
                    if target_time < cur_v {
                        let mut feed_guard = state.execution_feed.lock().unwrap();
                        let quote = feed_guard.as_mut().and_then(|f| f.get_quote_at(target_time));
                        if let Some(ref q) = quote {
                            let mut engine = state.trading_engine.lock().unwrap();
                            engine.rewind_to(target_time, q);
                            drop(engine);
                            drop(feed_guard);
                            emit_trading_status_update(&app_handle, &state);
                        }
                    }
                    *state.current_virtual_time_msc.lock().unwrap() = target_time;
                    *state.last_eval_msc.lock().unwrap() = target_time;
                }
                // NOTE: When target_time is None (e.g. SEEK by target_index or SEEK_RELATIVE),
                // we preserve state.last_eval_msc so that ipc.rs can compare the newly arriving
                // virtual_time_msc against last_eval_msc and cleanly trigger engine.rewind_to!
            }

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
                // 1. スピード発注画面とポジション一覧をクローズ
                if let Some(speed_order) = app_handle.get_webview_window("speed_order") {
                    let _ = speed_order.close();
                }
                if let Some(positions) = app_handle.get_webview_window("positions") {
                    let _ = positions.close();
                }
                // 2. 自動連動起動された TickScope Replay プロセスを終了
                {
                    let mut child_guard = state.tick_scope_child.lock().unwrap();
                    if let Some(mut child) = child_guard.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                        println!("[commands_replay] TickScope Replay プロセス終了完了");
                    }
                }
                // 3. WebSocket経由でもTERMINATEをブロードキャスト
                let _ = state.sync_tx.send(r#"{"status":"TERMINATE","command":"TERMINATE"}"#.to_string());
            } else if command == "INIT" {
                // JFX 実行フィードのロード & 仮想取引エンジンのリセット
                let source_sym = val.get("source_symbol").and_then(|s| s.as_str()).unwrap_or("USDJPY");
                let st = val.get("start_time").and_then(|s| s.as_str()).unwrap_or("");
                let et = val.get("end_time").and_then(|s| s.as_str()).unwrap_or("");
                let balance = val.get("initial_balance").and_then(|b| b.as_f64()).unwrap_or(1_000_000.0);
                let contract_size = val.get("contract_size").and_then(|c| c.as_f64()).unwrap_or(10_000.0);
                let leverage = val.get("leverage").and_then(|l| l.as_f64()).unwrap_or(25.0);
                let hedging = val.get("hedging").and_then(|h| h.as_bool()).unwrap_or(false);
                let latency_ms = val.get("latency_ms").and_then(|l| l.as_i64()).unwrap_or(0);

                let feed_res = crate::jfx_feed::JfxExecutionFeed::load(source_sym, st, et, None);
                match feed_res {
                    Ok(feed) => {
                        let is_real = feed.is_real_jfx;
                        let count = feed.ticks.len();
                        *state.execution_feed.lock().unwrap() = Some(feed);
                        let mut engine = state.trading_engine.lock().unwrap();
                        engine.reset(balance);
                        engine.contract_size = contract_size;
                        engine.leverage = leverage;
                        engine.hedging = hedging;
                        engine.latency_ms = latency_ms;
                        *state.last_eval_msc.lock().unwrap() = 0;
                        println!("[commands_replay] JFX実行フィード初期化完了: real={}, ticks={}", is_real, count);
                    }
                    Err(e) => {
                        eprintln!("[commands_replay] JFX実行フィード初期化失敗: {}", e);
                    }
                }

                // --- Core v2 自律駆動エンジンの初期化 ---
                let render_pipe_opt = state.render_pipe_handle.lock().unwrap().clone();
                let is_renderer_connected = render_pipe_opt.as_ref().map(|p| p.is_connected()).unwrap_or(false);
                let use_v2 = state.use_core_v2.load(std::sync::atomic::Ordering::Relaxed) || is_renderer_connected;

                if use_v2 {
                    println!("[commands_replay] Replay Core v2 自律駆動モードで初期化を開始します (RendererEA接続={})", is_renderer_connected);

                    // 1. TickStore の構築
                    let store = {
                        let feed_guard = state.execution_feed.lock().unwrap();
                        if let Some(ref feed) = *feed_guard {
                            crate::core::store::TickStore::from_execution_ticks(&feed.ticks)
                        } else {
                            crate::core::store::TickStore::empty()
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

                    // 3. Replay Core の起動
                    let (core_handle, core_join) = crate::core::ReplayCore::start_with_sinks(
                        store,
                        None,
                        render_pipe_opt.clone(),
                        None,
                    );
                    *state.core_handle.lock().unwrap() = Some(core_handle.clone());
                    *state.core_join_handle.lock().unwrap() = Some(core_join);

                    // 4. MT5 Renderer EA へ RESET パケットを送信
                    if let Some(ref pipe) = render_pipe_opt {
                        pipe.send_reset(1, 0, 0, 0, 0);
                    }

                    // 5. Core ステータスを フロントエンド & WebSocket へ継続ストリーミングする UI Streamer タスクを起動
                    let mut rx = core_handle.subscribe();
                    let app_h = app_handle.clone();
                    let state_c = state.inner().clone();
                    tauri::async_runtime::spawn(async move {
                        while rx.changed().await.is_ok() {
                            let snap = rx.borrow().clone();
                            let cur_msc = snap.virtual_time_msc;
                            *state_c.current_virtual_time_msc.lock().unwrap() = cur_msc;

                            let status_val = serde_json::json!({
                                "status": if snap.is_playing { "ACTIVE" } else { "READY" },
                                "is_playing": snap.is_playing,
                                "current_idx": snap.current_index,
                                "total_ticks": snap.total_ticks,
                                "virtual_time_msc": cur_msc,
                                "speed_mode": match snap.speed_mode {
                                    crate::core::types::PlaybackMode::Temporal => "TEMPORAL",
                                    crate::core::types::PlaybackMode::Count => "COUNT",
                                },
                                "multiplier": snap.multiplier,
                                "tick_step": 1,
                                "trade_revision": snap.trade_revision,
                                "seek_epoch": snap.seek_epoch,
                                "bid": snap.current_tick.map(|t| t.bid),
                                "ask": snap.current_tick.map(|t| t.ask),
                                "spread": snap.current_tick.map(|t| ((t.ask - t.bid) * 100.0).round() / 100.0),
                            });
                            let json_str = status_val.to_string();
                            let _ = app_h.emit("mt5-status", &json_str);
                            let _ = state_c.sync_tx.send(json_str);
                        }
                    });

                    // 6. 即座にフロントエンドへ READY ステータスを送信して UI 遷移を完了させる
                    let initial_status = serde_json::json!({
                        "status": "READY",
                        "is_playing": false,
                        "current_idx": 0,
                        "total_ticks": total_ticks,
                        "virtual_time_msc": first_msc,
                        "speed_mode": "TEMPORAL",
                        "multiplier": 1.0,
                        "tick_step": 1,
                        "message": "Replay Core v2 初期化完了",
                    });
                    let init_str = initial_status.to_string();
                    let _ = app_handle.emit("mt5-status", &init_str);
                    let _ = state.sync_tx.send(init_str);
                }

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

                            let custom_dir = val.get("economic_data_dir").and_then(|s| s.as_str()).map(|s| s.to_string());

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
                                let cd = custom_dir.clone();
                                if let Ok((_, loaded_events)) = tokio::task::spawn_blocking(move || {
                                    crate::pseudo_dmm::load_and_check_economic_data_range(
                                        &sym,
                                        &st,
                                        &et,
                                        pm.as_deref(),
                                        pd.as_deref(),
                                        cd.as_deref(),
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

        // --- Core v2 へのコマンド転送 ---
        if let Some(command) = val.get("command").and_then(|c| c.as_str()) {
            let core_opt = state.core_handle.lock().unwrap().clone();
            if let Some(core) = core_opt {
                match command {
                    "PLAY" => core.play(),
                    "PAUSE" => core.pause(),
                    "CONTROL" => {
                        if let Some(playing) = val.get("is_playing").and_then(|p| p.as_bool()) {
                            if playing { core.play(); } else { core.pause(); }
                        }
                        if let Some(mult) = val.get("multiplier").and_then(|m| m.as_f64()) {
                            core.set_multiplier(mult);
                        }
                        if let Some(mode_val) = val.get("speed_mode").and_then(|s| s.as_str()) {
                            if mode_val == "COUNT" {
                                core.set_playback_mode(crate::core::types::PlaybackMode::Count);
                            } else {
                                core.set_playback_mode(crate::core::types::PlaybackMode::Temporal);
                            }
                        }
                    }
                    "SEEK" => {
                        if let Some(idx) = val.get("target_index").or_else(|| val.get("target_idx")).and_then(|i| i.as_i64()) {
                            core.seek_index(idx.max(0) as u64);
                        }
                    }
                    "SEEK_TIME" => {
                        if let Some(time_msc) = val.get("target_time_msc").or_else(|| val.get("virtual_time_msc")).and_then(|t| t.as_i64()) {
                            core.seek_time(time_msc);
                        }
                    }
                    "STEP" => {
                        let delta = val.get("delta").and_then(|d| d.as_i64()).unwrap_or(1);
                        core.step_ticks(delta);
                    }
                    "TIME_JUMP" => {
                        let delta_sec = val.get("delta_seconds").and_then(|d| d.as_i64()).unwrap_or(0);
                        core.step_time(delta_sec * 1000);
                    }
                    "LOOP_SET_A" => {
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
                    "LOOP_SET_B" => {
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
                    "LOOP_CLEAR" => {
                        core.set_ab_loop(None);
                    }
                    "RESET" => {
                        core.seek_index(0);
                    }
                    "TERMINATE" => {
                        core.shutdown();
                    }
                    _ => {}
                }
            }
        }
    }

    state.command_tx.send(final_cmd_json).map_err(|e| AppError::Config(e.to_string()))
}

#[tauri::command]
pub async fn read_trade_ticks(app_handle: AppHandle, ticket: i32) -> Result<String, AppError> {
    let state = app_handle.state::<Arc<ReplayState>>();
    
    // 1. Rust 仮想取引エンジンにキャッシュがあればそこから返す
    {
        let engine = state.trading_engine.lock().unwrap();
        if let Some(ticks) = engine.closed_tickets_ticks.get(&ticket) {
            if let Ok(json) = serde_json::to_string(ticks) {
                return Ok(json);
            }
        }
    }

    // 2. MT5 Files パスからのフォールバック読込
    let files_path = {
        let path_guard = state.files_path.lock().unwrap();
        path_guard.clone()
    };

    let Some(files_path) = files_path else {
        return Ok("[]".to_string());
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
    enabled: bool,
    state: State<'_, Arc<ReplayState>>,
) -> Result<(), AppError> {
    state.use_core_v2.store(enabled, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn is_use_core_v2(
    state: State<'_, Arc<ReplayState>>,
) -> Result<bool, AppError> {
    Ok(state.use_core_v2.load(std::sync::atomic::Ordering::SeqCst))
}

#[tauri::command]
pub async fn get_execution_audit_log(
    state: State<'_, Arc<ReplayState>>,
) -> Result<Vec<crate::core::journal::ExecutionAuditRecord>, AppError> {
    let handle_guard = state.core_handle.lock().unwrap();
    if let Some(ref handle) = *handle_guard {
        Ok(handle.status().latest_audits)
    } else {
        Ok(Vec::new())
    }
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
