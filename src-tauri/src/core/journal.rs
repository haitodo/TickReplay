use serde::{Deserialize, Serialize};
use crate::core::types::OrderSide;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum JournalEvent {
    /// 注文の発注操作 (ユーザーによるクリック)
    OrderSubmitted {
        order_id: u64,
        click_time_msc: i64,
        symbol: String,
        side: OrderSide,
        volume: f64,
        sl_points: f64,
        tp_points: f64,
        request_price: f64,
        comment: Option<String>,
    },
    /// 注文の約定成立
    OrderFilled {
        ticket: i32,
        order_id: u64,
        fill_time_msc: i64,
        fill_price: f64,
        slippage_pips: f64,
        latency_ms: i64,
    },
    /// 建玉の決済 (成行手動、SL/TP自動、一括全決済)
    PositionClosed {
        ticket: i32,
        close_time_msc: i64,
        close_price: f64,
        profit: f64,
        reason: String,
    },
    /// 指値・逆指値（SL/TP）の変更
    PositionModified {
        ticket: i32,
        modified_time_msc: i64,
        new_sl: Option<f64>,
        new_tp: Option<f64>,
    },
    /// シークによるタイムトラベル
    SeekOccurred {
        target_time_msc: i64,
        epoch: u64,
    },
    /// 口座リセット
    AccountReset {
        initial_balance: f64,
        time_msc: i64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalEntry {
    pub seq: u64,
    pub timestamp_msc: i64,
    pub event: JournalEvent,
}

/// 約定監査レポート用レコード (K1, K2 検証用)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionAuditRecord {
    pub ticket: i32,
    pub symbol: String,
    pub side: String,
    pub volume: f64,
    pub click_time_msc: i64,
    pub fill_time_msc: i64,
    pub latency_ms: i64,
    pub request_price: f64,
    pub fill_price: f64,
    pub slippage_pips: f64,
}

/// 操作ジャーナル管理ストア
#[derive(Debug, Clone, Default)]
pub struct JournalStore {
    entries: Vec<JournalEntry>,
    next_seq: u64,
    revision: u64,
}

impl JournalStore {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            next_seq: 1,
            revision: 1,
        }
    }

    #[inline]
    pub fn revision(&self) -> u64 {
        self.revision
    }

    #[inline]
    pub fn entries(&self) -> &[JournalEntry] {
        &self.entries
    }

    pub fn record(&mut self, timestamp_msc: i64, event: JournalEvent) -> u64 {
        let seq = self.next_seq;
        self.next_seq += 1;
        self.revision = self.revision.wrapping_add(1);

        self.entries.push(JournalEntry {
            seq,
            timestamp_msc,
            event,
        });

        seq
    }

    /// タイムトラベル（指定時刻より未来の操作イベントを切り捨て）
    pub fn truncate_future(&mut self, target_time_msc: i64) {
        let initial_len = self.entries.len();
        self.entries.retain(|entry| entry.timestamp_msc <= target_time_msc);
        if self.entries.len() != initial_len {
            self.revision = self.revision.wrapping_add(1);
            self.next_seq = self.entries.last().map(|e| e.seq + 1).unwrap_or(1);
        }
    }

    /// 全クリア
    pub fn clear(&mut self) {
        self.entries.clear();
        self.next_seq = 1;
        self.revision = self.revision.wrapping_add(1);
    }
}
