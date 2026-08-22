use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt};
use crate::state::ReplayState;

pub const TRBI_MAGIC: u32 = 0x54524249; // "TRBI" ASCII

#[repr(C, packed)]
#[derive(Debug, Clone, Copy)]
pub struct BinaryCommandPacket {
    pub magic: u32,
    pub cmd_type: u16,
    pub reserved: u16,
    pub target_index: i64,
    pub target_time_msc: i64,
    pub multiplier: f64,
    pub tick_step: i32,
    pub flags: u32,
}

impl BinaryCommandPacket {
    pub fn to_bytes(&self) -> [u8; 40] {
        let mut buf = [0u8; 40];
        buf[0..4].copy_from_slice(&self.magic.to_le_bytes());
        buf[4..6].copy_from_slice(&self.cmd_type.to_le_bytes());
        buf[6..8].copy_from_slice(&self.reserved.to_le_bytes());
        buf[8..16].copy_from_slice(&self.target_index.to_le_bytes());
        buf[16..24].copy_from_slice(&self.target_time_msc.to_le_bytes());
        buf[24..32].copy_from_slice(&self.multiplier.to_le_bytes());
        buf[32..36].copy_from_slice(&self.tick_step.to_le_bytes());
        buf[36..40].copy_from_slice(&self.flags.to_le_bytes());
        buf
    }

    pub fn from_json_str(cmd_json: &str) -> Option<Self> {
        let v: serde_json::Value = serde_json::from_str(cmd_json).ok()?;
        let cmd = v.get("command")?.as_str()?;
        
        match cmd {
            "SEEK" => {
                let target_index = v.get("target_index")?.as_i64()?;
                Some(Self {
                    magic: TRBI_MAGIC,
                    cmd_type: 1,
                    reserved: 0,
                    target_index,
                    target_time_msc: 0,
                    multiplier: 0.0,
                    tick_step: 0,
                    flags: 0,
                })
            }
            "CONTROL" => {
                let multiplier = v.get("multiplier").and_then(|m| m.as_f64()).unwrap_or(0.0);
                let tick_step = v.get("tick_step").and_then(|t| t.as_i64()).unwrap_or(0) as i32;
                let mut flags: u32 = 0;

                if let Some(is_playing) = v.get("is_playing").and_then(|p| p.as_bool()) {
                    flags |= 0x02; // HAS_IS_PLAYING
                    if is_playing {
                        flags |= 0x01; // IS_PLAYING_TRUE
                    }
                }

                if let Some(speed_mode) = v.get("speed_mode").and_then(|s| s.as_str()) {
                    flags |= 0x08; // HAS_SPEED_MODE
                    if speed_mode == "COUNT" {
                        flags |= 0x04; // IS_MODE_COUNT
                    }
                }

                if let Some(skip) = v.get("auto_skip_weekend").and_then(|b| b.as_bool()) {
                    flags |= 0x10; // HAS_AUTO_SKIP
                    if skip {
                        flags |= 0x20; // AUTO_SKIP_TRUE
                    }
                }

                Some(Self {
                    magic: TRBI_MAGIC,
                    cmd_type: 2,
                    reserved: 0,
                    target_index: -1,
                    target_time_msc: 0,
                    multiplier,
                    tick_step,
                    flags,
                })
            }
            "PLAY" => Some(Self {
                magic: TRBI_MAGIC,
                cmd_type: 3,
                reserved: 0,
                target_index: -1,
                target_time_msc: 0,
                multiplier: 0.0,
                tick_step: 0,
                flags: 0,
            }),
            "PAUSE" => Some(Self {
                magic: TRBI_MAGIC,
                cmd_type: 4,
                reserved: 0,
                target_index: -1,
                target_time_msc: 0,
                multiplier: 0.0,
                tick_step: 0,
                flags: 0,
            }),
            "RESET" => Some(Self {
                magic: TRBI_MAGIC,
                cmd_type: 5,
                reserved: 0,
                target_index: 0,
                target_time_msc: 0,
                multiplier: 0.0,
                tick_step: 0,
                flags: 0,
            }),
            "SEEK_TIME" => {
                let mut target_time_msc = v.get("target_time_msc").and_then(|t| t.as_i64()).unwrap_or(0);
                if target_time_msc <= 0 {
                    if let Some(target_time_str) = v.get("target_time").and_then(|t| t.as_str()) {
                        if let Some(parsed) = parse_time_str_to_msc(target_time_str) {
                            target_time_msc = parsed;
                        }
                    }
                }
                Some(Self {
                    magic: TRBI_MAGIC,
                    cmd_type: 6,
                    reserved: 0,
                    target_index: -1,
                    target_time_msc,
                    multiplier: 0.0,
                    tick_step: 0,
                    flags: 0,
                })
            }
            "SEEK_RELATIVE" => {
                let delta = v.get("delta").and_then(|d| d.as_i64()).unwrap_or(0);
                Some(Self {
                    magic: TRBI_MAGIC,
                    cmd_type: 7,
                    reserved: 0,
                    target_index: delta,
                    target_time_msc: 0,
                    multiplier: 0.0,
                    tick_step: 0,
                    flags: 0,
                })
            }
            "TIME_JUMP" => {
                let delta_sec = v.get("delta_seconds").and_then(|d| d.as_i64()).unwrap_or(0);
                Some(Self {
                    magic: TRBI_MAGIC,
                    cmd_type: 8,
                    reserved: 0,
                    target_index: delta_sec,
                    target_time_msc: 0,
                    multiplier: 0.0,
                    tick_step: 0,
                    flags: 0,
                })
            }
            "SESSION_JUMP" => {
                let session = v.get("session").and_then(|s| s.as_str()).unwrap_or("");
                let direction = v.get("direction").and_then(|d| d.as_str()).unwrap_or("");
                let mut flags: u32 = 0;
                match session {
                    "LDN" => flags |= 1,
                    "NY" => flags |= 2,
                    _ => flags |= 0,
                }
                if direction == "NEXT" {
                    flags |= 0x04;
                }
                Some(Self {
                    magic: TRBI_MAGIC,
                    cmd_type: 9,
                    reserved: 0,
                    target_index: -1,
                    target_time_msc: 0,
                    multiplier: 0.0,
                    tick_step: 0,
                    flags,
                })
            }
            "LOOP_SET_A" => Some(Self {
                magic: TRBI_MAGIC,
                cmd_type: 10,
                reserved: 0,
                target_index: -1,
                target_time_msc: 0,
                multiplier: 0.0,
                tick_step: 0,
                flags: 0,
            }),
            "LOOP_SET_B" => Some(Self {
                magic: TRBI_MAGIC,
                cmd_type: 11,
                reserved: 0,
                target_index: -1,
                target_time_msc: 0,
                multiplier: 0.0,
                tick_step: 0,
                flags: 0,
            }),
            "LOOP_CLEAR" => Some(Self {
                magic: TRBI_MAGIC,
                cmd_type: 12,
                reserved: 0,
                target_index: -1,
                target_time_msc: 0,
                multiplier: 0.0,
                tick_step: 0,
                flags: 0,
            }),
            _ => None,
        }
    }
}

fn parse_time_str_to_msc(s: &str) -> Option<i64> {
    let clean = s.replace('.', "-");
    let parts: Vec<&str> = clean.trim().split_whitespace().collect();
    if parts.is_empty() {
        return None;
    }
    let date_parts: Vec<i32> = parts[0].split('-').filter_map(|p| p.parse().ok()).collect();
    if date_parts.len() < 3 {
        return None;
    }
    let (year, month, day) = (date_parts[0], date_parts[1], date_parts[2]);
    let (mut hour, mut min, mut sec) = (0u32, 0u32, 0u32);
    if parts.len() > 1 {
        let time_parts: Vec<u32> = parts[1].split(':').filter_map(|p| p.parse().ok()).collect();
        if !time_parts.is_empty() { hour = time_parts[0]; }
        if time_parts.len() > 1 { min = time_parts[1]; }
        if time_parts.len() > 2 { sec = time_parts[2]; }
    }
    let date = chrono::NaiveDate::from_ymd_opt(year, month as u32, day as u32)?;
    let time = chrono::NaiveTime::from_hms_opt(hour, min, sec)?;
    let dt = chrono::NaiveDateTime::new(date, time);
    Some(dt.and_utc().timestamp_millis())
}

// 連続するシーク操作コマンドのデバウンス・キュー圧縮（Devモード診断付き）
fn is_coalescable_seek(cmd_json: &str) -> bool {
    if cmd_json.contains("SEEK") || cmd_json.contains("SEEK_TIME") {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(cmd_json) {
            if let Some(cmd) = v.get("command").and_then(|c| c.as_str()) {
                return cmd == "SEEK" || cmd == "SEEK_TIME";
            }
        }
    }
    false
}

fn coalesce_commands(pending: Vec<String>) -> Vec<String> {
    if pending.len() <= 1 {
        return pending;
    }

    let mut result = Vec::with_capacity(pending.len());
    let mut i = 0;
    while i < pending.len() {
        let current = &pending[i];
        if is_coalescable_seek(current) {
            let mut last_seek_idx = i;
            let mut j = i + 1;
            while j < pending.len() && is_coalescable_seek(&pending[j]) {
                last_seek_idx = j;
                j += 1;
            }
            result.push(pending[last_seek_idx].clone());
            i = j;
        } else {
            result.push(current.clone());
            i += 1;
        }
    }
    result
}

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
                        let mut batch = vec![cmd];
                        // チャンネル内の保留コマンドを即座に吸い出し、一括最適化
                        while let Ok(next_cmd) = cmd_rx.try_recv() {
                            batch.push(next_cmd);
                        }

                        #[cfg(debug_assertions)]
                        let initial_count = batch.len();

                        let coalesced = coalesce_commands(batch);

                        #[cfg(debug_assertions)]
                        if coalesced.len() < initial_count {
                            println!(
                                "[DEV-IPC-THROTTLE] コマンドキュー最適化: {} 件 -> {} 件に間引き圧縮",
                                initial_count,
                                coalesced.len()
                            );
                        }

                        let mut send_failed = false;
                        for c in coalesced {
                            if let Some(bin_pkt) = BinaryCommandPacket::from_json_str(&c) {
                                #[cfg(debug_assertions)]
                                {
                                    let cmd_type = bin_pkt.cmd_type;
                                    let target_index = bin_pkt.target_index;
                                    println!(
                                        "[DEV-IPC-BINARY] バイナリパケット送信: type={}, idx={}",
                                        cmd_type, target_index
                                    );
                                }

                                let bytes = bin_pkt.to_bytes();
                                if let Err(e) = server.write_all(&bytes).await {
                                    eprintln!("Command Pipe バイナリ書き込み失敗: {}", e);
                                    send_failed = true;
                                    break;
                                }
                            } else {
                                let data = format!("{}\n", c);
                                if let Err(e) = server.write_all(data.as_bytes()).await {
                                    eprintln!("Command Pipe への書き込み失敗: {}", e);
                                    send_failed = true;
                                    break;
                                }
                            }
                        }
                        if send_failed {
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
    // ステータス差分チェック: 前回と全く同じメッセージの場合は emit やパースをスキップし、
    // 不要な Tauri IPC 通信・serde パース・React 再レンダリングを回避する
    let is_changed = {
        let mut last = state.last_status.lock().unwrap();
        if *last != trimmed {
            *last = trimmed.to_string();
            true
        } else {
            false
        }
    };

    if !is_changed {
        return;
    }

    // フロントエンドへリアルタイム通知（差分が発生した時のみ送信）
    let _ = app_handle.emit("mt5-status", trimmed);

    // 外部ツール（Drenhisなど）へWebSocketブロードキャスト送信
    let _ = state.sync_tx.send(trimmed.to_string());

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
                if let Some(mode_val) = val.get("speed_mode") {
                    if let Ok(mode) = serde_json::from_value::<crate::state::SpeedMode>(mode_val.clone()) {
                        p_guard.speed_mode = mode;
                    }
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

