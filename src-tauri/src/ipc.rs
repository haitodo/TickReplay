use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt};
use crate::error::AppError;
use crate::state::ReplayState;

// 名前付きパイプサーバー（コマンド配信用：Rust → EA）のタスク
pub async fn run_command_pipe_server(
    mut cmd_rx: tokio::sync::mpsc::UnboundedReceiver<String>,
    _state: Arc<ReplayState>,
) {
    use tokio::net::windows::named_pipe::ServerOptions;
    
    let pipe_name = r"\\.\pipe\replay_command";
    loop {
        // パイプサーバーのインスタンス生成
        let mut server = match ServerOptions::new()
            .first_pipe_instance(true)
            .create(pipe_name)
        {
            Ok(s) => s,
            Err(e) => {
                eprintln!("コマンドパイプサーバー生成失敗: {}", e);
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }
        };

        println!("Command Pipe: EAの接続を待機中...");
        if let Err(e) = server.connect().await {
            eprintln!("Command Pipe 接続受付エラー: {}", e);
            continue;
        }
        println!("Command Pipe: EAが接続されました。");

        // 接続時の不要なキュー蓄積コマンドをクリア
        while cmd_rx.try_recv().is_ok() {}

        // チャネルから受信したコマンドをパイプへ書き込み
        let mut read_buf = [0u8; 16];
        loop {
            tokio::select! {
                cmd_opt = cmd_rx.recv() => {
                    if let Some(cmd) = cmd_opt {
                        let data = format!("{}\n", cmd);
                        if let Err(e) = server.write_all(data.as_bytes()).await {
                            eprintln!("Command Pipe への書き込み失敗: {}", e);
                            break;
                        }
                        if let Err(e) = server.flush().await {
                            eprintln!("Command Pipe のフラッシュ失敗: {}", e);
                            break;
                        }
                    } else {
                        // アプリ終了時に受信側が閉じられた場合
                        return;
                    }
                }
                read_res = server.read(&mut read_buf) => {
                    match read_res {
                        Ok(0) => {
                            println!("Command Pipe: EAが切断されました(EOF検知)。");
                            break;
                        }
                        Ok(_) => {
                            // EAからデータが送信されることは想定していないが、受信した場合は単に無視する
                        }
                        Err(e) => {
                            eprintln!("Command Pipe 読み取りエラー(切断検知): {}", e);
                            break;
                        }
                    }
                }
            }
        }
    }
}

// 名前付きパイプサーバー（ステータス受信用：EA → Rust）のタスク
pub async fn run_status_pipe_server(
    app_handle: AppHandle,
    state: Arc<ReplayState>,
) {
    use tokio::net::windows::named_pipe::ServerOptions;
    
    let pipe_name = r"\\.\pipe\replay_status";
    let mut connected_notified = false;

    loop {
        let server = match ServerOptions::new()
            .first_pipe_instance(true)
            .create(pipe_name)
        {
            Ok(s) => s,
            Err(e) => {
                eprintln!("ステータスパイプサーバー生成失敗: {}", e);
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }
        };

        println!("Status Pipe: EAの接続を待機中...");
        if let Err(e) = server.connect().await {
            eprintln!("Status Pipe 接続受付エラー: {}", e);
            continue;
        }
        println!("Status Pipe: EAが接続されました。");

        let mut reader = tokio::io::BufReader::new(server);
        let mut line = String::new();

        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => {
                    // クライアント切断
                    println!("Status Pipe: EAが切断されました。");
                    break;
                }
                Ok(_) => {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        process_status_message(&trimmed, &app_handle, &state, &mut connected_notified).await;
                    }
                }
                Err(e) => {
                    eprintln!("Status Pipe 読み取り失敗: {}", e);
                    break;
                }
            }
        }

        // 切断検知の通知
        if connected_notified {
            let _ = app_handle.emit("mt5-disconnected", ());
            connected_notified = false;
        }
        if let Some(speed_order) = app_handle.get_webview_window("speed_order") {
            let _ = speed_order.close();
        }
        {
            let mut last = state.last_status.lock().unwrap();
            *last = String::new();
        }
    }
}

// 受信したステータスメッセージの処理
async fn process_status_message(
    trimmed: &str,
    app_handle: &AppHandle,
    state: &Arc<ReplayState>,
    connected_notified: &mut bool,
) {
    // フロントエンドへリアルタイム通知（エラーメッセージなどの重複受信時も確実に届くようにする）
    let _ = app_handle.emit("mt5-status", trimmed);

    {
        let mut last = state.last_status.lock().unwrap();
        *last = trimmed.to_string();
    }

        // キャッシュされている再生状態などを更新
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Some(status) = val.get("status").and_then(|s| s.as_str()) {
                if status == "CONNECTED" && !*connected_notified {
                    let _ = app_handle.emit("mt5-connected", ());
                    *connected_notified = true;
                } else if status == "DISCONNECTED" {
                    let _ = app_handle.emit("mt5-disconnected", ());
                    *connected_notified = false;
                    if let Some(speed_order) = app_handle.get_webview_window("speed_order") {
                        let _ = speed_order.close();
                    }
                } else if status == "ACTIVE" || status == "READY" {
                    if !*connected_notified {
                        let _ = app_handle.emit("mt5-connected", ());
                        *connected_notified = true;
                    }
                    
                    // playback Mutexを1度だけロックして一貫性を保ちつつ更新
                    let mut p_guard = state.playback.lock().unwrap();
                    
                    if let Some(playing) = val.get("is_playing").and_then(|p| p.as_bool()) {
                        p_guard.is_playing = playing;
                    }
                    if let Some(mode) = val.get("speed_mode").and_then(|m| m.as_str()) {
                        p_guard.speed_mode = mode.to_string();
                    }
                    if let Some(mult_val) = val.get("multiplier") {
                        if let Some(mult) = mult_val.as_f64() {
                            p_guard.multiplier = mult;
                        } else if let Some(mult_str) = mult_val.as_str() {
                            if let Ok(mult) = mult_str.parse::<f64>() {
                                p_guard.multiplier = mult;
                            }
                        }
                    }
                    if let Some(step) = val.get("tick_step").and_then(|t| t.as_i64()) {
                        p_guard.tick_step = step as i32;
                    }
                }
            }
        }
    }

// エクスポートされた経済指標データを読み込む (非同期・ロック極小化)
pub async fn read_replay_news(state: &ReplayState) -> Result<String, AppError> {
    let files_path = {
        let path_guard = state.files_path.lock().unwrap();
        path_guard.clone()
    };

    let Some(files_path) = files_path else {
        return Err(AppError::Config("MT5 Files path not configured".to_string()));
    };
    
    let news_file = files_path.join("replay_news.json");
    if !news_file.exists() {
        return Ok("[]".to_string());
    }
    
    // I/O実行中はロックを完全に手放すことで、他のタスクをブロックしないようにする
    let bytes = tokio::fs::read(news_file).await?;
    let content = String::from_utf8_lossy(&bytes).into_owned();
    Ok(content)
}
