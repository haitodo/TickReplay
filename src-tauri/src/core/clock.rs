use std::time::Instant;
use chrono::{DateTime, Datelike, Timelike, Weekday};
use crate::core::types::{AbLoopConfig, PlaybackMode, PlaybackState, WeekendSkipConfig};

/// 高分解能仮想時計
#[derive(Debug)]
pub struct VirtualClock {
    /// 現在の仮想時刻 (MT5サーバー基準ミリ秒)
    virtual_time_msc: i64,
    /// 最小許容時刻 (データの開始点など)
    min_time_msc: i64,
    /// 最大許容時刻 (データの終了点など)
    max_time_msc: i64,
    /// 再生状態
    state: PlaybackState,
    /// 再生モード (Temporal / Count)
    mode: PlaybackMode,
    /// 倍速 (1.0 = 等倍, 10.0 = 10倍速)
    multiplier: f64,
    /// COUNT モード時の 1 秒あたりティック数
    #[allow(dead_code)]
    ticks_per_second: f64,
    /// 前回進行時の実時間タイムスタンプ
    last_real_instant: Instant,
    /// 1ms 未満の端数ミリ秒の累積
    fractional_ms_accumulator: f64,
    /// シークや不連続ジャンプの世代番号
    seek_epoch: u64,
    /// A-B ループ設定
    ab_loop: Option<AbLoopConfig>,
    /// 週末スキップ設定
    weekend_skip: WeekendSkipConfig,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClockAdvanceResult {
    /// 通常進行 (新旧時刻)
    Advanced { from_msc: i64, to_msc: i64 },
    /// ループ境界により A 地点へ巻き戻り
    LoopWrapped { from_msc: i64, to_msc: i64, epoch: u64 },
    /// 週末スキップにより月曜オープンへジャンプ
    WeekendSkipped { from_msc: i64, to_msc: i64 },
    /// 一時停止中、または終端到達のため不変
    Unchanged { current_msc: i64 },
}

impl VirtualClock {
    pub fn new(initial_time_msc: i64, min_msc: i64, max_msc: i64) -> Self {
        Self {
            virtual_time_msc: initial_time_msc,
            min_time_msc: min_msc,
            max_time_msc: max_msc,
            state: PlaybackState::Stopped,
            mode: PlaybackMode::Temporal,
            multiplier: 1.0,
            ticks_per_second: 50.0,
            last_real_instant: Instant::now(),
            fractional_ms_accumulator: 0.0,
            seek_epoch: 1,
            ab_loop: None,
            weekend_skip: WeekendSkipConfig::default(),
        }
    }

    #[inline]
    pub fn virtual_time_msc(&self) -> i64 {
        self.virtual_time_msc
    }

    #[inline]
    pub fn state(&self) -> PlaybackState {
        self.state
    }

    #[inline]
    pub fn is_playing(&self) -> bool {
        self.state == PlaybackState::Playing
    }

    #[inline]
    pub fn mode(&self) -> PlaybackMode {
        self.mode
    }

    #[inline]
    pub fn multiplier(&self) -> f64 {
        self.multiplier
    }

    #[inline]
    pub fn seek_epoch(&self) -> u64 {
        self.seek_epoch
    }

    #[inline]
    pub fn ab_loop(&self) -> Option<AbLoopConfig> {
        self.ab_loop
    }

    pub fn set_multiplier(&mut self, mult: f64) {
        self.multiplier = mult.clamp(0.01, 1000.0);
    }

    pub fn set_playback_mode(&mut self, mode: PlaybackMode) {
        self.mode = mode;
    }

    pub fn set_ab_loop(&mut self, loop_cfg: Option<AbLoopConfig>) {
        self.ab_loop = loop_cfg;
    }

    pub fn set_weekend_skip(&mut self, enabled: bool) {
        self.weekend_skip.enabled = enabled;
    }

    pub fn play(&mut self) {
        if self.state != PlaybackState::Playing {
            self.state = PlaybackState::Playing;
            self.last_real_instant = Instant::now();
            self.fractional_ms_accumulator = 0.0;
        }
    }

    pub fn pause(&mut self) {
        if self.state == PlaybackState::Playing {
            self.state = PlaybackState::Paused;
            self.fractional_ms_accumulator = 0.0;
        }
    }

    pub fn toggle_play(&mut self) {
        if self.is_playing() {
            self.pause();
        } else {
            self.play();
        }
    }

    /// 明示的なシーク（時刻指定）
    pub fn seek(&mut self, target_msc: i64) -> (i64, u64) {
        let clamped = target_msc.clamp(self.min_time_msc, self.max_time_msc);
        self.virtual_time_msc = clamped;
        self.fractional_ms_accumulator = 0.0;
        self.last_real_instant = Instant::now();
        self.seek_epoch = self.seek_epoch.wrapping_add(1);
        (self.virtual_time_msc, self.seek_epoch)
    }

    /// ステップ進行 (ミリ秒相対)
    pub fn step_time(&mut self, delta_msc: i64) -> (i64, u64) {
        let target = self.virtual_time_msc.saturating_add(delta_msc);
        self.seek(target)
    }

    /// 実時間の経過に基づいて仮想時計を進める
    pub fn advance_realtime(&mut self, now: Instant) -> ClockAdvanceResult {
        if !self.is_playing() {
            return ClockAdvanceResult::Unchanged {
                current_msc: self.virtual_time_msc,
            };
        }

        let elapsed = now.duration_since(self.last_real_instant);
        self.last_real_instant = now;

        let elapsed_secs = elapsed.as_secs_f64();
        if elapsed_secs <= 0.0 {
            return ClockAdvanceResult::Unchanged {
                current_msc: self.virtual_time_msc,
            };
        }

        let virtual_delta_ms_f64 = elapsed_secs * 1000.0 * self.multiplier;
        let total_delta_ms_f64 = virtual_delta_ms_f64 + self.fractional_ms_accumulator;
        let whole_delta_ms = total_delta_ms_f64.floor() as i64;
        self.fractional_ms_accumulator = total_delta_ms_f64 - (whole_delta_ms as f64);

        if whole_delta_ms <= 0 {
            return ClockAdvanceResult::Unchanged {
                current_msc: self.virtual_time_msc,
            };
        }

        let from_msc = self.virtual_time_msc;
        let mut to_msc = from_msc.saturating_add(whole_delta_ms);

        // 1. A-B ループ判定
        if let Some(loop_cfg) = self.ab_loop {
            if loop_cfg.enabled && to_msc >= loop_cfg.b_time_msc {
                self.virtual_time_msc = loop_cfg.a_time_msc;
                self.seek_epoch = self.seek_epoch.wrapping_add(1);
                self.fractional_ms_accumulator = 0.0;
                return ClockAdvanceResult::LoopWrapped {
                    from_msc,
                    to_msc: loop_cfg.a_time_msc,
                    epoch: self.seek_epoch,
                };
            }
        }

        // 2. 週末スキップ判定
        if self.weekend_skip.enabled {
            if let Some(skipped_to) = check_and_skip_weekend(to_msc, &self.weekend_skip) {
                self.virtual_time_msc = skipped_to;
                return ClockAdvanceResult::WeekendSkipped {
                    from_msc,
                    to_msc: skipped_to,
                };
            }
        }

        // 3. 最大時刻チェック
        if to_msc >= self.max_time_msc {
            to_msc = self.max_time_msc;
            self.state = PlaybackState::Paused;
        }

        self.virtual_time_msc = to_msc;
        ClockAdvanceResult::Advanced { from_msc, to_msc }
    }
}

/// 週末かどうか判定し、週末であれば月曜の開始時刻を返す
fn check_and_skip_weekend(time_msc: i64, cfg: &WeekendSkipConfig) -> Option<i64> {
    let dt = DateTime::from_timestamp_millis(time_msc)?.naive_utc();
    let weekday = dt.weekday();
    let hour = dt.hour();

    // 金曜クローズ後 (例: 金曜 23時以降)
    let is_friday_after_close = weekday == Weekday::Fri && hour >= cfg.friday_close_hour;
    // 土曜終日
    let is_saturday = weekday == Weekday::Sat;
    // 日曜 (月曜オープン前)
    let is_sunday = weekday == Weekday::Sun;

    if is_friday_after_close || is_saturday || is_sunday {
        // 次の月曜日の open_hour:00:00.000 を算出
        let days_to_add = match weekday {
            Weekday::Fri => 3,
            Weekday::Sat => 2,
            Weekday::Sun => 1,
            _ => 0,
        };
        let monday_date = dt.date() + chrono::Duration::days(days_to_add);
        let monday_open = monday_date
            .and_hms_opt(cfg.monday_open_hour, 0, 0)?
            .and_utc()
            .timestamp_millis();
        Some(monday_open)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn test_clock_basic_advance() {
        let mut clock = VirtualClock::new(1000, 0, 100_000);
        assert_eq!(clock.virtual_time_msc(), 1000);
        assert_eq!(clock.is_playing(), false);

        // 一時停止中は進まない
        let now = Instant::now();
        let res = clock.advance_realtime(now + Duration::from_millis(100));
        assert!(matches!(res, ClockAdvanceResult::Unchanged { .. }));

        // 再生開始
        clock.play();
        assert!(clock.is_playing());

        // 100ms 経過 (等倍)
        let res = clock.advance_realtime(clock.last_real_instant + Duration::from_millis(100));
        if let ClockAdvanceResult::Advanced { from_msc, to_msc } = res {
            assert_eq!(from_msc, 1000);
            assert_eq!(to_msc, 1100);
            assert_eq!(clock.virtual_time_msc(), 1100);
        } else {
            panic!("Expected Advanced, got {:?}", res);
        }

        // 2倍速で 100ms 経過 -> +200ms
        clock.set_multiplier(2.0);
        let res = clock.advance_realtime(clock.last_real_instant + Duration::from_millis(100));
        if let ClockAdvanceResult::Advanced { from_msc, to_msc } = res {
            assert_eq!(from_msc, 1100);
            assert_eq!(to_msc, 1300);
        } else {
            panic!("Expected Advanced, got {:?}", res);
        }
    }

    #[test]
    fn test_clock_ab_loop() {
        let mut clock = VirtualClock::new(1000, 0, 100_000);
        clock.set_ab_loop(Some(AbLoopConfig {
            enabled: true,
            a_time_msc: 1000,
            b_time_msc: 1500,
            a_index: None,
            b_index: None,
        }));
        clock.play();

        let initial_epoch = clock.seek_epoch();
        // 600ms 進めると 1600ms となり b_time_msc(1500) を超過 -> a_time_msc(1000) へループ
        let res = clock.advance_realtime(clock.last_real_instant + Duration::from_millis(600));
        if let ClockAdvanceResult::LoopWrapped { from_msc, to_msc, epoch } = res {
            assert_eq!(from_msc, 1000);
            assert_eq!(to_msc, 1000);
            assert_eq!(epoch, initial_epoch + 1);
            assert_eq!(clock.virtual_time_msc(), 1000);
        } else {
            panic!("Expected LoopWrapped, got {:?}", res);
        }
    }

    #[test]
    fn test_clock_seek() {
        let mut clock = VirtualClock::new(1000, 0, 100_000);
        let epoch0 = clock.seek_epoch();
        let (new_time, epoch1) = clock.seek(5000);
        assert_eq!(new_time, 5000);
        assert_eq!(epoch1, epoch0 + 1);
    }
}
