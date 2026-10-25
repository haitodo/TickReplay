use chrono::{Datelike, Timelike};
use crate::pseudo_dmm::{EconomicEvent, PseudoDmmEngine};

/// JFX クォーティング特性 (2026年2月〜10月実測統計 2,136万ティックから導出)
pub mod jfx_characteristics {
    /// 通常時の基準スプレッド (0.2 pips = 2 points)
    pub const BASE_SPREAD_PIPS: f64 = 0.2;

    /// 最大スプレッド上限 (15.0 pips = 150 points)
    pub const MAX_SPREAD_PIPS: f64 = 15.0;
}

/// JFX特化型 擬似レート生成エンジン
/// 数理設計: 双安定 ΣΔ (シグマ・デルタ) 量子化・100ms同期コアレッシング・インパルス逆畳み込みモデル (ΣΔ-CIM)
pub struct PseudoJfxEngine {
    pub symbol: String,
    pub year: i32,
    pub month: u32,
    pub events: Vec<EconomicEvent>,
    /// 通貨ペアに応じた 0.1pip (1point) の価格単位 (JPYペア: 0.001, 非JPYペア: 0.00001)
    point_size: f64,
    /// 価格から整数ポイントへの変換倍率 (JPYペア: 1000.0, 非JPYペア: 100_000.0)
    point_scale: f64,
    // 前回の出力クォート (整数ポイントによる厳密Change-Driven判定用)
    last_q_pt: i64,
    last_step_pt: i64,
    last_emit_msc: i64,
    last_emitted_bid_pt: i64,
    last_emitted_ask_pt: i64,
    // 双安定 ΣΔ ディザリング状態 (+1: 切り上げバウンス中, -1: 切り下げバウンス中, 0: 安定)
    dither_state: i8,
    // 大スパイク後のモメンタム維持 (シュミットトリガ)
    spike_latch_dir: i8,
    spike_latch_until_msc: i64,
    // 直近140msの生クォート履歴 (msc, b_pt, a_pt, sum_pt)
    raw_history: Vec<(i64, i64, i64, i64)>,
    // 直近10秒間のボラティリティ追跡 (mt5_ms, q_pt)
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
            last_q_pt: 0,
            last_step_pt: 0,
            last_emit_msc: -1000,
            last_emitted_bid_pt: 0,
            last_emitted_ask_pt: 0,
            dither_state: 0,
            spike_latch_dir: 0,
            spike_latch_until_msc: -1000,
            raw_history: Vec::with_capacity(16),
            recent_ticks: Vec::with_capacity(256),
        }
    }

    /// 単一ティックを JFX 特性に合わせて変換
    /// 双安定 ΣΔ 量子化・100ms同期コアレッシング・インパルス逆畳み込みモデル (ΣΔ-CIM)
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

        // 初回ティック初期化
        if self.last_emit_msc <= 0 {
            let q_pt = sum_pt / 2;
            self.last_q_pt = q_pt;
            self.last_emit_msc = mt5_time_msc;
            self.raw_history.push((mt5_time_msc, b_pt, a_pt, sum_pt));

            return self.finalize_quote(mt5_time_msc, q_pt, (a_pt - b_pt).max(0) as f64 * 0.1);
        }

        // 直近 140ms 窓の生クォート履歴を更新
        self.raw_history.push((mt5_time_msc, b_pt, a_pt, sum_pt));
        let cutoff_140ms = mt5_time_msc - 140;
        self.raw_history.retain(|&(t, _, _, _)| t >= cutoff_140ms);

        // --- 2. 100ms 同期コアレッシングゲート (JFX MT5サーバーの約100ms配信仕様に準拠) ---
        let dt_emit = mt5_time_msc - self.last_emit_msc;
        if dt_emit < 98 {
            return None;
        }

        // 直近 120ms 窓の基準値 (最も古いレコード) を取得して累積速度を算出
        let &(_, b_prev120, a_prev120, s_prev120) = self
            .raw_history
            .first()
            .unwrap_or(&(mt5_time_msc, b_pt, a_pt, sum_pt));
        let ds_120 = sum_pt - s_prev120;
        let da_120 = a_pt - a_prev120;
        let db_120 = b_pt - b_prev120;

        let q_floor = sum_pt / 2;
        let q_ceil = (sum_pt + 1) / 2;
        let is_odd = sum_pt % 2 != 0;
        let r = sum_pt - 2 * self.last_q_pt; // 直前出力からの残差 (単位: 0.5pt)

        // --- 3. 120ms 窓インパルス判定 (OANDA 50ms 分割減衰の逆畳み込み) ---
        let up_impulse = (da_120 >= 2 && db_120 >= 0) || (ds_120 >= 3);
        let dn_impulse = (db_120 <= -2 && da_120 <= 0) || (ds_120 <= -3);

        let q_pt = if mt5_time_msc < self.spike_latch_until_msc {
            // 大スパイク後のモメンタム保持 (シュミットトリガ: 進行方向に追従し逆方向は -1.5pt 以上戻らない限り維持)
            if self.spike_latch_dir > 0 {
                if r >= 2 {
                    if up_impulse { q_ceil } else { q_floor }
                } else if r <= -3 {
                    self.spike_latch_dir = 0;
                    q_floor
                } else {
                    self.last_q_pt
                }
            } else if self.spike_latch_dir < 0 {
                if r <= -2 {
                    q_floor
                } else if r >= 3 {
                    self.spike_latch_dir = 0;
                    q_floor
                } else {
                    self.last_q_pt
                }
            } else {
                q_floor
            }
        } else if up_impulse {
            self.dither_state = 0;
            q_ceil
        } else if dn_impulse {
            self.dither_state = 0;
            q_floor
        } else {
            // --- 4. 通常・レンジ領域 (半整数・双安定 ΣΔ ディザリング & 平均回帰ピンポン核) ---
            if self.dither_state == 1 {
                self.dither_state = 0;
                q_floor
            } else if self.dither_state == -1 {
                self.dither_state = 0;
                q_floor
            } else if is_odd {
                // 半整数点 (k + 0.5pt): 下から進入時は k+1 へディザ切り上げし次クロックで k へ復帰
                if r == 1 && self.last_step_pt <= 0 {
                    self.dither_state = 1;
                    q_ceil
                } else if r == -1 {
                    self.dither_state = if self.last_step_pt == 1 { 0 } else { -1 };
                    q_floor
                } else {
                    q_floor
                }
            } else {
                // 偶数点 (k): 緩やかな 1pt 上昇後は元に戻りやすくする
                let q = q_floor;
                if q - self.last_q_pt == 1 && ds_120 <= 2 {
                    self.dither_state = 1;
                }
                q
            }
        };

        // 直前出力と同値なら間引く (厳密 Change-Driven)
        if q_pt == self.last_q_pt && self.last_emitted_bid_pt > 0 {
            return None;
        }

        let step = q_pt - self.last_q_pt;
        if step.abs() >= 3 {
            self.spike_latch_dir = if step > 0 { 1 } else { -1 };
            self.spike_latch_until_msc = mt5_time_msc + 320;
            self.dither_state = 0;
        }
        self.last_step_pt = step;
        self.last_q_pt = q_pt;
        self.last_emit_msc = mt5_time_msc;

        let raw_oanda_spread_pips = (a_pt - b_pt).max(0) as f64 * 0.1;
        self.finalize_quote(mt5_time_msc, q_pt, raw_oanda_spread_pips)
    }

    /// クォートの確定 (スプレッド計算、整数ポイント丸め、Change-Driven判定)
    fn finalize_quote(
        &mut self,
        mt5_time_msc: i64,
        q_pt: i64,
        raw_oanda_spread_pips: f64,
    ) -> Option<(f64, f64, f64)> {
        // --- 5. JST 時刻情報の分解 ---
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

        // --- 6. JFX 実測準拠スプレッド制御 (原則固定 0.2銭) ---
        let mut target_spread_pips = jfx_characteristics::BASE_SPREAD_PIPS;

        // 早朝ロールオーバー (夏時間: 05:59〜07:15 JST / 冬時間: 06:59〜08:15 JST)
        let rollover_hour = if is_dst { 6 } else { 7 };
        let pre_hour = rollover_hour - 1;

        if jst_hour == pre_hour && jst_min == 59 {
            target_spread_pips = target_spread_pips.max(3.2);
        } else if jst_hour == rollover_hour {
            let early_pips = if jst_min <= 20 {
                9.8
            } else if jst_min <= 30 {
                8.5
            } else {
                5.9
            };
            target_spread_pips = target_spread_pips.max(early_pips);
        } else if jst_hour == rollover_hour + 1 {
            if jst_min < 5 {
                target_spread_pips = target_spread_pips.max(3.6);
            } else if jst_min < 11 {
                let progress = (jst_min - 5) as f64 / 6.0;
                let early_pips = 1.5 - (1.5 - 1.1) * progress;
                target_spread_pips = target_spread_pips.max(early_pips);
            } else if jst_min < 15 {
                let progress = (jst_min - 11) as f64 / 4.0;
                let early_pips = 1.1 - (1.1 - 0.2) * progress;
                target_spread_pips = target_spread_pips.max(early_pips);
            }
        }

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
                                    if rel_sec < -5.0 {
                                        0.2 + (2.5 - 0.2) * ((rel_sec + 15.0) / 10.0).max(0.0)
                                    } else if rel_sec < -1.0 {
                                        2.5 + (3.2 - 2.5) * ((rel_sec + 5.0) / 4.0)
                                    } else {
                                        3.2 + (7.9 - 3.2) * ((rel_sec + 1.0) / 1.0)
                                    }
                                }
                                2 => {
                                    if rel_sec < -1.0 {
                                        0.2 + (2.0 - 0.2) * ((rel_sec + 10.0) / 9.0).max(0.0)
                                    } else {
                                        2.0 + (4.5 - 2.0) * ((rel_sec + 1.0) / 1.0)
                                    }
                                }
                                _ => {
                                    0.2 + (1.8 - 0.2) * ((rel_sec + 5.0) / 5.0).max(0.0)
                                }
                            }
                        } else if mt5_time_msc <= ev.mt5_ms + 10_000 {
                            let (base_peak_pips, max_cap_pips) = match ev.tier {
                                1 => (7.9, 14.9),
                                2 => (4.5, 8.0),
                                _ => (1.8, 3.5),
                            };
                            let oanda_excess_pips = (raw_oanda_spread_pips - 0.6).max(0.0);
                            let dyn_pips = base_peak_pips + 0.30 * oanda_excess_pips + 0.40 * price_volatility_10s_pips;
                            dyn_pips.min(max_cap_pips)
                        } else {
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

        // --- 7. ポイント整数空間での Bid / Ask 確定 (ask - bid == spread を100%保証) ---
        let spr_pt = (clamped_pips * 10.0).round().max(2.0) as i64;
        let jfx_bid_pt = q_pt - (spr_pt / 2);
        let jfx_ask_pt = jfx_bid_pt + spr_pt;

        // 量子化後の Bid または Ask が直前と1ptでも変化した場合のみ出力
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
    fn test_pseudo_jfx_bistable_and_coalescing() {
        let mut engine = PseudoJfxEngine::new("USDJPY", "2026-09");

        // 1. 初回ティック (t = 0ms): 150.000 / 150.004 (Mid = 150.002)
        let t1 = engine.process_tick(1788500000000, 150.000, 150.004);
        assert!(t1.is_some());
        let (b1, a1, spr1) = t1.unwrap();
        assert_eq!(b1, 150.001);
        assert_eq!(a1, 150.003);
        assert_eq!(spr1, 0.002);

        // 2. 50ms 後のティック (t = 50ms): 100ms ゲート未満 (<98ms) のため None
        let t2 = engine.process_tick(1788500000050, 150.001, 150.005);
        assert!(t2.is_none());

        // 3. 100ms 後のティック (t = 100ms): 半整数点 150.000 / 150.005 (Mid = 150.0025, sum_pt = 300005: 奇数)
        // 双安定 ΣΔ により切り上げバウンス (q = 150.003)
        let t3 = engine.process_tick(1788500000100, 150.000, 150.005);
        assert!(t3.is_some());
        let (b3, a3, _) = t3.unwrap();
        assert_eq!(b3, 150.002);
        assert_eq!(a3, 150.004);

        // 4. 次の 100ms 後 (t = 200ms): OANDA が同値 (150.000 / 150.005) のまま静止
        // 双安定ピンポン復帰により、直ちに元の基底 q_floor = 150.002 へ復帰！ (Exact Ping-Pong 完成)
        let t4 = engine.process_tick(1788500000200, 150.000, 150.005);
        assert!(t4.is_some());
        let (b4, a4, _) = t4.unwrap();
        assert_eq!(b4, 150.001);
        assert_eq!(a4, 150.003);

        // 5. 大スパイク (t = 300ms): 150.002 / 150.010 (+4pt 跳ね)
        // 120ms 窓でのインパルス判定により即座に上方向追従 (q = 150.006)
        let t5 = engine.process_tick(1788500000300, 150.002, 150.010);
        assert!(t5.is_some());
        let (b5, a5, _) = t5.unwrap();
        assert_eq!(b5, 150.005);
        assert_eq!(a5, 150.007);
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

        // 100ms 後に上方向インパルス: 1.08502 / 1.08510 (da >= 2)
        let t2 = engine.process_tick(1788500000100, 1.08502, 1.08510);
        assert!(t2.is_some());
        let (b2, a2, _) = t2.unwrap();
        assert_eq!(b2, 1.08505);
        assert_eq!(a2, 1.08507);
    }
}
