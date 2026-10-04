use std::io::{self, Read};

pub const RENDER_PIPE_NAME: &str = r"\\.\pipe\tick_replay_render";
pub const RENDER_MAGIC: u32 = 0x54525232; // 'TRR2' (Tick Replay Renderer v2)

pub const MSG_HELLO: u16 = 0x0001;
pub const MSG_ADVANCE: u16 = 0x0002;
pub const MSG_RESET: u16 = 0x0003;
pub const MSG_ACK: u16 = 0x0004;
pub const MSG_READY: u16 = 0x0005;

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

/// 0x0001 HELLO ペイロード (EA -> Core, 40 bytes)
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, bytemuck::Pod, bytemuck::Zeroable)]
pub struct HelloPayload {
    pub ea_version: u32,
    pub reserved: u32,
    pub main_ticks: u64,
    pub main_hash: u64,
    pub sub_ticks: u64,
    pub sub_hash: u64,
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
    pub main_preload_from: u64,
    pub sub_target_idx: u64,
    pub sub_preload_from: u64,
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
        main_preload_from: u64,
        sub_target_idx: u64,
        sub_preload_from: u64,
    ) -> Vec<u8> {
        let payload = ResetPayload {
            main_target_idx,
            main_preload_from,
            sub_target_idx,
            sub_preload_from,
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
        main_preload_from: u64,
        sub_target_idx: u64,
        sub_preload_from: u64,
    },
}

#[derive(Clone, Debug)]
pub struct RenderPipeHandle {
    cmd_tx: tokio::sync::mpsc::UnboundedSender<RenderPipeCommand>,
    connected: std::sync::Arc<std::sync::atomic::AtomicBool>,
    last_applied_idx: std::sync::Arc<std::sync::atomic::AtomicU64>,
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
        main_preload_from: u64,
        sub_target_idx: u64,
        sub_preload_from: u64,
    ) {
        if self.connected.load(std::sync::atomic::Ordering::Relaxed) {
            let _ = self.cmd_tx.send(RenderPipeCommand::Reset {
                epoch,
                main_target_idx,
                main_preload_from,
                sub_target_idx,
                sub_preload_from,
            });
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

        let connected_clone = connected.clone();
        let last_applied_clone = last_applied_idx.clone();

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

                    // 1. 初回 HELLO パケット受信待ち
                    let mut header_buf = [0u8; RenderHeader::SIZE];
                    if let Ok(_) = reader.read_exact(&mut header_buf).await {
                        let header: RenderHeader = *bytemuck::from_bytes(&header_buf);
                        if header.is_valid() && header.msg_type == MSG_HELLO && header.payload_len >= std::mem::size_of::<HelloPayload>() as u32 {
                            let mut hello_buf = vec![0u8; header.payload_len as usize];
                            let _ = reader.read_exact(&mut hello_buf).await;
                            let hello: &HelloPayload = bytemuck::from_bytes(&hello_buf[0..std::mem::size_of::<HelloPayload>()]);
                            println!(
                                "[RenderPipe] HELLO パケット受信: EA v{:.2}, main_ticks={}, sub_ticks={}",
                                hello.ea_version as f64 / 100.0,
                                hello.main_ticks,
                                hello.sub_ticks
                            );
                        }
                    }

                    // フロントエンドへ CONNECTED を通知
                    if let Some(ref app) = app_handle {
                        let status_val = serde_json::json!({
                            "status": "CONNECTED",
                            "message": "MT5 Renderer EA connected",
                            "protocol": "TRR2"
                        });
                        let status_str = status_val.to_string();
                        let _ = app.emit("mt5-status", &status_str);
                        let _ = app.emit("mt5-connected", ());
                        if let Some(ref st) = state {
                            let _ = st.sync_tx.send(status_str);
                        }
                    }

                    // 2. コマンド送受信ループ
                    loop {
                        tokio::select! {
                            cmd_opt = cmd_rx.recv() => {
                                match cmd_opt {
                                    Some(RenderPipeCommand::Advance { epoch, main_idx, sub_idx, virtual_time_msc }) => {
                                        let packet = RenderPacketCodec::encode_advance(epoch, main_idx, sub_idx, virtual_time_msc);
                                        if let Err(e) = writer.write_all(&packet).await {
                                            eprintln!("[RenderPipe] ADVANCE 送信エラー: {}", e);
                                            break;
                                        }

                                        // ACK 受信待ち
                                        let mut ack_header_buf = [0u8; RenderHeader::SIZE];
                                        if let Ok(_) = reader.read_exact(&mut ack_header_buf).await {
                                            let ack_hdr: RenderHeader = *bytemuck::from_bytes(&ack_header_buf);
                                            if ack_hdr.is_valid() && ack_hdr.msg_type == MSG_ACK && ack_hdr.payload_len >= std::mem::size_of::<AckPayload>() as u32 {
                                                let mut ack_payload_buf = [0u8; std::mem::size_of::<AckPayload>()];
                                                if let Ok(_) = reader.read_exact(&mut ack_payload_buf).await {
                                                    let ack: &AckPayload = bytemuck::from_bytes(&ack_payload_buf);
                                                    last_applied_clone.store(ack.main_applied_idx, std::sync::atomic::Ordering::Relaxed);
                                                }
                                            }
                                        } else {
                                            break;
                                        }
                                    }
                                    Some(RenderPipeCommand::Reset { epoch, main_target_idx, main_preload_from, sub_target_idx, sub_preload_from }) => {
                                        let packet = RenderPacketCodec::encode_reset(epoch, main_target_idx, main_preload_from, sub_target_idx, sub_preload_from);
                                        if let Err(e) = writer.write_all(&packet).await {
                                            eprintln!("[RenderPipe] RESET 送信エラー: {}", e);
                                            break;
                                        }
                                        // READY 受信待ち
                                        let mut ready_buf = [0u8; RenderHeader::SIZE];
                                        if let Ok(_) = reader.read_exact(&mut ready_buf).await {
                                            let hdr: RenderHeader = *bytemuck::from_bytes(&ready_buf);
                                            if hdr.is_valid() && hdr.msg_type == MSG_READY {
                                                last_applied_clone.store(main_target_idx, std::sync::atomic::Ordering::Relaxed);
                                                if let Some(ref app) = app_handle {
                                                    let status_val = serde_json::json!({
                                                        "status": "READY",
                                                        "message": "MT5 Renderer EA ready",
                                                        "current_idx": main_target_idx,
                                                    });
                                                    let status_str = status_val.to_string();
                                                    let _ = app.emit("mt5-status", &status_str);
                                                    if let Some(ref st) = state {
                                                        let _ = st.sync_tx.send(status_str);
                                                    }
                                                }
                                            }
                                        } else {
                                            break;
                                        }
                                    }
                                    None => {
                                        // シャットダウン
                                        return;
                                    }
                                }
                            }
                        }
                    }

                    connected_clone.store(false, std::sync::atomic::Ordering::SeqCst);
                    println!("[RenderPipe] MT5 Renderer EA が切断されました。再接続待機中...");

                    if let Some(ref app) = app_handle {
                        let status_val = serde_json::json!({
                            "status": "DISCONNECTED",
                            "message": "MT5 Renderer EA disconnected",
                        });
                        let status_str = status_val.to_string();
                        let _ = app.emit("mt5-status", &status_str);
                        let _ = app.emit("mt5-disconnected", ());
                        if let Some(ref st) = state {
                            let _ = st.sync_tx.send(status_str);
                        }
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
        assert_eq!(std::mem::size_of::<HelloPayload>(), 40);
        assert_eq!(std::mem::size_of::<AdvancePayload>(), 24);
        assert_eq!(std::mem::size_of::<ResetPayload>(), 32);
        assert_eq!(std::mem::size_of::<AckPayload>(), 24);
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
}
