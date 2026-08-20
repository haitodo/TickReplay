use std::net::SocketAddr;
use std::sync::Arc;
use futures_util::{SinkExt, StreamExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::Message;
use crate::state::ReplayState;

pub const DEFAULT_SYNC_PORT: u16 = 49210;

/// 同期サーバーのインスタンス
pub struct SyncServer {
    tx: broadcast::Sender<String>,
}

impl SyncServer {
    pub fn new() -> (Self, broadcast::Sender<String>) {
        let (tx, _) = broadcast::channel(100);
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
    mut rx: broadcast::Receiver<String>,
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

    // 接続直後: 現在の最新ステータスを即座に送信して同期を確立
    let initial_status = {
        let last = state.last_status.lock().unwrap();
        if !last.is_empty() {
            Some(last.clone())
        } else {
            None
        }
    };
    if let Some(status) = initial_status {
        let _ = write.send(Message::Text(status.into())).await;
    }

    loop {
        tokio::select! {
            // ブロードキャストからのステータス通知を受信してクライアントに転送
            recv_res = rx.recv() => {
                match recv_res {
                    Ok(msg) => {
                        if let Err(e) = write.send(Message::Text(msg.into())).await {
                            println!("[SyncServer] クライアント {} 送信エラー: {}", peer_addr, e);
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        println!("[SyncServer] クライアント {} が遅延 ({} 件スキップ)", peer_addr, skipped);
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        break;
                    }
                }
            }
            // クライアントからの受信（コマンド送信など）
            msg_opt = read.next() => {
                match msg_opt {
                    Some(Ok(Message::Text(text))) => {
                        let text_str = text.to_string();
                        // Drenhis 等からのコマンド（SEEK, SEEK_TIME, CONTROL, etc.）を command_tx に中継
                        let _ = state.command_tx.send(text_str);
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
