use std::sync::Arc;
use crate::core::types::CoreTick;
use crate::custom_symbol::MqlTick;

/// メモリ内ティックストレージ
#[derive(Debug, Clone, Default)]
pub struct TickStore {
    ticks: Arc<Vec<CoreTick>>,
}

impl TickStore {
    pub fn empty() -> Self {
        Self {
            ticks: Arc::new(Vec::new()),
        }
    }

    pub fn from_core_ticks(ticks: Vec<CoreTick>) -> Self {
        Self {
            ticks: Arc::new(ticks),
        }
    }

    /// MqlTick (.bin形式) から CoreTick 配列へ一括変換
    pub fn from_mql_ticks(mql_ticks: &[MqlTick]) -> Self {
        let mut core_ticks = Vec::with_capacity(mql_ticks.len());
        for (i, mt) in mql_ticks.iter().enumerate() {
            core_ticks.push(CoreTick {
                index: i as u64,
                time_sec: mt.time,
                time_msc: mt.time_msc,
                bid: mt.bid,
                ask: mt.ask,
                last: mt.last,
                volume: mt.volume,
                volume_real: mt.volume_real,
                flags: mt.flags,
            });
        }
        Self {
            ticks: Arc::new(core_ticks),
        }
    }

    /// ExecutionTick 配列から CoreTick 配列へ一括変換
    pub fn from_execution_ticks(exec_ticks: &[crate::jfx_feed::ExecutionTick]) -> Self {
        let mut core_ticks = Vec::with_capacity(exec_ticks.len());
        for (i, et) in exec_ticks.iter().enumerate() {
            core_ticks.push(CoreTick {
                index: i as u64,
                time_sec: et.time_msc / 1000,
                time_msc: et.time_msc,
                bid: et.bid,
                ask: et.ask,
                last: 0.0,
                volume: 1,
                volume_real: 0.0,
                flags: 6,
            });
        }
        Self {
            ticks: Arc::new(core_ticks),
        }
    }

    /// MQL5 bin ファイルから直接ロード
    pub fn load_from_bin_file(path: &std::path::Path) -> Result<Self, std::io::Error> {
        let bytes = std::fs::read(path)?;
        if bytes.is_empty() || bytes.len() % std::mem::size_of::<MqlTick>() != 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Invalid MQL bin file size: {} bytes", bytes.len()),
            ));
        }
        let mql_ticks: &[MqlTick] = bytemuck::cast_slice(&bytes);
        Ok(Self::from_mql_ticks(mql_ticks))
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.ticks.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.ticks.is_empty()
    }

    #[inline]
    pub fn get(&self, index: usize) -> Option<&CoreTick> {
        self.ticks.get(index)
    }

    #[inline]
    pub fn first(&self) -> Option<&CoreTick> {
        self.ticks.first()
    }

    #[inline]
    pub fn last(&self) -> Option<&CoreTick> {
        self.ticks.last()
    }

    #[inline]
    pub fn min_time_msc(&self) -> Option<i64> {
        self.first().map(|t| t.time_msc)
    }

    #[inline]
    pub fn max_time_msc(&self) -> Option<i64> {
        self.last().map(|t| t.time_msc)
    }

    /// 指定ミリ秒時刻以下の最大のインデックス（現在値）を二分探索
    pub fn find_index_at_or_before(&self, target_msc: i64) -> Option<usize> {
        if self.ticks.is_empty() {
            return None;
        }

        match self.ticks.binary_search_by_key(&target_msc, |t| t.time_msc) {
            Ok(exact_idx) => {
                // 同一タイムスタンプの最後の要素を探す
                let mut idx = exact_idx;
                while idx + 1 < self.ticks.len() && self.ticks[idx + 1].time_msc == target_msc {
                    idx += 1;
                }
                Some(idx)
            }
            Err(insert_idx) => {
                if insert_idx == 0 {
                    Some(0)
                } else {
                    Some(insert_idx - 1)
                }
            }
        }
    }

    /// [from_msc, to_msc] の時間区間に含まれるインデックス範囲 [start_idx, end_idx] を算出
    pub fn range_for_time_interval(&self, from_msc: i64, to_msc: i64) -> Option<(usize, usize)> {
        if self.ticks.is_empty() || from_msc > to_msc {
            return None;
        }

        let start_idx = match self.ticks.binary_search_by_key(&from_msc, |t| t.time_msc) {
            Ok(exact) => {
                let mut idx = exact;
                while idx > 0 && self.ticks[idx - 1].time_msc == from_msc {
                    idx -= 1;
                }
                idx
            }
            Err(insert) => insert,
        };

        if start_idx >= self.ticks.len() {
            return None;
        }

        let end_idx = match self.ticks.binary_search_by_key(&to_msc, |t| t.time_msc) {
            Ok(exact) => {
                let mut idx = exact;
                while idx + 1 < self.ticks.len() && self.ticks[idx + 1].time_msc == to_msc {
                    idx += 1;
                }
                idx
            }
            Err(insert) => {
                if insert == 0 {
                    return None;
                }
                insert - 1
            }
        };

        if start_idx <= end_idx {
            Some((start_idx, end_idx))
        } else {
            None
        }
    }

    /// 指定インデックス範囲のスライスを取得
    pub fn slice(&self, start: usize, end_inclusive: usize) -> &[CoreTick] {
        if start >= self.ticks.len() || start > end_inclusive {
            return &[];
        }
        let end = (end_inclusive + 1).min(self.ticks.len());
        &self.ticks[start..end]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_ticks() -> Vec<CoreTick> {
        vec![
            CoreTick { index: 0, time_sec: 1, time_msc: 1000, bid: 150.0, ask: 150.005, last: 0.0, volume: 1, volume_real: 0.0, flags: 6 },
            CoreTick { index: 1, time_sec: 1, time_msc: 1050, bid: 150.001, ask: 150.006, last: 0.0, volume: 1, volume_real: 0.0, flags: 6 },
            CoreTick { index: 2, time_sec: 2, time_msc: 2000, bid: 150.002, ask: 150.007, last: 0.0, volume: 1, volume_real: 0.0, flags: 6 },
            CoreTick { index: 3, time_sec: 2, time_msc: 2000, bid: 150.003, ask: 150.008, last: 0.0, volume: 1, volume_real: 0.0, flags: 6 },
            CoreTick { index: 4, time_sec: 3, time_msc: 3000, bid: 150.004, ask: 150.009, last: 0.0, volume: 1, volume_real: 0.0, flags: 6 },
        ]
    }

    #[test]
    fn test_find_index_at_or_before() {
        let store = TickStore::from_core_ticks(dummy_ticks());
        assert_eq!(store.find_index_at_or_before(500), Some(0));
        assert_eq!(store.find_index_at_or_before(1000), Some(0));
        assert_eq!(store.find_index_at_or_before(1040), Some(0));
        assert_eq!(store.find_index_at_or_before(1050), Some(1));
        assert_eq!(store.find_index_at_or_before(1999), Some(1));
        assert_eq!(store.find_index_at_or_before(2000), Some(3)); // 同一タイムスタンプの最後の要素
        assert_eq!(store.find_index_at_or_before(2500), Some(3));
        assert_eq!(store.find_index_at_or_before(3000), Some(4));
        assert_eq!(store.find_index_at_or_before(4000), Some(4));
    }

    #[test]
    fn test_range_for_time_interval() {
        let store = TickStore::from_core_ticks(dummy_ticks());
        assert_eq!(store.range_for_time_interval(1000, 2000), Some((0, 3)));
        assert_eq!(store.range_for_time_interval(1050, 1050), Some((1, 1)));
        assert_eq!(store.range_for_time_interval(2500, 2900), None);
    }
}
