use chrono::{Datelike, Timelike};
use crate::pseudo_dmm::{EconomicEvent, PseudoDmmEngine};

/// JFX クォーティング特性 (2026年2月〜10月実測統計 2,136万ティックから導出)
pub mod jfx_characteristics {
    /// 通常時の基準スプレッド (0.2 pips = 2 points)
    pub const BASE_SPREAD_PIPS: f64 = 0.2;

    /// 最大スプレッド上限 (15.0 pips = 150 points)
    pub const MAX_SPREAD_PIPS: f64 = 15.0;
}

/// JFX特化型 擬似レート生成エンジン (零遅延・インパルス保存・Change-Driven型)
pub struct PseudoJfxEngine {
    pub symbol: String,
    pub year: i32,
    pub month: u32,
    pub events: Vec<EconomicEvent>,
    /// 通貨ペアに応じた 0.1pip (1point) の価格単位 (JPYペア: 0.001, 非JPYペア: 0.00001)
    point_size: f64,
    /// 価格から整数ポイントへの変換倍率 (JPYペア: 1000.0, 非JPYペア: 100_000.0)
    point_scale: f64,
    // 前回の生クォート (1pt = 0.1pip 単位の整数ポイント)
    last_raw_b_pt: i64,
    last_raw_a_pt: i64,
    last_raw_sum_pt: i64,
    last_q_pt: i64,
    // 前回の出力クォート (整数ポイントによる厳密Change-Driven判定用)
    last_emitted_bid_pt: i64,
    last_emitted_ask_pt: i64,
    // 直近10秒間のボラティリティ追跡 (mt5_ms, mid_pips)
    recent_ticks: Vec<(i64, i64)>,
}

impl PseudoJfxEngine {
    /// 新しいエンジンインスタンスを生成
    pub fn new(symbol: &str, year_month: &str) -> Self {
        Self::new_with_custom_dir(symbol, year_month, None)
    }

    /// 経済指標フォルダーを明示指定して新しいエンジンインスタンスを生成
    pub fn new_with_custom_dir(symbol: &str, year_month: &str, custom_dir: Option<&str>) -> Self {
        let parts: Vec<&str> = year_month.split('-').collect();
        let year: i32 = parts.first().and_then(|s| s.parse().ok()).unwrap_or(2026);
        let month: u32 = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(8);

        let sym_upper = symbol.to_uppercase();
        let is_jpy = sym_upper.contains("JPY");
        let (point_size, point_scale) = if is_jpy {
            (0.001, 1_000.0)
        } else {
            (0.00001, 100_000.0)
        };

        let profiles = PseudoDmmEngine::load_profile_matrix();
        let mut events = PseudoDmmEngine::load_events_for_month(&sym_upper, year, month, &profiles, custom_dir);
        // Tier 1〜3 (高・中重要度) のみ保持し、Tier 4 (低重要度・スプレッド拡大対象外) を事前除外
        events.retain(|e| e.tier <= 3);

        Self {
            symbol: sym_upper,
            year,
            month,
            events,
            point_size,
            point_scale,
            last_raw_b_pt: 0,
            last_raw_a_pt: 0,
            last_raw_sum_pt: 0,
            last_q_pt: 0,
            last_emitted_bid_pt: 0,
            last_emitted_ask_pt: 0,
            recent_ticks: Vec::with_capacity(256),
        }
    }

    /// 単一ティックを JFX 特性に合わせて変換
    /// Change-Driven 方式: 量子化後の Bid および Ask が直前と同一の場合は None を返す
    #[inline]
    pub fn process_tick(
        &mut self,
        mt5_time_msc: i64,
        raw_bid: f64,
        raw_ask: f64,
    ) -> Option<(f64, f64, f64)> {
        // --- 1. ポイント整数空間 (1pt = 0.1pip) での厳密計算 ---
        let b_pt = (raw_bid * self.point_scale).round() as i64;
        let a_pt = (raw_ask * self.point_scale).round() as i64;
        let sum_pt = b_pt + a_pt; // 2 * mid_pt

        let q_pt = if self.last_raw_sum_pt == 0 {
            // 初回ティック初期化
            sum_pt / 2
        } else if sum_pt == self.last_raw_sum_pt {
            // 生Mid(sum_pt)が不変の場合は前回の量子化価格を維持 (インパルス切り上げ後の同値落下を防止)
            self.last_q_pt
        } else {
            let da_pt = a_pt - self.last_raw_a_pt;
            let db_pt = b_pt - self.last_raw_b_pt;
            let d_sum = sum_pt - self.last_raw_sum_pt;

            // --- 2. 方向性インパルス量子化 (M_OPT) ---
            // 上方向インパルス (買い先行ブレイク da >= 2 かつ db >= 0、または sum_pt が 3pt以上急変):
            // 切り上げ (sum_pt + 1) / 2 を採用し、OANDAの50ms非同期分割によるスパイク減衰を完全防止。
            // 通常時および下方向移動時:
            // 切り捨て sum_pt / 2 を採用し、OANDAの +0.018p 上方バイアスを相殺しつつ
            // 片側1ptのスプレッド伸縮による偽チャタリングを遮断。
            let up_impulse = (da_pt >= 2 && db_pt >= 0) || (d_sum >= 3);
            if up_impulse {
                (sum_pt + 1) / 2
            } else {
                sum_pt / 2
            }
        };

        self.last_raw_b_pt = b_pt;
        self.last_raw_a_pt = a_pt;
        self.last_raw_sum_pt = sum_pt;
        self.last_q_pt = q_pt;

        // --- 3. JST 時刻情報の分解 ---
        let naive_mt5_sec = mt5_time_msc / 1000;
        let naive_dt = chrono::DateTime::from_timestamp(naive_mt5_sec, 0)
            .map(|dt| dt.naive_utc())
            .unwrap_or_default();
        let y = naive_dt.year();
        let m = naive_dt.month();
        let d = naive_dt.day();
        let h = naive_dt.hour();
        let is_dst = PseudoDmmEngine::is_us_dst(y, m, d, h);

        let offset_ms = if is_dst { 3 * 3600 * 1000 } else { 2 * 3600 * 1000 };
        let utc_ms = mt5_time_msc - offset_ms;
        let jst_ms = utc_ms + 9 * 3600 * 1000;

        let jst_sec = jst_ms / 1000;
        let jst_dt = chrono::DateTime::from_timestamp(jst_sec, 0)
            .map(|dt| dt.naive_utc())
            .unwrap_or_default();
        let jst_hour = jst_dt.hour();
        let jst_min = jst_dt.minute();

        // --- 4. JFX 実測準拠スプレッド制御 (pips単位で計算し、最後に整数ポイントへ変換) ---
        // 通常時 & 東京仲値: 原則 0.2 pips (2 points) 固定
        let mut target_spread_pips = jfx_characteristics::BASE_SPREAD_PIPS;

        // 早朝ロールオーバー (夏時間: 05:59〜07:15 JST / 冬時間: 06:59〜08:15 JST)
        let rollover_hour = if is_dst { 6 } else { 7 };
        let pre_hour = rollover_hour - 1;

        if jst_hour == pre_hour && jst_min == 59 {
            // 05:59 / 06:59: 直前拡大 (実測P50 = 3.2 pips)
            target_spread_pips = target_spread_pips.max(3.2);
        } else if jst_hour == rollover_hour {
            let early_pips = if jst_min <= 20 {
                // 06:11〜06:20 (06:00〜06:10はメンテ休止): 実測P50 = 9.8 pips
                9.8
            } else if jst_min <= 30 {
                // 06:21〜06:30: 実測P50 = 8.5 pips
                8.5
            } else {
                // 06:31〜06:59: 実測P50 = 5.9 pips 固定
                5.9
            };
            target_spread_pips = target_spread_pips.max(early_pips);
        } else if jst_hour == rollover_hour + 1 {
            if jst_min < 5 {
                // 07:00〜07:04: 実測P50 = 3.6 pips
                target_spread_pips = target_spread_pips.max(3.6);
            } else if jst_min < 11 {
                // 07:05〜07:10: 実測P50 = 1.5 pips -> 1.1 pips
                let progress = (jst_min - 5) as f64 / 6.0;
                let early_pips = 1.5 - (1.5 - 1.1) * progress;
                target_spread_pips = target_spread_pips.max(early_pips);
            } else if jst_min < 15 {
                // 07:11〜07:14: 1.1 pips から 0.2 pips へ復帰
                let progress = (jst_min - 11) as f64 / 4.0;
                let early_pips = 1.1 - (1.1 - 0.2) * progress;
                target_spread_pips = target_spread_pips.max(early_pips);
            }
        }

        // OANDA生スプレッド (pips単位: 1pt = 0.1pip)
        let raw_oanda_spread_pips = (a_pt - b_pt).max(0) as f64 * 0.1;

        // 経済指標動的制御 (イベント近傍にある場合のみボラティリティ追跡を実行)
        if !self.events.is_empty() {
            let is_near_event = self.events.iter().any(|ev| {
                let adv_ms = match ev.tier {
                    1 => 15_000,
                    2 => 10_000,
                    _ => 5_000,
                };
                mt5_time_msc >= (ev.mt5_ms - adv_ms - 10_000) && mt5_time_msc <= (ev.mt5_ms + ev.recovery_ms)
            });

            if is_near_event {
                let cutoff_10s = mt5_time_msc - 10_000;
                self.recent_ticks.retain(|&(t, _)| t >= cutoff_10s);
                self.recent_ticks.push((mt5_time_msc, q_pt));

                let mut min_q = q_pt;
                let mut max_q = q_pt;
                for &(_, p) in &self.recent_ticks {
                    if p < min_q { min_q = p; }
                    if p > max_q { max_q = p; }
                }
                let price_volatility_10s_pips = (max_q - min_q) as f64 * 0.1;

                for ev in &self.events {
                    let adv_ms = match ev.tier {
                        1 => 15_000,
                        2 => 10_000,
                        3 => 5_000,
                        _ => continue,
                    };
                    let t_start = ev.mt5_ms - adv_ms;
                    let t_end = ev.mt5_ms + ev.recovery_ms;

                    if mt5_time_msc >= t_start && mt5_time_msc <= t_end {
                        let ind_pips = if mt5_time_msc < ev.mt5_ms {
                            let rel_sec = (mt5_time_msc - ev.mt5_ms) as f64 / 1000.0;
                            match ev.tier {
                                1 => {
                                    // Tier 1 (NFP, CPI): -15s〜-5s (0.2->2.5p), -5s〜-1s (2.5->3.2p), -1s〜0s (3.2->7.9p)
                                    if rel_sec < -5.0 {
                                        0.2 + (2.5 - 0.2) * ((rel_sec + 15.0) / 10.0).max(0.0)
                                    } else if rel_sec < -1.0 {
                                        2.5 + (3.2 - 2.5) * ((rel_sec + 5.0) / 4.0)
                                    } else {
                                        3.2 + (7.9 - 3.2) * ((rel_sec + 1.0) / 1.0)
                                    }
                                }
                                2 => {
                                    // Tier 2 (ISM, 小売等): -10s〜-1s (0.2->2.0p), -1s〜0s (2.0->4.5p)
                                    if rel_sec < -1.0 {
                                        0.2 + (2.0 - 0.2) * ((rel_sec + 10.0) / 9.0).max(0.0)
                                    } else {
                                        2.0 + (4.5 - 2.0) * ((rel_sec + 1.0) / 1.0)
                                    }
                                }
                                _ => {
                                    // Tier 3 (中重要度): -5s〜0s (0.2->1.8p)
                                    0.2 + (1.8 - 0.2) * ((rel_sec + 5.0) / 5.0).max(0.0)
                                }
                            }
                        } else if mt5_time_msc <= ev.mt5_ms + 10_000 {
                            // 初動ピークフェーズ (T 〜 T+10s)
                            let (base_peak_pips, max_cap_pips) = match ev.tier {
                                1 => (7.9, 14.9),
                                2 => (4.5, 8.0),
                                _ => (1.8, 3.5),
                            };
                            let oanda_excess_pips = (raw_oanda_spread_pips - 0.6).max(0.0);
                            let dyn_pips = base_peak_pips + 0.30 * oanda_excess_pips + 0.40 * price_volatility_10s_pips;
                            dyn_pips.min(max_cap_pips)
                        } else {
                            // 収束フェーズ (T+10s 〜 T+recovery): 2次減衰
                            let decay_start_pips = match ev.tier {
                                1 => 4.5,
                                2 => 3.0,
                                _ => 1.2,
                            };
                            let rem_progress = ((mt5_time_msc - (ev.mt5_ms + 10_000)) as f64
                                / ((ev.recovery_ms - 10_000) as f64).max(1.0))
                                .clamp(0.0, 1.0);
                            let decay = (1.0 - rem_progress).powi(2);
                            0.2 + (decay_start_pips - 0.2) * decay
                        };

                        if ind_pips > target_spread_pips {
                            target_spread_pips = ind_pips;
                        }
                    }
                }
            } else if !self.recent_ticks.is_empty() {
                self.recent_ticks.clear();
            }
        }

        // 突発ボラティリティ連動 (指標スケジュール外の急激なスプレッド拡大)
        if raw_oanda_spread_pips > 0.8 {
            let stress_pips = 0.2 + 0.35 * (raw_oanda_spread_pips - 0.8);
            if stress_pips > target_spread_pips {
                target_spread_pips = stress_pips;
            }
        }

        let clamped_pips = target_spread_pips.clamp(
            jfx_characteristics::BASE_SPREAD_PIPS,
            jfx_characteristics::MAX_SPREAD_PIPS,
        );

        // --- 5. ポイント整数空間での Bid / Ask 確定 (ask - bid == spread を100%保証) ---
        let spr_pt = (clamped_pips * 10.0).round().max(2.0) as i64;
        let jfx_bid_pt = q_pt - (spr_pt / 2);
        let jfx_ask_pt = jfx_bid_pt + spr_pt;

        // --- 6. 厳密 Change-Driven 判定 ---
        // JFX実データ (99.5%が変化時配信) に準拠:
        // 量子化後の Bid または Ask が直前と1ptでも変化した場合のみ出力し、完全同値は None で間引く
        if self.last_emitted_bid_pt > 0
            && jfx_bid_pt == self.last_emitted_bid_pt
            && jfx_ask_pt == self.last_emitted_ask_pt
        {
            return None;
        }

        self.last_emitted_bid_pt = jfx_bid_pt;
        self.last_emitted_ask_pt = jfx_ask_pt;

        let jfx_bid = jfx_bid_pt as f64 * self.point_size;
        let jfx_ask = jfx_ask_pt as f64 * self.point_size;
        let final_spread = spr_pt as f64 * self.point_size;

        // 浮動小数点表現の丸め正規化
        let norm_bid = (jfx_bid * self.point_scale).round() / self.point_scale;
        let norm_ask = (jfx_ask * self.point_scale).round() / self.point_scale;
        let norm_spr = (final_spread * self.point_scale).round() / self.point_scale;

        Some((norm_bid, norm_ask, norm_spr))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pseudo_jfx_zero_delay_and_impulse() {
        let mut engine = PseudoJfxEngine::new("USDJPY", "2026-09");

        // 1. 初回ティック: 150.000 / 150.004 (Mid = 150.002)
        let t1 = engine.process_tick(1788500000000, 150.000, 150.004);
        assert!(t1.is_some());
        let (b1, a1, spr1) = t1.unwrap();
        assert_eq!(b1, 150.001);
        assert_eq!(a1, 150.003);
        assert_eq!(spr1, 0.002);

        // 2. 同値ティック: None が返されること (Change-Driven)
        let t1_same = engine.process_tick(1788500000050, 150.000, 150.004);
        assert!(t1_same.is_none());

        // 3. Askだけ 1pt 拡大 (150.000 / 150.005, Mid=150.0025):
        // 切り捨てにより 150.002 を維持し、偽チャタリングを起こさないこと
        let t2 = engine.process_tick(1788500000100, 150.000, 150.005);
        assert!(t2.is_none());

        // 4. 急激な上方向ブレイク (Askが 150.008 へ +3pt 跳ね、Bidは 150.001 へ +1pt):
        // 上方向インパルス判定により即座に上へ追従すること
        let t3 = engine.process_tick(1788500000150, 150.001, 150.008);
        assert!(t3.is_some());
        let (b3, a3, _) = t3.unwrap();
        // Mid = (150.001 + 150.008) / 2 = 150.0045 -> 上方向インパルスで 150.005 に切り上げ
        // Bid = 150.004, Ask = 150.006
        assert_eq!(b3, 150.004);
        assert_eq!(a3, 150.006);

        // 5. 直後に同値ティック (150.001 / 150.008) が来ても、勝手に -1pt 落下せず None を返すこと
        let t4_same = engine.process_tick(1788500000200, 150.001, 150.008);
        assert!(t4_same.is_none());
    }

    #[test]
    fn test_pseudo_jfx_non_jpy_5digit_pair() {
        let mut engine = PseudoJfxEngine::new("EURUSD", "2026-09");

        // EURUSD: 1.08500 / 1.08504 (Mid = 1.08502) -> 0.2pip (0.00002) スプレッド
        let t1 = engine.process_tick(1788500000000, 1.08500, 1.08504);
        assert!(t1.is_some());
        let (b1, a1, spr1) = t1.unwrap();
        assert_eq!(b1, 1.08501);
        assert_eq!(a1, 1.08503);
        assert_eq!(spr1, 0.00002);

        // 上方向インパルス: 1.08501 / 1.08508 (Mid = 1.085045 -> 1.08505)
        let t2 = engine.process_tick(1788500000050, 1.08501, 1.08508);
        assert!(t2.is_some());
        let (b2, a2, _) = t2.unwrap();
        assert_eq!(b2, 1.08504);
        assert_eq!(a2, 1.08506);
    }
}
