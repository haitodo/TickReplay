use chrono::{DateTime, Datelike};
use serde::{Deserialize, Serialize};
use crate::core::store::TickStore;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DayTimelineActivity {
    pub date_str: String,
    pub day_start_msc: i64,
    pub day_end_msc: i64,
    pub total_ticks_in_day: u32,
    pub slots_15m: Vec<f32>, // 96スロット (0.0..1.0)
    pub slots_1h: Vec<f32>,  // 24スロット (0.0..1.0)
    pub tyo_start_sec: u32,
    pub ldn_start_sec: u32,
    pub ny_start_sec: u32,
}

impl Default for DayTimelineActivity {
    fn default() -> Self {
        Self {
            date_str: String::new(),
            day_start_msc: 0,
            day_end_msc: 0,
            total_ticks_in_day: 0,
            slots_15m: vec![0.0; 96],
            slots_1h: vec![0.0; 24],
            tyo_start_sec: 6300,
            ldn_start_sec: 36000,
            ny_start_sec: 54000,
        }
    }
}

/// 指定された仮想時刻（ミリ秒）が属するサーバー日（00:00〜24:00）のタイムライン活動度を計算
pub fn compute_day_timeline_activity(
    store: &TickStore,
    virtual_time_msc: i64,
    min_floor: u32,
    max_cap: u32,
) -> DayTimelineActivity {
    if store.is_empty() {
        return DayTimelineActivity::default();
    }

    let target_sec = (virtual_time_msc / 1000).max(0);
    let naive_dt = DateTime::from_timestamp(target_sec, 0)
        .map(|dt| dt.naive_utc())
        .unwrap_or_else(|| {
            let first_msc = store.min_time_msc().unwrap_or(0);
            DateTime::from_timestamp((first_msc / 1000).max(0), 0)
                .map(|dt| dt.naive_utc())
                .unwrap_or_default()
        });

    let cur_date = naive_dt.date();
    let y = naive_dt.year();
    let m = naive_dt.month();
    let d = naive_dt.day();
    let is_dst = crate::pseudo_dmm::PseudoDmmEngine::is_us_dst(y, m, d, 12);

    let day_start = cur_date.and_hms_opt(0, 0, 0).unwrap_or_default();
    let day_end = cur_date.and_hms_opt(23, 59, 59).unwrap_or_default();
    let day_start_msc = day_start.and_utc().timestamp_millis();
    let day_end_msc = day_end.and_utc().timestamp_millis() + 999;

    let tyo_start_sec = if is_dst { 2 * 3600 + 45 * 60 } else { 3600 + 45 * 60 };
    let ldn_start_sec = 10 * 3600;
    let ny_start_sec = 15 * 3600;

    // 当日のティック区間を二分探索
    let (start_idx, end_idx) = match store.range_for_time_interval(day_start_msc, day_end_msc) {
        Some(range) => range,
        None => {
            return DayTimelineActivity {
                date_str: cur_date.format("%Y-%m-%d").to_string(),
                day_start_msc,
                day_end_msc,
                total_ticks_in_day: 0,
                slots_15m: vec![0.0; 96],
                slots_1h: vec![0.0; 24],
                tyo_start_sec,
                ldn_start_sec,
                ny_start_sec,
            };
        }
    };

    let total_ticks_in_day = (end_idx - start_idx + 1) as u32;

    // 15分スロット (96件) および 1時間スロット (24件) のカウント (スタック配列でヒープ割り当てゼロ)
    let mut raw_15m = [0u32; 96];
    let mut raw_1h = [0u32; 24];

    for idx in start_idx..=end_idx {
        if let Some(tick) = store.get(idx) {
            let offset_sec = (tick.time_msc - day_start_msc) / 1000;
            if (0..86400).contains(&offset_sec) {
                let slot_15 = (offset_sec / 900).clamp(0, 95) as usize;
                let slot_1h = (offset_sec / 3600).clamp(0, 23) as usize;
                raw_15m[slot_15] += 1;
                raw_1h[slot_1h] += 1;
            }
        }
    }

    // 飽和型スケーリング（Clamped Scaling）
    // 安全のための下限/上限チェック
    let safe_min_floor = min_floor.max(100);
    let safe_max_cap = max_cap.max(safe_min_floor);

    let max_15m = raw_15m.iter().copied().max().unwrap_or(0);
    // 分母を [safe_min_floor, safe_max_cap] の範囲にクランプ
    let denom_15m = (max_15m.clamp(safe_min_floor, safe_max_cap)) as f32;
    let slots_15m = raw_15m
        .iter()
        .map(|&c| (c as f32 / denom_15m).clamp(0.0, 1.0))
        .collect();

    let max_1h = raw_1h.iter().copied().max().unwrap_or(0);
    let denom_1h = (max_1h.clamp(safe_min_floor * 4, safe_max_cap * 4)) as f32;
    let slots_1h = raw_1h
        .iter()
        .map(|&c| (c as f32 / denom_1h).clamp(0.0, 1.0))
        .collect();

    DayTimelineActivity {
        date_str: cur_date.format("%Y-%m-%d").to_string(),
        day_start_msc,
        day_end_msc,
        total_ticks_in_day,
        slots_15m,
        slots_1h,
        tyo_start_sec,
        ldn_start_sec,
        ny_start_sec,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::types::CoreTick;

    #[test]
    fn test_compute_day_timeline_activity_empty() {
        let store = TickStore::empty();
        let res = compute_day_timeline_activity(&store, 1715731200000, 1500, 2800);
        assert_eq!(res.total_ticks_in_day, 0);
        assert_eq!(res.slots_15m.len(), 96);
        assert_eq!(res.slots_1h.len(), 24);
    }

    #[test]
    fn test_compute_day_timeline_activity_with_ticks() {
        // 2024-05-15 00:00:00 UTC = 1715731200000 ms
        let base_msc = 1715731200000i64;
        let mut ticks = Vec::new();

        // 10:00 UTC (10 * 3600 = 36000s) に 500 ティック生成 (スロット 40)
        for i in 0..500 {
            ticks.push(CoreTick {
                index: i as u64,
                time_sec: (base_msc / 1000) + 36000,
                time_msc: base_msc + 36000 * 1000 + i,
                bid: 155.0,
                ask: 155.02,
                last: 155.01,
                volume: 1,
                volume_real: 1.0,
                flags: 6,
            });
        }

        let store = TickStore::from_core_ticks(ticks);
        // min_floor=300, max_cap=2000 の場合、max_15m=500 なので denom_15m=500
        let res = compute_day_timeline_activity(&store, base_msc + 36000 * 1000, 300, 2000);

        assert_eq!(res.date_str, "2024-05-15");
        assert_eq!(res.total_ticks_in_day, 500);
        // 10:00 は 10 * 4 = 40スロット目 (15分刻み)
        assert!((res.slots_15m[40] - 1.0).abs() < 1e-4); // 500 / 500 = 1.0
        // その他のスロットは 0
        assert_eq!(res.slots_15m[0], 0.0);
        assert_eq!(res.slots_1h[0], 0.0);
    }

    #[test]
    fn test_compute_day_timeline_activity_max_cap() {
        // 指標スパイク時の上限キャップテスト
        let base_msc = 1715731200000i64;
        let mut ticks = Vec::new();

        // スロット 40 (10:00) に 6000 ティック (指標スパイク)
        for i in 0..6000 {
            ticks.push(CoreTick {
                index: i as u64,
                time_sec: (base_msc / 1000) + 36000,
                time_msc: base_msc + 36000 * 1000 + (i * 100),
                bid: 155.0,
                ask: 155.02,
                last: 155.01,
                volume: 1,
                volume_real: 1.0,
                flags: 6,
            });
        }

        // スロット 16 (04:00 東京時間) に 1400 ティック (通常取引)
        for i in 0..1400 {
            ticks.push(CoreTick {
                index: (6000 + i) as u64,
                time_sec: (base_msc / 1000) + 14400,
                time_msc: base_msc + 14400 * 1000 + (i * 100),
                bid: 155.0,
                ask: 155.02,
                last: 155.01,
                volume: 1,
                volume_real: 1.0,
                flags: 6,
            });
        }

        let store = TickStore::from_core_ticks(ticks);
        // max_cap=2800 を指定。6000 ティックあっても分母は 2800 で頭打ち。
        let res = compute_day_timeline_activity(&store, base_msc + 36000 * 1000, 1500, 2800);

        // 指標スロットは 1.0 (飽和)
        assert_eq!(res.slots_15m[40], 1.0);
        // 東京通常取引スロット (1400T) は 1400 / 2800 = 0.50 (シアン〜中活動)
        assert!((res.slots_15m[16] - 0.50).abs() < 1e-4);
        // 0.15 未満に押し潰されていないことを確認
        assert!(res.slots_15m[16] > 0.15);
    }

    #[test]
    fn test_compute_day_timeline_activity_min_floor() {
        // 閑散日の下限フロアテスト
        let base_msc = 1715731200000i64;
        let mut ticks = Vec::new();

        // 1日を通して最大でも 150 ティックしかない薄商い日
        for i in 0..150 {
            ticks.push(CoreTick {
                index: i as u64,
                time_sec: (base_msc / 1000) + 36000,
                time_msc: base_msc + 36000 * 1000 + (i * 1000),
                bid: 155.0,
                ask: 155.02,
                last: 155.01,
                volume: 1,
                volume_real: 1.0,
                flags: 6,
            });
        }

        let store = TickStore::from_core_ticks(ticks);
        // min_floor=1500 を指定。ピーク 150 でも分母は 1500 になる。
        let res = compute_day_timeline_activity(&store, base_msc + 36000 * 1000, 1500, 2800);

        // 150 / 1500 = 0.10 (< 0.15 なので無風スキップ判定を満たす)
        assert!((res.slots_15m[40] - 0.10).abs() < 1e-4);
        assert!(res.slots_15m[40] < 0.15);
    }
}


