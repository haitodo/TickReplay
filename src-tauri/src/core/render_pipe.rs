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

/// 0x0007 INIT ペイロード (Core -> EA, 192 bytes)
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
    pub fn encode_advance(epoch: u32, main_idx: u64, sub_idx: u64, virtual_time_msc: i64) -> Vec<u8> {
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

        let mut buf = Vec::with_capacity(RenderHeader::SIZE + std::mem::size_of::<AdvancePayload>());
        buf.extend_from_slice(bytemuck::bytes_of(&header));
        buf.extend_from_slice(bytemuck::bytes_of(&payload));
        buf
    }

    pub fn encode_reset(
        epoch: u32,
        main_target_idx: u64,
        sub_target_idx: u64,
        virtual_time_msc: i64,
    ) -> Vec<u8> {
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

        let mut buf = Vec::with_capacity(RenderHeader::SIZE + std::mem::size_of::<ResetPayload>());
        buf.extend_from_slice(bytemuck::bytes_of(&header));
        buf.extend_from_slice(bytemuck::bytes_of(&payload));
        buf
    }

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
            reserved: [0u8; 32],
        };
        let s_bytes = source_symbol.as_bytes();
        let s_len = s_bytes.len().min(31);
        payload.source_symbol[..s_len].copy_from_slice(&s_bytes[..s_len]);

        let sub_bytes = sub_symbol.as_bytes();
        let sub_len = sub_bytes.len().min(31);
        payload.sub_symbol[..sub_len].copy_from_slice(&sub_bytes[..sub_len]);

        let p_bytes = profile_name.as_bytes();
        let p_len = p_bytes.len().min(63);
        payload.profile_name[..p_len].copy_from_slice(&p_bytes[..p_len]);

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
        let p_bytes = profile_name.as_bytes();
        let p_len = p_bytes.len().min(63);
        payload.profile_name[..p_len].copy_from_slice(&p_bytes[..p_len]);

        let m_bytes = main_symbol.as_bytes();
        let m_len = m_bytes.len().min(31);
        payload.main_symbol[..m_len].copy_from_slice(&m_bytes[..m_len]);

        let s_bytes = sub_symbol.as_bytes();
        let s_len = s_bytes.len().min(31);
        payload.sub_symbol[..s_len].copy_from_slice(&s_bytes[..s_len]);

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
        let s_bytes = symbol.as_bytes();
        let s_len = s_bytes.len().min(31);
        payload.symbol[..s_len].copy_from_slice(&s_bytes[..s_len]);

        let g_bytes = group.as_bytes();
        let g_len = g_bytes.len().min(31);
        payload.group[..g_len].copy_from_slice(&g_bytes[..g_len]);

        let b_bytes = base_symbol.as_bytes();
        let b_len = b_bytes.len().min(31);
        payload.base_symbol[..b_len].copy_from_slice(&b_bytes[..b_len]);

        let bf_bytes = bin_file.as_bytes();
        let bf_len = bf_bytes.len().min(127);
        payload.bin_file[..bf_len].copy_from_slice(&bf_bytes[..bf_len]);

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

#[derive(Clone, Debug)]
pub struct RenderPipeHandle {
    cmd_tx: tokio::sync::mpsc::UnboundedSender<RenderPipeCommand>,
    connected: std::sync::Arc<std::sync::atomic::AtomicBool>,
    last_applied_idx: std::sync::Arc<std::sync::atomic::AtomicU64>,
    last_init: std::sync::Arc<std::sync::Mutex<Option<RenderPipeCommand>>>,
    last_reset: std::sync::Arc<std::sync::Mutex<Option<RenderPipeCommand>>>,
}

impl RenderPipeHandle {
    pub fn send_advance(&self, epoch: u32, main_idx: u64, sub_idx: u64, virtual_time_msc: i64) {
        if self.connected.load(std::sync::atomic::Ordering::Relaxed) {
            let _ = self.cmd_tx.send(RenderPipeCommand::Advance {
                epoch,
                main_idx,
                sub_idx,
                virtual_time_msc,
            });
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
        *self.last_reset.lock().unwrap() = Some(cmd.clone());
        let _ = self.cmd_tx.send(cmd);
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
        };
        *self.last_init.lock().unwrap() = Some(cmd.clone());
        let _ = self.cmd_tx.send(cmd);
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
        *self.last_init.lock().unwrap() = None;
        *self.last_reset.lock().unwrap() = None;
        let _ = self.cmd_tx.send(RenderPipeCommand::Terminate { epoch });
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
        let last_init = std::sync::Arc::new(std::sync::Mutex::new(None));
        let last_reset = std::sync::Arc::new(std::sync::Mutex::new(None));

        let connected_clone = connected.clone();
        let last_applied_clone = last_applied_idx.clone();
        let last_init_clone = last_init.clone();
        let last_reset_clone = last_reset.clone();

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

                    connected_clone.store(true, std::sync::atomic::Ordering::SeqCst);
                    println!("[RenderPipe] MT5 Renderer EA が接続されました。");

                    let (mut reader, mut writer) = tokio::io::split(server);

                    // 1. 初回 HELLO パケット受信待ち (2秒タイムアウト)
                    let mut header_buf = [0u8; RenderHeader::SIZE];
                    let mut symbol_str = "USDJPY".to_string();

                    if let Ok(Ok(_)) = tokio::time::timeout(std::time::Duration::from_secs(2), reader.read_exact(&mut header_buf)).await {
                        let header: RenderHeader = *bytemuck::from_bytes(&header_buf);
                        if header.is_valid() && header.msg_type == MSG_HELLO && header.payload_len > 0 {
                            let mut hello_buf = vec![0u8; header.payload_len as usize];
                            if let Ok(_) = reader.read_exact(&mut hello_buf).await {
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
                        while let Some(cmd) = rx_writer.recv().await {
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
                                RenderPipeCommand::Init { epoch, start_time_msc, end_time_msc, preload_date_msc, preloaded_bars, preload_mode, source_symbol, sub_symbol, profile_name } => {
                                    let packet = RenderPacketCodec::encode_init(epoch, start_time_msc, end_time_msc, preload_date_msc, preloaded_bars, preload_mode, &source_symbol, &sub_symbol, &profile_name);
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

                    // MT5再接続時または後から起動時に、保存済み INIT / RESET を自動再送信して状態を同期
                    if let Some(cmd) = last_init_clone.lock().unwrap().clone() {
                        println!("[RenderPipe] 接続された MT5 EA へ保存済み INIT を即座に送信");
                        let _ = tx_writer.send(cmd);
                    }
                    if let Some(cmd) = last_reset_clone.lock().unwrap().clone() {
                        println!("[RenderPipe] 接続された MT5 EA へ保存済み RESET を即座に送信");
                        let _ = tx_writer.send(cmd);
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
                                                    let ready_val = serde_json::json!({
                                                        "status": "READY",
                                                        "message": "MT5 Renderer EA ready",
                                                    });
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
            last_init,
            last_reset,
        };

        (handle, join_handle)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_render_packet_sizes() {
        assert_eq!(std::mem::size_of::<RenderHeader>(), 16);
        assert_eq!(std::mem::size_of::<HelloPayload>(), 72);
        assert_eq!(std::mem::size_of::<AdvancePayload>(), 24);
        assert_eq!(std::mem::size_of::<ResetPayload>(), 32);
        assert_eq!(std::mem::size_of::<AckPayload>(), 24);
        assert_eq!(std::mem::size_of::<ApplyProfilePayload>(), 128);
        assert_eq!(std::mem::size_of::<InitPayload>(), 192);
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
        );
        let mut cursor = std::io::Cursor::new(bytes);
        let (header, payload) = RenderPacketCodec::read_packet(&mut cursor).unwrap();

        assert_eq!(header.magic, RENDER_MAGIC);
        assert_eq!(header.msg_type, MSG_INIT);
        assert_eq!(header.epoch, 1);
        assert_eq!(payload.len(), 192);

        let init: &InitPayload = bytemuck::from_bytes(&payload);
        assert_eq!(init.start_time_msc, 1720000000);
        assert_eq!(init.end_time_msc, 1720050000);
        assert_eq!(init.preloaded_bars, 300);
        assert_eq!(String::from_utf8_lossy(&init.source_symbol).trim_matches('\0'), "USDJPY.cl");
        assert_eq!(String::from_utf8_lossy(&init.sub_symbol).trim_matches('\0'), "EURJPY");
        assert_eq!(String::from_utf8_lossy(&init.profile_name).trim_matches('\0'), "Default");
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
