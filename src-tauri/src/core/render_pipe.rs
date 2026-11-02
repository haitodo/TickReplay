use std::io::{self, Read};

pub const RENDER_PIPE_NAME: &str = r"\\.\pipe\tick_replay_render";
pub const RENDER_MAGIC: u32 = 0x54525232; // 'TRR2' (Tick Replay Renderer v2)
pub const MSG_HELLO: u16 = 0x0001;
pub const MSG_ADVANCE: u16 = 0x0002;
pub const MSG_RESET: u16 = 0x0003;
pub const MSG_ACK: u16 = 0x0004;
pub const MSG_READY: u16 = 0x0005;
pub const MSG_APPLY_PROFILE: u16 = 0x0006;
pub const MSG_INIT: u16 = 0x0007;
pub const MSG_IMPORT_TICKS: u16 = 0x0008;
pub const MSG_TERMINATE: u16 = 0x0009;
pub const MAX_SYNC_SYMBOLS: usize = 8;

fn renderer_ready_status(snapshot: Option<&crate::core::types::CoreStatusSnapshot>) -> serde_json::Value {
    let Some(snap) = snapshot else {
        return serde_json::json!({ "status": "READY", "message": "MT5 Renderer EA ready" });
    };
    // A paused core does not emit another frame after the EA reconnects. Include
    // its complete state so windows cleared on DISCONNECTED can recover at READY.
    let mut value = serde_json::json!({
        "status": if snap.is_playing { "ACTIVE" } else { "READY" },
        "message": "MT5 Renderer EA ready",
        "is_playing": snap.is_playing,
        "virtual_time_msc": snap.virtual_time_msc,
        "current_idx": snap.current_index,
        "total_ticks": snap.total_ticks,
        "seek_epoch": snap.seek_epoch,
        "speed_mode": snap.speed_mode,
        "multiplier": snap.multiplier,
        "account": &snap.account,
        "positions": &snap.positions,
        "history": &snap.history,
        "history_revision": snap.history_revision,
        "trade_revision": snap.trade_revision,
        "execution_audits": &snap.latest_audits,
        "time_stop_seconds": snap.time_stop_seconds,
        "time_stop_enabled": snap.time_stop_enabled,
    });
    if let Some(tick) = snap.current_tick {
        value["bid"] = serde_json::json!(tick.bid);
        value["ask"] = serde_json::json!(tick.ask);
        value["spread"] = serde_json::json!(((tick.ask - tick.bid) * 100.0).round() / 100.0);
        value["jfx_bid"] = value["bid"].clone();
        value["jfx_ask"] = value["ask"].clone();
        value["jfx_spread"] = value["spread"].clone();
    }
    value
}

fn copy_utf8_c_string(destination: &mut [u8], value: &str) {
    let mut len = value.len().min(destination.len().saturating_sub(1));
    while !value.is_char_boundary(len) {
        len -= 1;
    }
    destination[..len].copy_from_slice(&value.as_bytes()[..len]);
}

fn renderer_sync_symbols(value: &str, main_symbol: &str, sub_symbol: &str) -> String {
    fn source_name(symbol: &str) -> &str {
        symbol.strip_suffix("_Replay").unwrap_or(symbol)
    }

    let mut selected = Vec::new();
    let mut used_bytes = 0;
    for symbol in value.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        let source = source_name(symbol);
        if source == source_name(main_symbol)
            || source == source_name(sub_symbol)
            || selected.iter().any(|s: &&str| source_name(s) == source)
        {
            continue;
        }
        let bytes = symbol.len() + usize::from(!selected.is_empty());
        if selected.len() == MAX_SYNC_SYMBOLS || used_bytes + bytes > 511 {
            eprintln!("[render_pipe] Additional symbols exceed renderer capacity; remaining symbols were omitted.");
            break;
        }
        selected.push(symbol);
        used_bytes += bytes;
    }
    selected.join(",")
}

/// 固定長 16 バイトヘッダー (自然アライメント)
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, bytemuck::Pod, bytemuck::Zeroable)]
pub struct RenderHeader {
    pub magic: u32,
    pub msg_type: u16,
    pub flags: u16,
    pub epoch: u32,
    pub payload_len: u32,
}

impl RenderHeader {
    pub const SIZE: usize = 16;

    pub fn new(msg_type: u16, flags: u16, epoch: u32, payload_len: u32) -> Self {
        Self {
            magic: RENDER_MAGIC,
            msg_type,
            flags,
            epoch,
            payload_len,
        }
    }

    pub fn is_valid(&self) -> bool {
        self.magic == RENDER_MAGIC
    }
}

/// 0x0001 HELLO ペイロード (EA -> Core, 72 bytes)
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, bytemuck::Pod, bytemuck::Zeroable)]
pub struct HelloPayload {
    pub ea_version: u32,
    pub reserved: u32,
    pub main_ticks: u64,
    pub main_hash: u64,
    pub sub_ticks: u64,
    pub sub_hash: u64,
    pub symbol: [u8; 32],
}

/// 0x0002 ADVANCE ペイロード (Core -> EA, 24 bytes)
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, bytemuck::Pod, bytemuck::Zeroable)]
pub struct AdvancePayload {
    pub main_idx: u64,
    pub sub_idx: u64,
    pub virtual_time_msc: i64,
}

/// 0x0003 RESET ペイロード (Core -> EA, 32 bytes)
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, bytemuck::Pod, bytemuck::Zeroable)]
pub struct ResetPayload {
    pub main_target_idx: u64,
    pub sub_target_idx: u64,
    pub virtual_time_msc: i64,
    pub reserved: i64,
}

/// 0x0004 ACK ペイロード (EA -> Core, 24 bytes)
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, bytemuck::Pod, bytemuck::Zeroable)]
pub struct AckPayload {
    pub main_applied_idx: u64,
    pub sub_applied_idx: u64,
    pub render_duration_us: u32,
    pub reserved: u32,
}

/// 0x0006 APPLY_PROFILE ペイロード (Core -> EA, 128 bytes)
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, bytemuck::Pod, bytemuck::Zeroable)]
pub struct ApplyProfilePayload {
    pub profile_name: [u8; 64],
    pub main_symbol: [u8; 32],
    pub sub_symbol: [u8; 32],
}

/// 0x0007 INIT ペイロード (Core -> EA, 704 bytes)
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, bytemuck::Pod, bytemuck::Zeroable)]
pub struct InitPayload {
    pub start_time_msc: i64,
    pub end_time_msc: i64,
    pub preload_date_msc: i64,
    pub preloaded_bars: u32,
    pub preload_mode: u32,
    pub source_symbol: [u8; 32],
    pub sub_symbol: [u8; 32],
    pub profile_name: [u8; 64],
    pub additional_symbols: [u8; 512],
    pub reserved: [u8; 32],
}

/// 0x0008 IMPORT_TICKS ペイロード (Core -> EA, 224 bytes)
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, bytemuck::Pod, bytemuck::Zeroable)]
pub struct ImportTicksPayload {
    pub symbol: [u8; 32],
    pub group: [u8; 32],
    pub base_symbol: [u8; 32],
    pub bin_file: [u8; 128],
}

/// プロトコル送受信ヘルパー
pub struct RenderPacketCodec;

impl RenderPacketCodec {
    pub fn encode_advance(epoch: u32, main_idx: u64, sub_idx: u64, virtual_time_msc: i64) -> [u8; 40] {
        let payload = AdvancePayload {
            main_idx,
            sub_idx,
            virtual_time_msc,
        };
        let header = RenderHeader::new(
            MSG_ADVANCE,
            0,
            epoch,
            std::mem::size_of::<AdvancePayload>() as u32,
        );

        let mut buf = [0u8; 40];
        buf[0..16].copy_from_slice(bytemuck::bytes_of(&header));
        buf[16..40].copy_from_slice(bytemuck::bytes_of(&payload));
        buf
    }

    pub fn encode_reset(
        epoch: u32,
        main_target_idx: u64,
        sub_target_idx: u64,
        virtual_time_msc: i64,
    ) -> [u8; 48] {
        let payload = ResetPayload {
            main_target_idx,
            sub_target_idx,
            virtual_time_msc,
            reserved: 0,
        };
        let header = RenderHeader::new(
            MSG_RESET,
            0,
            epoch,
            std::mem::size_of::<ResetPayload>() as u32,
        );

        let mut buf = [0u8; 48];
        buf[0..16].copy_from_slice(bytemuck::bytes_of(&header));
        buf[16..48].copy_from_slice(bytemuck::bytes_of(&payload));
        buf
    }

    #[allow(clippy::too_many_arguments)]
    pub fn encode_init(
        epoch: u32,
        start_time_msc: i64,
        end_time_msc: i64,
        preload_date_msc: i64,
        preloaded_bars: u32,
        preload_mode: u32,
        source_symbol: &str,
        sub_symbol: &str,
        profile_name: &str,
        additional_symbols: &str,
    ) -> Vec<u8> {
        let mut payload = InitPayload {
            start_time_msc,
            end_time_msc,
            preload_date_msc,
            preloaded_bars,
            preload_mode,
            source_symbol: [0u8; 32],
            sub_symbol: [0u8; 32],
            profile_name: [0u8; 64],
            additional_symbols: [0u8; 512],
            reserved: [0u8; 32],
        };
        copy_utf8_c_string(&mut payload.source_symbol, source_symbol);
        copy_utf8_c_string(&mut payload.sub_symbol, sub_symbol);
        copy_utf8_c_string(&mut payload.profile_name, profile_name);
        let sync_symbols = renderer_sync_symbols(additional_symbols, source_symbol, sub_symbol);
        copy_utf8_c_string(&mut payload.additional_symbols, &sync_symbols);

        let header = RenderHeader::new(
            MSG_INIT,
            0,
            epoch,
            std::mem::size_of::<InitPayload>() as u32,
        );

        let mut buf = Vec::with_capacity(RenderHeader::SIZE + std::mem::size_of::<InitPayload>());
        buf.extend_from_slice(bytemuck::bytes_of(&header));
        buf.extend_from_slice(bytemuck::bytes_of(&payload));
        buf
    }

    pub fn encode_apply_profile(
        epoch: u32,
        profile_name: &str,
        main_symbol: &str,
        sub_symbol: &str,
    ) -> Vec<u8> {
        let mut payload = ApplyProfilePayload {
            profile_name: [0u8; 64],
            main_symbol: [0u8; 32],
            sub_symbol: [0u8; 32],
        };
        copy_utf8_c_string(&mut payload.profile_name, profile_name);
        copy_utf8_c_string(&mut payload.main_symbol, main_symbol);
        copy_utf8_c_string(&mut payload.sub_symbol, sub_symbol);

        let header = RenderHeader::new(
            MSG_APPLY_PROFILE,
            0,
            epoch,
            std::mem::size_of::<ApplyProfilePayload>() as u32,
        );

        let mut buf = Vec::with_capacity(RenderHeader::SIZE + std::mem::size_of::<ApplyProfilePayload>());
        buf.extend_from_slice(bytemuck::bytes_of(&header));
        buf.extend_from_slice(bytemuck::bytes_of(&payload));
        buf
    }

    pub fn encode_import_ticks(
        epoch: u32,
        symbol: &str,
        group: &str,
        base_symbol: &str,
        bin_file: &str,
    ) -> Vec<u8> {
        let mut payload = ImportTicksPayload {
            symbol: [0; 32],
            group: [0; 32],
            base_symbol: [0; 32],
            bin_file: [0; 128],
        };
        copy_utf8_c_string(&mut payload.symbol, symbol);
        copy_utf8_c_string(&mut payload.group, group);
        copy_utf8_c_string(&mut payload.base_symbol, base_symbol);
        copy_utf8_c_string(&mut payload.bin_file, bin_file);

        let header = RenderHeader::new(
            MSG_IMPORT_TICKS,
            0,
            epoch,
            std::mem::size_of::<ImportTicksPayload>() as u32,
        );

        let mut buf = Vec::with_capacity(RenderHeader::SIZE + std::mem::size_of::<ImportTicksPayload>());
        buf.extend_from_slice(bytemuck::bytes_of(&header));
        buf.extend_from_slice(bytemuck::bytes_of(&payload));
        buf
    }

    pub fn encode_terminate(epoch: u32) -> Vec<u8> {
        let header = RenderHeader::new(MSG_TERMINATE, 0, epoch, 0);
        let mut buf = Vec::with_capacity(RenderHeader::SIZE);
        buf.extend_from_slice(bytemuck::bytes_of(&header));
        buf
    }

    pub fn read_packet<R: Read>(reader: &mut R) -> io::Result<(RenderHeader, Vec<u8>)> {
        let mut header_buf = [0u8; RenderHeader::SIZE];
        reader.read_exact(&mut header_buf)?;
        let header: RenderHeader = *bytemuck::from_bytes(&header_buf);

        if !header.is_valid() {
            let magic = header.magic;
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("Invalid magic: 0x{:08X}", magic),
            ));
        }

        let mut payload = vec![0u8; header.payload_len as usize];
        if header.payload_len > 0 {
            reader.read_exact(&mut payload)?;
        }

        Ok((header, payload))
    }
}

#[derive(Debug, Clone)]
pub enum RenderPipeCommand {
    Advance {
        epoch: u32,
        main_idx: u64,
        sub_idx: u64,
        virtual_time_msc: i64,
    },
    Reset {
        epoch: u32,
        main_target_idx: u64,
        sub_target_idx: u64,
        virtual_time_msc: i64,
    },
    ApplyProfile {
        epoch: u32,
        profile_name: String,
        main_symbol: String,
        sub_symbol: String,
    },
    Init {
        epoch: u32,
        start_time_msc: i64,
        end_time_msc: i64,
        preload_date_msc: i64,
        preloaded_bars: u32,
        preload_mode: u32,
        source_symbol: String,
        sub_symbol: String,
        profile_name: String,
        additional_symbols: String,
    },
    ImportTicks {
        epoch: u32,
        symbol: String,
        group: String,
        base_symbol: String,
        bin_file: String,
    },
    Terminate {
        epoch: u32,
    },
}

#[derive(Debug, Default)]
struct RenderReconnectState {
    init: Option<RenderPipeCommand>,
    position: Option<RenderPipeCommand>,
}

impl RenderReconnectState {
    fn commands(&self) -> Vec<RenderPipeCommand> {
        let Some(init) = &self.init else {
            return Vec::new();
        };
        let mut commands = vec![init.clone()];
        // Rebuild directly at the latest position, including while playback is paused.
        // An ADVANCE alone cannot undo data left over from an earlier renderer session.
        if let Some(position) = &self.position {
            commands.push(match *position {
                RenderPipeCommand::Advance { epoch, main_idx, sub_idx, virtual_time_msc } => {
                    RenderPipeCommand::Reset {
                        epoch,
                        main_target_idx: main_idx,
                        sub_target_idx: sub_idx,
                        virtual_time_msc,
                    }
                }
                _ => position.clone(),
            });
        }
        commands
    }
}

#[derive(Clone, Debug)]
pub struct RenderPipeHandle {
    cmd_tx: tokio::sync::mpsc::UnboundedSender<RenderPipeCommand>,
    connected: std::sync::Arc<std::sync::atomic::AtomicBool>,
    last_applied_idx: std::sync::Arc<std::sync::atomic::AtomicU64>,
    reconnect_state: std::sync::Arc<std::sync::Mutex<RenderReconnectState>>,
}

impl RenderPipeHandle {
    pub fn send_advance(&self, epoch: u32, main_idx: u64, sub_idx: u64, virtual_time_msc: i64) {
        let mut reconnect = self.reconnect_state.lock().unwrap();
        let cmd = RenderPipeCommand::Advance {
            epoch,
            main_idx,
            sub_idx,
            virtual_time_msc,
        };
        reconnect.position = Some(cmd.clone());
        if self.connected.load(std::sync::atomic::Ordering::Relaxed) {
            let _ = self.cmd_tx.send(cmd);
        }
    }

    pub fn send_reset(
        &self,
        epoch: u32,
        main_target_idx: u64,
        sub_target_idx: u64,
        virtual_time_msc: i64,
    ) {
        let cmd = RenderPipeCommand::Reset {
            epoch,
            main_target_idx,
            sub_target_idx,
            virtual_time_msc,
        };
        let mut reconnect = self.reconnect_state.lock().unwrap();
        reconnect.position = Some(cmd.clone());
        if self.connected.load(std::sync::atomic::Ordering::Relaxed) {
            let _ = self.cmd_tx.send(cmd);
        }
    }

    pub fn send_apply_profile(
        &self,
        epoch: u32,
        profile_name: &str,
        main_symbol: &str,
        sub_symbol: &str,
    ) {
        let _ = self.cmd_tx.send(RenderPipeCommand::ApplyProfile {
            epoch,
            profile_name: profile_name.to_string(),
            main_symbol: main_symbol.to_string(),
            sub_symbol: sub_symbol.to_string(),
        });
    }

    #[allow(clippy::too_many_arguments)]
    pub fn send_init(
        &self,
        epoch: u32,
        start_time_msc: i64,
        end_time_msc: i64,
        preload_date_msc: i64,
        preloaded_bars: u32,
        preload_mode: u32,
        source_symbol: &str,
        sub_symbol: &str,
        profile_name: &str,
        additional_symbols: &str,
    ) {
        let cmd = RenderPipeCommand::Init {
            epoch,
            start_time_msc,
            end_time_msc,
            preload_date_msc,
            preloaded_bars,
            preload_mode,
            source_symbol: source_symbol.to_string(),
            sub_symbol: sub_symbol.to_string(),
            profile_name: profile_name.to_string(),
            additional_symbols: additional_symbols.to_string(),
        };
        let mut reconnect = self.reconnect_state.lock().unwrap();
        reconnect.init = Some(cmd.clone());
        reconnect.position = None;
        if self.connected.load(std::sync::atomic::Ordering::Relaxed) {
            let _ = self.cmd_tx.send(cmd);
        }
    }

    pub fn send_import_ticks(
        &self,
        epoch: u32,
        symbol: &str,
        group: &str,
        base_symbol: &str,
        bin_file: &str,
    ) {
        let _ = self.cmd_tx.send(RenderPipeCommand::ImportTicks {
            epoch,
            symbol: symbol.to_string(),
            group: group.to_string(),
            base_symbol: base_symbol.to_string(),
            bin_file: bin_file.to_string(),
        });
    }

    pub fn send_terminate(&self, epoch: u32) {
        let mut reconnect = self.reconnect_state.lock().unwrap();
        *reconnect = RenderReconnectState::default();
        if self.connected.load(std::sync::atomic::Ordering::Relaxed) {
            let _ = self.cmd_tx.send(RenderPipeCommand::Terminate { epoch });
        }
    }

    pub fn is_connected(&self) -> bool {
        self.connected.load(std::sync::atomic::Ordering::Relaxed)
    }

    pub fn last_applied_idx(&self) -> u64 {
        self.last_applied_idx.load(std::sync::atomic::Ordering::Relaxed)
    }
}

pub struct RenderPipeServer;

impl RenderPipeServer {
    pub fn start_standalone() -> (RenderPipeHandle, tauri::async_runtime::JoinHandle<()>) {
        Self::start_internal(None, None)
    }

    pub fn start(
        app_handle: tauri::AppHandle,
        state: std::sync::Arc<crate::state::ReplayState>,
    ) -> (RenderPipeHandle, tauri::async_runtime::JoinHandle<()>) {
        Self::start_internal(Some(app_handle), Some(state))
    }

    fn start_internal(
        app_handle: Option<tauri::AppHandle>,
        state: Option<std::sync::Arc<crate::state::ReplayState>>,
    ) -> (RenderPipeHandle, tauri::async_runtime::JoinHandle<()>) {
        let (cmd_tx, mut cmd_rx) = tokio::sync::mpsc::unbounded_channel::<RenderPipeCommand>();
        let connected = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let last_applied_idx = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
        let reconnect_state = std::sync::Arc::new(std::sync::Mutex::new(RenderReconnectState::default()));

        let connected_clone = connected.clone();
        let last_applied_clone = last_applied_idx.clone();
        let reconnect_state_clone = reconnect_state.clone();

        let join_handle = tauri::async_runtime::spawn(async move {
            #[cfg(windows)]
            {
                use tokio::io::{AsyncReadExt, AsyncWriteExt};
                use tokio::net::windows::named_pipe::ServerOptions;
                use tauri::Emitter;

                loop {
                    let server = match ServerOptions::new().create(RENDER_PIPE_NAME) {
                        Ok(s) => s,
                        Err(e) => {
                            eprintln!("[RenderPipe] サーバー作成エラー: {}", e);
                            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                            continue;
                        }
                    };

                    if let Err(e) = server.connect().await {
                        eprintln!("[RenderPipe] 接続待機エラー: {}", e);
                        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                        continue;
                    }

                    println!("[RenderPipe] MT5 Renderer EA が接続されました。");

                    let (mut reader, mut writer) = tokio::io::split(server);

                    // 1. 初回 HELLO パケット受信待ち (2秒タイムアウト)
                    let mut header_buf = [0u8; RenderHeader::SIZE];
                    let mut symbol_str = "USDJPY".to_string();

                    if let Ok(Ok(_)) = tokio::time::timeout(std::time::Duration::from_secs(2), reader.read_exact(&mut header_buf)).await {
                        let header: RenderHeader = *bytemuck::from_bytes(&header_buf);
                        if header.is_valid() && header.msg_type == MSG_HELLO && header.payload_len > 0 {
                            let mut hello_buf = vec![0u8; header.payload_len as usize];
                            if reader.read_exact(&mut hello_buf).await.is_ok() {
                                if hello_buf.len() >= 72 {
                                    let hello: &HelloPayload = bytemuck::from_bytes(&hello_buf[0..72]);
                                    let s = String::from_utf8_lossy(&hello.symbol).trim_matches('\0').trim().to_string();
                                    if !s.is_empty() {
                                        symbol_str = s;
                                    }
                                }
                                println!("[RenderPipe] HELLO パケット認識完了: シンボル={}", symbol_str);
                            }
                        }
                    }

                    // フロントエンドへ CONNECTED を通知 & state.last_status を更新
                    let status_val = serde_json::json!({
                        "status": "CONNECTED",
                        "message": "MT5 Renderer EA connected",
                        "protocol": "TRR2",
                        "symbol": symbol_str,
                    });
                    let status_str = status_val.to_string();
                    if let Some(ref st) = state {
                        *st.last_status.lock().unwrap() = status_str.clone();
                        let _ = st.sync_tx.send(status_str.clone());
                    }
                    if let Some(ref app) = app_handle {
                        let _ = app.emit("mt5-status", &status_str);
                        let _ = app.emit("mt5-connected", ());
                    }

                    // 2. コマンド送信用 Writer タスク
                    let (tx_writer, mut rx_writer) = tokio::sync::mpsc::unbounded_channel::<RenderPipeCommand>();
                    let writer_task = tokio::spawn(async move {
                        while let Some(mut cmd) = rx_writer.recv().await {
                            // 同一 epoch の連続する Advance コマンドを最新値へ統合 (Coalescing)
                            if let RenderPipeCommand::Advance { epoch, ref mut main_idx, ref mut sub_idx, ref mut virtual_time_msc } = cmd {
                                let cur_epoch = epoch;
                                while let Ok(peeking) = rx_writer.try_recv() {
                                    match peeking {
                                        RenderPipeCommand::Advance { epoch: next_epoch, main_idx: n_m, sub_idx: n_s, virtual_time_msc: n_v } if next_epoch == cur_epoch => {
                                            *main_idx = n_m;
                                            *sub_idx = n_s;
                                            *virtual_time_msc = n_v;
                                        }
                                        other => {
                                            // Advance 以外のコマンドが来たら、まず直前の最新 Advance を送信
                                            let packet = RenderPacketCodec::encode_advance(cur_epoch, *main_idx, *sub_idx, *virtual_time_msc);
                                            if let Err(e) = writer.write_all(&packet).await {
                                                eprintln!("[RenderPipe] ADVANCE 送信エラー: {}", e);
                                                return;
                                            }
                                            cmd = other;
                                            break;
                                        }
                                    }
                                }
                            }

                            match cmd {
                                RenderPipeCommand::Advance { epoch, main_idx, sub_idx, virtual_time_msc } => {
                                    let packet = RenderPacketCodec::encode_advance(epoch, main_idx, sub_idx, virtual_time_msc);
                                    if let Err(e) = writer.write_all(&packet).await {
                                        eprintln!("[RenderPipe] ADVANCE 送信エラー: {}", e);
                                        break;
                                    }
                                }
                                RenderPipeCommand::Reset { epoch, main_target_idx, sub_target_idx, virtual_time_msc } => {
                                    let packet = RenderPacketCodec::encode_reset(epoch, main_target_idx, sub_target_idx, virtual_time_msc);
                                    if let Err(e) = writer.write_all(&packet).await {
                                        eprintln!("[RenderPipe] RESET 送信エラー: {}", e);
                                        break;
                                    }
                                }
                                RenderPipeCommand::ApplyProfile { epoch, profile_name, main_symbol, sub_symbol } => {
                                    let packet = RenderPacketCodec::encode_apply_profile(epoch, &profile_name, &main_symbol, &sub_symbol);
                                    if let Err(e) = writer.write_all(&packet).await {
                                        eprintln!("[RenderPipe] APPLY_PROFILE 送信エラー: {}", e);
                                        break;
                                    }
                                }
                                RenderPipeCommand::Init { epoch, start_time_msc, end_time_msc, preload_date_msc, preloaded_bars, preload_mode, source_symbol, sub_symbol, profile_name, additional_symbols } => {
                                    let packet = RenderPacketCodec::encode_init(epoch, start_time_msc, end_time_msc, preload_date_msc, preloaded_bars, preload_mode, &source_symbol, &sub_symbol, &profile_name, &additional_symbols);
                                    if let Err(e) = writer.write_all(&packet).await {
                                        eprintln!("[RenderPipe] INIT 送信エラー: {}", e);
                                        break;
                                    }
                                }
                                RenderPipeCommand::ImportTicks { epoch, symbol, group, base_symbol, bin_file } => {
                                    let packet = RenderPacketCodec::encode_import_ticks(epoch, &symbol, &group, &base_symbol, &bin_file);
                                    if let Err(e) = writer.write_all(&packet).await {
                                        eprintln!("[RenderPipe] IMPORT_TICKS 送信エラー: {}", e);
                                        break;
                                    }
                                }
                                RenderPipeCommand::Terminate { epoch } => {
                                    let packet = RenderPacketCodec::encode_terminate(epoch);
                                    if let Err(e) = writer.write_all(&packet).await {
                                        eprintln!("[RenderPipe] TERMINATE 送信エラー: {}", e);
                                        break;
                                    }
                                    let _ = writer.flush().await;
                                    println!("[RenderPipe] MT5 Renderer EA へ TERMINATE (チャート全クローズ要求) 送信完了");
                                }
                            }
                        }
                    });

                    // Cache updates and connection publication share a lock, so an advance
                    // cannot be lost between taking the snapshot and enabling live delivery.
                    {
                        let reconnect = reconnect_state_clone.lock().unwrap();
                        let mut pending_other_commands = Vec::new();
                        while let Ok(cmd) = cmd_rx.try_recv() {
                            match cmd {
                                RenderPipeCommand::Init { .. }
                                | RenderPipeCommand::Reset { .. }
                                | RenderPipeCommand::Advance { .. }
                                | RenderPipeCommand::Terminate { .. } => {}
                                other => pending_other_commands.push(other),
                            }
                        }
                        for cmd in reconnect.commands().into_iter().chain(pending_other_commands) {
                            let _ = tx_writer.send(cmd);
                        }
                        connected_clone.store(true, std::sync::atomic::Ordering::SeqCst);
                    }

                    // 3. Reader & コマンド配送ループ (EOF 切断検知を常時実行)
                    let mut read_buf = [0u8; 512];
                    loop {
                        tokio::select! {
                            // クライアントからの受信 & 切断検知 (EOF)
                            read_res = reader.read(&mut read_buf) => {
                                match read_res {
                                    Ok(0) => {
                                        println!("[RenderPipe] クライアント切断を検知 (EOF)");
                                        break;
                                    }
                                    Ok(n) => {
                                        // 受信パケットヘッダーの簡易解析
                                        if n >= RenderHeader::SIZE {
                                            let hdr: RenderHeader = *bytemuck::from_bytes(&read_buf[0..RenderHeader::SIZE]);
                                            if hdr.is_valid() {
                                                if hdr.msg_type == MSG_ACK && n >= RenderHeader::SIZE + std::mem::size_of::<AckPayload>() {
                                                    let ack: &AckPayload = bytemuck::from_bytes(&read_buf[RenderHeader::SIZE..RenderHeader::SIZE + std::mem::size_of::<AckPayload>()]);
                                                    last_applied_clone.store(ack.main_applied_idx, std::sync::atomic::Ordering::Relaxed);
                                                } else if hdr.msg_type == MSG_READY {
                                                    let snapshot = state.as_ref().and_then(|st| {
                                                        st.core_handle.lock().unwrap().as_ref().map(|core| core.status())
                                                    });
                                                    let ready_val = renderer_ready_status(snapshot.as_ref());
                                                    let ready_str = ready_val.to_string();
                                                    if let Some(ref st) = state {
                                                        *st.last_status.lock().unwrap() = ready_str.clone();
                                                        let _ = st.sync_tx.send(ready_str.clone());
                                                    }
                                                    if let Some(ref app) = app_handle {
                                                        let _ = app.emit("mt5-status", &ready_str);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    Err(e) => {
                                        eprintln!("[RenderPipe] パイプ読取エラー: {}", e);
                                        break;
                                    }
                                }
                            }
                            // 外部からのコマンド受付 -> Writer タスクへ転送
                            cmd_opt = cmd_rx.recv() => {
                                match cmd_opt {
                                    Some(cmd) => {
                                        if tx_writer.send(cmd).is_err() {
                                            break;
                                        }
                                    }
                                    None => {
                                        // シャットダウン
                                        writer_task.abort();
                                        return;
                                    }
                                }
                            }
                        }
                    }

                    writer_task.abort();
                    connected_clone.store(false, std::sync::atomic::Ordering::SeqCst);
                    println!("[RenderPipe] MT5 Renderer EA が切断されました。再接続待機中...");

                    let status_val = serde_json::json!({
                        "status": "DISCONNECTED",
                        "message": "MT5 Renderer EA disconnected",
                    });
                    let status_str = status_val.to_string();
                    if let Some(ref st) = state {
                        *st.last_status.lock().unwrap() = status_str.clone();
                        let _ = st.sync_tx.send(status_str.clone());
                    }
                    if let Some(ref app) = app_handle {
                        let _ = app.emit("mt5-status", &status_str);
                        let _ = app.emit("mt5-disconnected", ());
                    }
                }
            }

            #[cfg(not(windows))]
            {
                let _ = (connected_clone, last_applied_clone, app_handle, state);
                while let Some(_) = cmd_rx.recv().await {}
            }
        });

        let handle = RenderPipeHandle {
            cmd_tx,
            connected,
            last_applied_idx,
            reconnect_state,
        };

        (handle, join_handle)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reconnect_ready_contains_the_paused_cores_complete_state() {
        let (core, task) = crate::core::mod_test_helper::create_test_core();
        let mut receiver = core.subscribe();
        core.submit_order("USDJPY".into(), crate::core::types::OrderSide::Buy, 1.0, 0.0, 0.0, None);
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            loop {
                receiver.changed().await.unwrap();
                if receiver.borrow_and_update().positions.len() == 1 { break; }
            }
        }).await.unwrap();
        let snapshot = core.status();
        let ready = renderer_ready_status(Some(&snapshot));
        assert_eq!(ready["status"], "READY");
        assert_eq!(ready["is_playing"], false);
        assert_eq!(ready["positions"].as_array().unwrap().len(), 1);
        assert_eq!(ready["account"]["balance"], snapshot.account.balance);
        assert_eq!(ready["virtual_time_msc"], snapshot.virtual_time_msc);
        assert_eq!(ready["current_idx"], snapshot.current_index);
        assert_eq!(ready["history"], serde_json::json!(&snapshot.history));
        assert_eq!(ready["execution_audits"], serde_json::json!(&snapshot.latest_audits));
        let mut playing = snapshot;
        playing.is_playing = true;
        assert_eq!(renderer_ready_status(Some(&playing))["status"], "ACTIVE");
        core.shutdown();
        task.await.unwrap();
    }

    #[test]
    fn renderer_ready_without_replay_remains_a_connection_notification() {
        assert_eq!(renderer_ready_status(None), serde_json::json!({
            "status": "READY", "message": "MT5 Renderer EA ready",
        }));
    }

    fn test_handle() -> RenderPipeHandle {
        let (cmd_tx, _) = tokio::sync::mpsc::unbounded_channel();
        RenderPipeHandle {
            cmd_tx,
            connected: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            last_applied_idx: std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0)),
            reconnect_state: std::sync::Arc::new(std::sync::Mutex::new(RenderReconnectState::default())),
        }
    }

    fn init_test_session(handle: &RenderPipeHandle) {
        handle.send_init(1, 1000, 9000, 0, 300, 0, "USDJPY", "", "検証", "");
    }

    fn assert_reconnect_position(handle: &RenderPipeHandle, epoch: u32, idx: u64, time_msc: i64) {
        let commands = handle.reconnect_state.lock().unwrap().commands();
        assert_eq!(commands.len(), 2);
        assert!(matches!(commands[0], RenderPipeCommand::Init { .. }));
        assert!(matches!(commands[1], RenderPipeCommand::Reset {
            epoch: actual_epoch,
            main_target_idx,
            virtual_time_msc,
            ..
        } if actual_epoch == epoch && main_target_idx == idx && virtual_time_msc == time_msc));
    }

    #[test]
    fn test_reconnect_restores_latest_position_even_when_paused_or_disconnected() {
        let handle = test_handle();
        init_test_session(&handle);
        handle.send_reset(2, 0, 0, 1000);
        handle.connected.store(true, std::sync::atomic::Ordering::Relaxed);
        handle.send_advance(2, 5, 0, 5000);
        handle.connected.store(false, std::sync::atomic::Ordering::Relaxed);
        assert_reconnect_position(&handle, 2, 5, 5000);

        handle.send_advance(2, 7, 0, 7000);
        assert_reconnect_position(&handle, 2, 7, 7000);

        // A later backward seek must replace the old forward position and epoch.
        handle.send_reset(3, 1, 0, 2000);
        assert_reconnect_position(&handle, 3, 1, 2000);
    }

    #[test]
    fn test_new_session_and_terminate_clear_reconnect_position() {
        let handle = test_handle();
        init_test_session(&handle);
        handle.send_advance(4, 5, 0, 5000);
        init_test_session(&handle);
        let commands = handle.reconnect_state.lock().unwrap().commands();
        assert_eq!(commands.len(), 1);
        assert!(matches!(commands[0], RenderPipeCommand::Init { .. }));

        handle.send_advance(1, 1, 0, 2000);
        handle.send_terminate(2);
        assert!(handle.reconnect_state.lock().unwrap().commands().is_empty());
        // A late advance from the stopped core must not resurrect a session.
        handle.send_advance(1, 2, 0, 3000);
        assert!(handle.reconnect_state.lock().unwrap().commands().is_empty());
    }

    #[test]
    fn test_unicode_profile_names_and_complete_utf8_truncation() {
        let profile = "検証用チャート📈";
        let bytes = RenderPacketCodec::encode_init(1, 1000, 9000, 0, 300, 0, "USDJPY", "", profile, "");
        let (_, payload) = RenderPacketCodec::read_packet(&mut std::io::Cursor::new(bytes)).unwrap();
        let init: &InitPayload = bytemuck::from_bytes(&payload);
        assert_eq!(std::str::from_utf8(&init.profile_name).unwrap().trim_end_matches('\0'), profile);

        let bytes = RenderPacketCodec::encode_apply_profile(1, profile, "USDJPY", "");
        let (_, payload) = RenderPacketCodec::read_packet(&mut std::io::Cursor::new(bytes)).unwrap();
        let applied: &ApplyProfilePayload = bytemuck::from_bytes(&payload);
        assert_eq!(std::str::from_utf8(&applied.profile_name).unwrap().trim_end_matches('\0'), profile);

        let long_profile = format!("{}検証", "a".repeat(62));
        let bytes = RenderPacketCodec::encode_apply_profile(1, &long_profile, "USDJPY", "");
        let (_, payload) = RenderPacketCodec::read_packet(&mut std::io::Cursor::new(bytes)).unwrap();
        let applied: &ApplyProfilePayload = bytemuck::from_bytes(&payload);
        assert_eq!(std::str::from_utf8(&applied.profile_name).unwrap().trim_end_matches('\0'), "a".repeat(62));
        assert_eq!(applied.profile_name[63], 0);
    }

    #[test]
    fn test_init_limits_distinct_additional_symbols_to_renderer_capacity() {
        let bytes = RenderPacketCodec::encode_init(
            1, 1000, 9000, 0, 300, 0, "USDJPY", "EURJPY", "Default",
            "USDJPY,EURJPY,GBPJPY,GBPJPY_Replay,EURUSD,GBPUSD,AUDUSD,NZDUSD,USDCHF,USDCAD,AUDJPY,CADJPY",
        );
        let (_, payload) = RenderPacketCodec::read_packet(&mut std::io::Cursor::new(bytes)).unwrap();
        let init: &InitPayload = bytemuck::from_bytes(&payload);
        let symbols = std::str::from_utf8(&init.additional_symbols).unwrap().trim_end_matches('\0');
        assert_eq!(symbols, "GBPJPY,EURUSD,GBPUSD,AUDUSD,NZDUSD,USDCHF,USDCAD,AUDJPY");
        assert_eq!(symbols.split(',').count(), MAX_SYNC_SYMBOLS);
    }

    #[test]
    fn test_render_packet_sizes() {
        assert_eq!(std::mem::size_of::<RenderHeader>(), 16);
        assert_eq!(std::mem::size_of::<HelloPayload>(), 72);
        assert_eq!(std::mem::size_of::<AdvancePayload>(), 24);
        assert_eq!(std::mem::size_of::<ResetPayload>(), 32);
        assert_eq!(std::mem::size_of::<AckPayload>(), 24);
        assert_eq!(std::mem::size_of::<ApplyProfilePayload>(), 128);
        assert_eq!(std::mem::size_of::<InitPayload>(), 704);
    }

    #[test]
    fn test_encode_and_read_advance() {
        let bytes = RenderPacketCodec::encode_advance(42, 1000, 500, 1720000000);
        let mut cursor = std::io::Cursor::new(bytes);
        let (header, payload) = RenderPacketCodec::read_packet(&mut cursor).unwrap();

        assert_eq!(header.magic, RENDER_MAGIC);
        assert_eq!(header.msg_type, MSG_ADVANCE);
        assert_eq!(header.epoch, 42);
        assert_eq!(payload.len(), std::mem::size_of::<AdvancePayload>());

        let adv: &AdvancePayload = bytemuck::from_bytes(&payload);
        assert_eq!(adv.main_idx, 1000);
        assert_eq!(adv.sub_idx, 500);
        assert_eq!(adv.virtual_time_msc, 1720000000);
    }

    #[test]
    fn test_encode_and_read_reset() {
        let bytes = RenderPacketCodec::encode_reset(5, 2000, 0, 1720005000);
        let mut cursor = std::io::Cursor::new(bytes);
        let (header, payload) = RenderPacketCodec::read_packet(&mut cursor).unwrap();

        assert_eq!(header.magic, RENDER_MAGIC);
        assert_eq!(header.msg_type, MSG_RESET);
        assert_eq!(header.epoch, 5);
        assert_eq!(payload.len(), std::mem::size_of::<ResetPayload>());

        let rst: &ResetPayload = bytemuck::from_bytes(&payload);
        assert_eq!(rst.main_target_idx, 2000);
        assert_eq!(rst.sub_target_idx, 0);
        assert_eq!(rst.virtual_time_msc, 1720005000);
    }

    #[test]
    fn test_encode_and_read_init() {
        let bytes = RenderPacketCodec::encode_init(
            1,
            1720000000,
            1720050000,
            0,
            300,
            0,
            "USDJPY.cl",
            "EURJPY",
            "Default",
            "EURJPY_2025,GBPJPY_2025",
        );
        let mut cursor = std::io::Cursor::new(bytes);
        let (header, payload) = RenderPacketCodec::read_packet(&mut cursor).unwrap();

        assert_eq!(header.magic, RENDER_MAGIC);
        assert_eq!(header.msg_type, MSG_INIT);
        assert_eq!(header.epoch, 1);
        assert_eq!(payload.len(), 704);

        let init: &InitPayload = bytemuck::from_bytes(&payload);
        assert_eq!(init.start_time_msc, 1720000000);
        assert_eq!(init.end_time_msc, 1720050000);
        assert_eq!(init.preloaded_bars, 300);
        assert_eq!(String::from_utf8_lossy(&init.source_symbol).trim_matches('\0'), "USDJPY.cl");
        assert_eq!(String::from_utf8_lossy(&init.sub_symbol).trim_matches('\0'), "EURJPY");
        assert_eq!(String::from_utf8_lossy(&init.profile_name).trim_matches('\0'), "Default");
        assert_eq!(String::from_utf8_lossy(&init.additional_symbols).trim_matches('\0'), "EURJPY_2025,GBPJPY_2025");
    }

    #[test]
    fn test_encode_and_read_apply_profile() {
        let bytes = RenderPacketCodec::encode_apply_profile(1, "Default", "USDJPY", "EURJPY");
        let mut cursor = std::io::Cursor::new(bytes);
        let (header, payload) = RenderPacketCodec::read_packet(&mut cursor).unwrap();

        assert_eq!(header.magic, RENDER_MAGIC);
        assert_eq!(header.msg_type, MSG_APPLY_PROFILE);
        assert_eq!(header.epoch, 1);
        assert_eq!(payload.len(), 128);

        let prof: &ApplyProfilePayload = bytemuck::from_bytes(&payload);
        assert_eq!(String::from_utf8_lossy(&prof.profile_name).trim_matches('\0'), "Default");
        assert_eq!(String::from_utf8_lossy(&prof.main_symbol).trim_matches('\0'), "USDJPY");
        assert_eq!(String::from_utf8_lossy(&prof.sub_symbol).trim_matches('\0'), "EURJPY");
    }
}
