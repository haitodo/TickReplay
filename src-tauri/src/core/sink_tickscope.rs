use std::io::{self, Write};
use std::net::TcpStream;
use std::time::Duration;
use crate::core::types::CoreTick;

pub const MAGIC_TICK: u32 = 0x5449434B; // 'TICK'
pub const PROTOCOL_VERSION: u16 = 1;
pub const HEADER_LENGTH: u16 = 40;
pub const TICK_RECORD_LENGTH: usize = 72;
pub const HEARTBEAT_PAYLOAD_LENGTH: usize = 36;

pub const MSG_TYPE_TICK_BATCH: u16 = 1;
pub const MSG_TYPE_HEARTBEAT: u16 = 2;

/// TickScope ライブ受信部（TCP :39001〜:39005）へ直接ストリーミングする仮想ブローカーブリッジ
pub struct TickScopeBridge {
    host: String,
    port: u16,
    broker_id: u32,
    session_id: u64,
    next_sequence: u64,
    stream: Option<TcpStream>,
}

impl TickScopeBridge {
    pub fn new(broker_id: u32, port: u16) -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port,
            broker_id,
            session_id: 1,
            next_sequence: 1,
            stream: None,
        }
    }

    pub fn is_connected(&self) -> bool {
        self.stream.is_some()
    }

    pub fn connect(&mut self) -> io::Result<()> {
        let addr = format!("{}:{}", self.host, self.port);
        let stream = TcpStream::connect_timeout(
            &addr.parse().map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))?,
            Duration::from_millis(500),
        )?;
        stream.set_nodelay(true)?;
        stream.set_write_timeout(Some(Duration::from_secs(1)))?;
        self.stream = Some(stream);
        Ok(())
    }

    pub fn disconnect(&mut self) {
        self.stream = None;
    }

    /// ティック配列を一括バッチ送信
    pub fn send_tick_batch(&mut self, ticks: &[CoreTick]) -> io::Result<usize> {
        if ticks.is_empty() {
            return Ok(0);
        }

        if self.stream.is_none() {
            self.connect()?;
        }

        let tick_count = ticks.len() as u32;
        let payload_len = (ticks.len() * TICK_RECORD_LENGTH) as u32;
        let total_len = HEADER_LENGTH as usize + payload_len as usize;

        let seq_start = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(ticks.len() as u64);

        let mut buf = vec![0u8; total_len];

        // 1. ヘッダー (40 bytes)
        buf[0..4].copy_from_slice(&MAGIC_TICK.to_le_bytes());
        buf[4..6].copy_from_slice(&PROTOCOL_VERSION.to_le_bytes());
        buf[6..8].copy_from_slice(&MSG_TYPE_TICK_BATCH.to_le_bytes());
        buf[8..10].copy_from_slice(&HEADER_LENGTH.to_le_bytes());
        buf[10..12].copy_from_slice(&0u16.to_le_bytes()); // flags
        buf[12..16].copy_from_slice(&self.broker_id.to_le_bytes());
        buf[16..24].copy_from_slice(&self.session_id.to_le_bytes());
        buf[24..32].copy_from_slice(&seq_start.to_le_bytes());
        buf[32..36].copy_from_slice(&tick_count.to_le_bytes());
        buf[36..40].copy_from_slice(&payload_len.to_le_bytes());

        // 2. ペイロード (各 72 bytes)
        let mut offset = HEADER_LENGTH as usize;
        for (i, t) in ticks.iter().enumerate() {
            let seq = seq_start + i as u64;
            buf[offset..offset + 8].copy_from_slice(&seq.to_le_bytes());
            buf[offset + 8..offset + 16].copy_from_slice(&t.time_msc.to_le_bytes());
            buf[offset + 16..offset + 24].copy_from_slice(&0u64.to_le_bytes()); // ea_elapsed_us
            buf[offset + 24..offset + 32].copy_from_slice(&t.bid.to_le_bytes());
            buf[offset + 32..offset + 40].copy_from_slice(&t.ask.to_le_bytes());
            buf[offset + 40..offset + 48].copy_from_slice(&t.last.to_le_bytes());
            buf[offset + 48..offset + 56].copy_from_slice(&t.volume.to_le_bytes());
            buf[offset + 56..offset + 64].copy_from_slice(&t.volume_real.to_le_bytes());
            buf[offset + 64..offset + 68].copy_from_slice(&t.flags.to_le_bytes());
            buf[offset + 68..offset + 72].copy_from_slice(&0u32.to_le_bytes()); // reserved
            offset += TICK_RECORD_LENGTH;
        }

        // 送信
        let stream = self.stream.as_mut().unwrap();
        if let Err(e) = stream.write_all(&buf) {
            self.disconnect();
            return Err(e);
        }

        Ok(ticks.len())
    }

    /// ハートビート送信
    pub fn send_heartbeat(&mut self, last_tick_msc: i64) -> io::Result<()> {
        if self.stream.is_none() {
            self.connect()?;
        }

        let total_len = HEADER_LENGTH as usize + HEARTBEAT_PAYLOAD_LENGTH;
        let mut buf = vec![0u8; total_len];

        // ヘッダー
        buf[0..4].copy_from_slice(&MAGIC_TICK.to_le_bytes());
        buf[4..6].copy_from_slice(&PROTOCOL_VERSION.to_le_bytes());
        buf[6..8].copy_from_slice(&MSG_TYPE_HEARTBEAT.to_le_bytes());
        buf[8..10].copy_from_slice(&HEADER_LENGTH.to_le_bytes());
        buf[10..12].copy_from_slice(&0u16.to_le_bytes());
        buf[12..16].copy_from_slice(&self.broker_id.to_le_bytes());
        buf[16..24].copy_from_slice(&self.session_id.to_le_bytes());
        buf[24..32].copy_from_slice(&self.next_sequence.to_le_bytes());
        buf[32..36].copy_from_slice(&0u32.to_le_bytes());
        buf[36..40].copy_from_slice(&(HEARTBEAT_PAYLOAD_LENGTH as u32).to_le_bytes());

        // ペイロード
        let offset = HEADER_LENGTH as usize;
        buf[offset..offset + 8].copy_from_slice(&self.session_id.to_le_bytes());
        buf[offset + 8..offset + 16].copy_from_slice(&self.next_sequence.to_le_bytes());
        buf[offset + 16..offset + 24].copy_from_slice(&last_tick_msc.to_le_bytes());
        buf[offset + 24..offset + 28].copy_from_slice(&0i32.to_le_bytes()); // server_utc_offset_sec
        buf[offset + 28..offset + 36].copy_from_slice(&0u64.to_le_bytes()); // heartbeat_elapsed_us

        let stream = self.stream.as_mut().unwrap();
        if let Err(e) = stream.write_all(&buf) {
            self.disconnect();
            return Err(e);
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tick_batch_buffer_structure() {
        let bridge = TickScopeBridge::new(1, 39001);
        assert_eq!(bridge.broker_id, 1);
        assert_eq!(bridge.port, 39001);
        assert_eq!(bridge.is_connected(), false);
    }
}
