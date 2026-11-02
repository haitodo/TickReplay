use std::net::SocketAddr;
use std::sync::Arc;
use futures_util::{SinkExt, StreamExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
use tokio_tungstenite::tungstenite::Message;
use crate::state::ReplayState;
use crate::core::types::CoreStatusSnapshot;

pub const DEFAULT_SYNC_PORT: u16 = 49210;

#[derive(Default)]
struct ClientTradeCursor {
    history: Option<(u64, Arc<Vec<crate::virtual_trading::VirtualPosition>>)>,
    audits: Option<(u64, Arc<Vec<crate::core::journal::ExecutionAuditRecord>>)>,
}

impl ClientTradeCursor {
    fn merge_snapshot(&mut self, value: &mut serde_json::Value, snap: &CoreStatusSnapshot, force: bool) {
        // The outbound watch may have skipped the frame containing a history delta.
        // Use one complete core snapshot so the repaired history matches its account and revisions.
        value["account"] = serde_json::json!(&snap.account);
        value["positions"] = serde_json::json!(&snap.positions);
        value["trade_revision"] = serde_json::json!(snap.trade_revision);
        value["history_revision"] = serde_json::json!(snap.history_revision);
        value["seek_epoch"] = serde_json::json!(snap.seek_epoch);
        value["virtual_time_msc"] = serde_json::json!(snap.virtual_time_msc);
        value["current_idx"] = serde_json::json!(snap.current_index);
        value["total_ticks"] = serde_json::json!(snap.total_ticks);
        value["is_playing"] = serde_json::json!(snap.is_playing);
        value["multiplier"] = serde_json::json!(snap.multiplier);
        value["speed_mode"] = serde_json::json!(snap.speed_mode);
        value["time_stop_seconds"] = serde_json::json!(snap.time_stop_seconds);
        value["time_stop_enabled"] = serde_json::json!(snap.time_stop_enabled);
        if let Some(tick) = snap.current_tick {
            value["bid"] = serde_json::json!(tick.bid);
            value["ask"] = serde_json::json!(tick.ask);
            value["spread"] = serde_json::json!(((tick.ask - tick.bid) * 100.0).round() / 100.0);
            value["jfx_bid"] = value["bid"].clone();
            value["jfx_ask"] = value["ask"].clone();
            value["jfx_spread"] = value["spread"].clone();
        }

        // Pointer identity also detects a new replay whose revisions happen to match the old one.
        let history_changed = self.history.as_ref().is_none_or(|(revision, history)| {
            *revision != snap.history_revision || !Arc::ptr_eq(history, &snap.history)
        });
        if force || history_changed {
            value["history"] = serde_json::json!(&snap.history);
            self.history = Some((snap.history_revision, Arc::clone(&snap.history)));
        } else if let Some(object) = value.as_object_mut() {
            object.remove("history");
        }
        let audits_changed = self.audits.as_ref().is_none_or(|(revision, audits)| {
            *revision != snap.trade_revision || !Arc::ptr_eq(audits, &snap.latest_audits)
        });
        if force || audits_changed {
            value["execution_audits"] = serde_json::json!(&snap.latest_audits);
            self.audits = Some((snap.trade_revision, Arc::clone(&snap.latest_audits)));
        } else if let Some(object) = value.as_object_mut() {
            object.remove("execution_audits");
        }
    }
}

fn client_status_json(
    state: &ReplayState,
    cursor: &mut ClientTradeCursor,
    base_status: &str,
    force: bool,
) -> String {
    let mut value = serde_json::from_str::<serde_json::Value>(base_status)
        .ok().filter(|v| v.is_object())
        .unwrap_or_else(|| serde_json::json!({"status": "READY"}));
    // Shutdown can leave the last core snapshot marked Playing. Lifecycle messages
    // must retain their own state instead of being merged with that stale snapshot.
    if value["status"] == "TERMINATE" || value["command"] == "TERMINATE" {
        *cursor = ClientTradeCursor::default();
        return value.to_string();
    }
    let snapshot = state.core_handle.lock().unwrap().as_ref().map(|core| core.status());
    if let Some(snapshot) = snapshot {
        cursor.merge_snapshot(&mut value, &snapshot, force);
    } else if force {
        value["history"] = state.last_history.lock().unwrap().clone()
            .unwrap_or_else(|| serde_json::json!([]));
        value["execution_audits"] = serde_json::json!(&*state.latest_audits.lock().unwrap());
    }
    value.to_string()
}

/// 同期サーバーのインスタンス
pub struct SyncServer {
    tx: watch::Sender<String>,
}

impl SyncServer {
    pub fn new() -> (Self, watch::Sender<String>) {
        let (tx, _) = watch::channel(String::new());
        (Self { tx: tx.clone() }, tx)
    }

    pub async fn run(self, state: Arc<ReplayState>, port: u16) {
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        let listener = match TcpListener::bind(&addr).await {
            Ok(l) => {
                println!("[SyncServer] WebSocket サーバー起動: ws://{}", addr);
                l
            }
            Err(e) => {
                eprintln!("[SyncServer] ポート {} のバインドに失敗しました: {}", port, e);
                return;
            }
        };

        loop {
            match listener.accept().await {
                Ok((stream, peer_addr)) => {
                    let state_clone = state.clone();
                    let rx = self.tx.subscribe();

                    tokio::spawn(async move {
                        handle_connection(stream, peer_addr, state_clone, rx).await;
                    });
                }
                Err(e) => {
                    eprintln!("[SyncServer] クライアント接続受付エラー: {}", e);
                }
            }
        }
    }
}

async fn handle_connection(
    stream: TcpStream,
    peer_addr: SocketAddr,
    state: Arc<ReplayState>,
    mut rx: watch::Receiver<String>,
) {
    println!("[SyncServer] 外部クライアント接続: {}", peer_addr);

    let ws_stream = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("[SyncServer] WebSocket ハンドシェイク失敗 ({}): {}", peer_addr, e);
            return;
        }
    };

    let (mut write, mut read) = ws_stream.split();
    let mut cursor = ClientTradeCursor::default();

    // 接続直後: 現在の最新ステータス（取引履歴キャッシュを含む）を即座に送信して同期を確立
    let initial_status = {
        let current = rx.borrow_and_update().clone();
        let base_status = if !current.is_empty() {
            current
        } else {
            state.last_status.lock().unwrap().clone()
        };

        client_status_json(&state, &mut cursor, &base_status, true)
    };
    if write.send(Message::Text(initial_status.into())).await.is_err() {
        return;
    }

    loop {
        tokio::select! {
            // watchチャネルの更新を検知して最新メッセージを送信（遅延時は最新フレームのみ自動集約・ゼロラグ配信）
            changed_res = rx.changed() => {
                match changed_res {
                    Ok(()) => {
                        let msg = rx.borrow_and_update().clone();
                        if !msg.is_empty() {
                            let status = client_status_json(&state, &mut cursor, &msg, false);
                            if let Err(e) = write.send(Message::Text(status.into())).await {
                                println!("[SyncServer] クライアント {} 送信エラー: {}", peer_addr, e);
                                break;
                            }
                        }
                    }
                    Err(_) => {
                        break;
                    }
                }
            }
            // クライアントからの受信（コマンド送信など）
            msg_opt = read.next() => {
                match msg_opt {
                    Some(Ok(Message::Text(text))) => {
                        let text_str = text.to_string();
                        // 取引履歴の明示的リクエストを受信した場合、キャッシュまたは取引エンジンから即座に直接返信
                        if text_str.contains("REQUEST_HISTORY") || text_str.contains("GET_HISTORY") {
                            let last = state.last_status.lock().unwrap().clone();
                            let response = client_status_json(&state, &mut cursor, &last, true);
                            let _ = write.send(Message::Text(response.into())).await;
                        }
                        // Drenhis 等からのコマンド（SEEK, SEEK_TIME, CONTROL, etc.）を Replay Core v2 に直接ディスパッチ
                        if let Err(e) = crate::commands_replay::dispatch_replay_command(&state, &text_str, None) {
                            eprintln!("[SyncServer] コマンドディスパッチエラー: {}", e);
                        }
                    }
                    Some(Ok(Message::Ping(p))) => {
                        let _ = write.send(Message::Pong(p)).await;
                    }
                    Some(Ok(Message::Close(_))) => {
                        println!("[SyncServer] クライアント {} が切断しました", peer_addr);
                        break;
                    }
                    Some(Err(e)) => {
                        println!("[SyncServer] クライアント {} 受信エラー: {}", peer_addr, e);
                        break;
                    }
                    None => {
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    println!("[SyncServer] クライアント切断完了: {}", peer_addr);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::matching::CoreMatchingEngine;
    use crate::core::types::{CoreTick, OrderSide, PlaybackMode, PlaybackState};

    fn closed_trade_snapshot() -> CoreStatusSnapshot {
        let mut engine = CoreMatchingEngine::default();
        let tick = CoreTick {
            index: 0, time_sec: 1, time_msc: 1000,
            bid: 150.0, ask: 150.005, last: 0.0, volume: 1, volume_real: 0.0, flags: 6,
        };
        engine.submit_order("USDJPY".into(), OrderSide::Buy, 1.0, 0.0, 0.0, None, 1000, false, Some(&tick));
        engine.close_position(1, None, "MANUAL".into(), 1000, false, Some(&tick));
        CoreStatusSnapshot {
            virtual_time_msc: 1000, is_playing: false, state: PlaybackState::Paused,
            multiplier: 1.0, speed_mode: PlaybackMode::Temporal,
            current_index: 0, total_ticks: 1, seek_epoch: 1,
            trade_revision: engine.revision(), history_revision: engine.history_revision,
            current_tick: Some(tick), loop_config: None,
            account: engine.account.clone(), positions: engine.positions.clone(),
            history: Arc::new(engine.history.clone()), latest_audits: Arc::new(engine.audit_log.clone()),
            time_stop_seconds: 0, time_stop_enabled: false,
        }
    }

    #[test]
    fn slow_websocket_receiver_recovers_history_from_the_complete_snapshot() {
        let snapshot = closed_trade_snapshot();
        let (sender, mut receiver) = watch::channel(String::new());
        sender.send(serde_json::json!({"history": &snapshot.history}).to_string()).unwrap();
        // A later status replaces the only frame containing the history delta.
        sender.send(serde_json::json!({"history_revision": snapshot.history_revision}).to_string()).unwrap();
        let mut value: serde_json::Value = serde_json::from_str(&receiver.borrow_and_update()).unwrap();
        assert!(value.get("history").is_none());

        let mut cursor = ClientTradeCursor::default();
        cursor.merge_snapshot(&mut value, &snapshot, false);
        assert_eq!(value["history"].as_array().unwrap().len(), 1);
        assert_eq!(value["account"]["balance"], serde_json::json!(snapshot.account.balance));
        assert_eq!(value["history_revision"], serde_json::json!(snapshot.history_revision));

        // A client that already has this revision receives small subsequent frames.
        cursor.merge_snapshot(&mut value, &snapshot, false);
        assert!(value.get("history").is_none());
        assert!(value.get("execution_audits").is_none());
        cursor.merge_snapshot(&mut value, &snapshot, true);
        assert_eq!(value["history"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn reset_and_new_replay_clear_stale_history_and_audits_even_when_revisions_match() {
        let snapshot = closed_trade_snapshot();
        let mut cursor = ClientTradeCursor::default();
        let mut value = serde_json::json!({});
        cursor.merge_snapshot(&mut value, &snapshot, true);
        assert_eq!(value["history"].as_array().unwrap().len(), 1);
        assert_eq!(value["execution_audits"].as_array().unwrap().len(), 1);

        let reset = CoreStatusSnapshot {
            history: Arc::new(Vec::new()), latest_audits: Arc::new(Vec::new()),
            ..snapshot.clone()
        };
        cursor.merge_snapshot(&mut value, &reset, false);
        assert_eq!(value["history"], serde_json::json!([]));
        assert_eq!(value["execution_audits"], serde_json::json!([]));
    }

    #[tokio::test]
    async fn terminate_preserves_lifecycle_state_even_with_a_playing_core_snapshot() {
        let (core, task) = crate::core::mod_test_helper::create_test_core();
        let mut receiver = core.subscribe();
        core.play();
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                let is_playing = receiver.borrow_and_update().is_playing;
                if is_playing { break; }
                receiver.changed().await.unwrap();
            }
        }).await.unwrap();

        let (sender, _) = watch::channel(String::new());
        let state = ReplayState::new(sender);
        *state.core_handle.lock().unwrap() = Some(core.clone());
        let mut cursor = ClientTradeCursor::default();
        cursor.merge_snapshot(&mut serde_json::json!({}), &core.status(), true);
        let termination = serde_json::json!({
            "status": "TERMINATE", "command": "TERMINATE", "is_playing": false,
        });
        let response = client_status_json(&state, &mut cursor, &termination.to_string(), false);
        assert_eq!(serde_json::from_str::<serde_json::Value>(&response).unwrap(), termination);
        assert!(cursor.history.is_none());
        assert!(cursor.audits.is_none());
        core.shutdown();
        task.await.unwrap();
    }
}
