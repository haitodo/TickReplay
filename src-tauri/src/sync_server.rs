use std::net::SocketAddr;
use std::sync::Arc;
use futures_util::{SinkExt, StreamExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
use tokio_tungstenite::tungstenite::Message;
use crate::state::ReplayState;

pub const DEFAULT_SYNC_PORT: u16 = 49210;

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

    // 接続直後: 現在の最新ステータス（取引履歴キャッシュを含む）を即座に送信して同期を確立
    let initial_status = {
        let current = rx.borrow_and_update().clone();
        let base_status = if !current.is_empty() {
            current
        } else {
            state.last_status.lock().unwrap().clone()
        };

        let mut val = if !base_status.is_empty() {
            serde_json::from_str::<serde_json::Value>(&base_status).unwrap_or_else(|_| serde_json::json!({"status": "READY"}))
        } else {
            serde_json::json!({"status": "READY"})
        };

        let (eng_hist, eng_acc, eng_pos, eng_rev) = {
            let eng = state.trading_engine.lock().unwrap();
            (
                serde_json::to_value(&eng.history).unwrap_or_else(|_| serde_json::json!([])),
                serde_json::to_value(&eng.account).ok(),
                serde_json::to_value(&eng.positions).ok(),
                eng.revision,
            )
        };

        let history_cache = state.last_history.lock().unwrap().clone();
        let hist = history_cache.unwrap_or(eng_hist);
        val["history"] = hist;

        if val.get("account").is_none() || val["account"].is_null() {
            if let Some(acc) = eng_acc {
                val["account"] = acc;
            }
        }
        if val.get("positions").is_none() || val["positions"].is_null() {
            if let Some(pos) = eng_pos {
                val["positions"] = pos;
            }
        }
        if val.get("trade_revision").is_none() || val["trade_revision"].is_null() {
            val["trade_revision"] = serde_json::json!(eng_rev);
        }
        if val.get("history_revision").is_none() || val["history_revision"].is_null() {
            val["history_revision"] = serde_json::json!(eng_rev);
        }

        Some(val.to_string())
    };
    if let Some(status) = initial_status {
        let _ = write.send(Message::Text(status.into())).await;
    }

    loop {
        tokio::select! {
            // watchチャネルの更新を検知して最新メッセージを送信（遅延時は最新フレームのみ自動集約・ゼロラグ配信）
            changed_res = rx.changed() => {
                match changed_res {
                    Ok(()) => {
                        let msg = rx.borrow_and_update().clone();
                        if !msg.is_empty() {
                            if let Err(e) = write.send(Message::Text(msg.into())).await {
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
                            let (hist, acc, pos, rev) = {
                                let eng = state.trading_engine.lock().unwrap();
                                let h = state.last_history.lock().unwrap().clone().unwrap_or_else(|| {
                                    serde_json::to_value(&eng.history).unwrap_or_else(|_| serde_json::json!([]))
                                });
                                (
                                    h,
                                    serde_json::to_value(&eng.account).ok(),
                                    serde_json::to_value(&eng.positions).ok(),
                                    eng.revision,
                                )
                            };
                            let last = state.last_status.lock().unwrap().clone();
                            let mut resp = if !last.is_empty() {
                                serde_json::from_str::<serde_json::Value>(&last).unwrap_or_else(|_| serde_json::json!({"status":"READY"}))
                            } else {
                                serde_json::json!({"status":"READY"})
                            };
                            resp["history"] = hist;
                            if let Some(a) = acc { resp["account"] = a; }
                            if let Some(p) = pos { resp["positions"] = p; }
                            resp["trade_revision"] = serde_json::json!(rev);
                            resp["history_revision"] = serde_json::json!(rev);
                            let _ = write.send(Message::Text(resp.to_string().into())).await;
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
