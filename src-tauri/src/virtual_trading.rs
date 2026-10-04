use serde::{Deserialize, Serialize};
use crate::jfx_feed::ExecutionTick;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VirtualPosition {
    pub ticket: i32,
    pub symbol: String,
    pub r#type: String, // "BUY" | "SELL"
    pub volume: f64,
    pub open_price: f64,
    pub open_time: i64,
    pub open_time_msc: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub close_price: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub close_time: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub close_time_msc: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sl: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tp: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_price: Option<f64>,
    pub commission: f64,
    pub swap: f64,
    pub profit: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub close_reason: Option<String>,
    pub mfe_pips: f64,
    pub mae_pips: f64,
    pub spread_entry: f64,
    pub volatility: f64,
    pub volume_60s: u64,
    pub accumulated_real_time: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VirtualAccount {
    pub balance: f64,
    pub equity: f64,
    pub margin: f64,
    pub free_margin: f64,
    pub margin_level: f64,
    pub leverage: f64,
    pub currency: String,
    pub profit: f64,
    pub total_profit: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PendingOrder {
    pub execute_after_msc: i64,
    pub r#type: String,
    pub volume: f64,
    pub sl_points: f64,
    pub tp_points: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PendingClose {
    pub execute_after_msc: i64,
    pub ticket: i32,
    pub volume: f64,
    pub reason: String,
}

#[derive(Clone, Debug)]
pub struct VirtualTradingEngine {
    pub account: VirtualAccount,
    pub positions: Vec<VirtualPosition>,
    pub history: Vec<VirtualPosition>,
    pub contract_size: f64,
    pub leverage: f64,
    pub hedging: bool,
    pub next_ticket: i32,
    pub latency_ms: i64,
    pub pending_orders: Vec<PendingOrder>,
    pub pending_closes: Vec<PendingClose>,
    pub closed_tickets_ticks: std::collections::HashMap<i32, Vec<serde_json::Value>>,
    /// 取引状態のリビジョン番号（発注・決済・変更・リセット・巻き戻しでインクリメント）
    pub revision: u64,
}

impl Default for VirtualTradingEngine {
    fn default() -> Self {
        Self::new(1_000_000.0, 25.0, 10_000.0, false, 0)
    }
}

impl VirtualTradingEngine {
    pub fn new(
        initial_balance: f64,
        leverage: f64,
        contract_size: f64,
        hedging: bool,
        latency_ms: i64,
    ) -> Self {
        Self {
            account: VirtualAccount {
                balance: initial_balance,
                equity: initial_balance,
                margin: 0.0,
                free_margin: initial_balance,
                margin_level: 0.0,
                leverage,
                currency: "JPY".to_string(),
                profit: 0.0,
                total_profit: 0.0,
            },
            positions: Vec::new(),
            history: Vec::new(),
            contract_size,
            leverage,
            hedging,
            next_ticket: 1,
            latency_ms,
            pending_orders: Vec::new(),
            pending_closes: Vec::new(),
            closed_tickets_ticks: std::collections::HashMap::new(),
            revision: 1,
        }
    }

    pub fn reset(&mut self, initial_balance: f64) {
        self.account.balance = initial_balance;
        self.account.equity = initial_balance;
        self.account.margin = 0.0;
        self.account.free_margin = initial_balance;
        self.account.margin_level = 0.0;
        self.account.profit = 0.0;
        self.account.total_profit = 0.0;
        self.positions.clear();
        self.history.clear();
        self.pending_orders.clear();
        self.pending_closes.clear();
        self.closed_tickets_ticks.clear();
        self.next_ticket = 1;
        self.revision = self.revision.wrapping_add(1);
    }

    /// タイムトラベル連動 (SEEK / A-Bループ時の建玉巻き戻し)
    /// タイムラインの巻き戻しで過去時刻に戻った際、その仮想時刻以降に発注された建玉を自動消去し、
    /// その時点でオープン中だったポジションを復元し、口座残高・有効証拠金に整合的に復元。
    pub fn rewind_to(&mut self, target_time_msc: i64, current_tick: &ExecutionTick) {
        // 1. target_time_msc より未来にオープンされたポジションを削除
        self.positions.retain(|p| p.open_time_msc <= target_time_msc);

        // 2. 履歴 (history) の整合的巻き戻し
        let mut restored_positions = Vec::new();
        let mut kept_history = Vec::new();

        for mut pos in self.history.drain(..) {
            if pos.open_time_msc > target_time_msc {
                // target_time_msc より未来に発注された建玉 -> 残高から確定損益を差し引いて完全消去
                self.account.balance -= pos.profit;
                self.account.total_profit -= pos.profit;
            } else if pos.close_time_msc.map_or(false, |ct| ct > target_time_msc) {
                // target_time_msc 以前にオープンされたが決済は未来 -> 未決済建玉としてポジションに復元
                self.account.balance -= pos.profit;
                self.account.total_profit -= pos.profit;
                pos.close_price = None;
                pos.close_time = None;
                pos.close_time_msc = None;
                pos.close_reason = None;
                restored_positions.push(pos);
            } else {
                // target_time_msc 以前に決済完了している正常な過去履歴
                kept_history.push(pos);
            }
        }

        self.history = kept_history;

        // 部分決済されていた場合は既存ポジションにロットを合算、新規復元なら追加
        for restored in restored_positions {
            if let Some(existing) = self.positions.iter_mut().find(|p| p.ticket == restored.ticket) {
                existing.volume += restored.volume;
            } else {
                self.positions.push(restored);
            }
        }
        self.positions.sort_by_key(|p| p.ticket);

        // 3. 巻き戻しに伴い、再生待ちの遅延注文・遅延決済を破棄
        self.pending_orders.clear();
        self.pending_closes.clear();

        // 4. キャッシュされた約定ティック履歴の再整合
        self.closed_tickets_ticks.retain(|ticket, _| self.history.iter().any(|h| h.ticket == *ticket));

        // 5. 次回チケット番号の再整合
        let max_pos = self.positions.iter().map(|p| p.ticket).max().unwrap_or(0);
        let max_hist = self.history.iter().map(|p| p.ticket).max().unwrap_or(0);
        self.next_ticket = max_pos.max(max_hist) + 1;

        // 6. 巻き戻し時点のレートで評価・残高・有効証拠金復元
        self.update_positions_mtm(current_tick);
        self.recalculate_account(current_tick);
        self.revision = self.revision.wrapping_add(1);
    }

    /// 成行注文の発注 (BUY / SELL)
    pub fn open_order(
        &mut self,
        symbol: &str,
        type_str: &str,
        volume: f64,
        sl_points: f64,
        tp_points: f64,
        current_tick: &ExecutionTick,
        virtual_time_msc: i64,
        is_playing: bool,
    ) -> Option<i32> {
        let is_buy = type_str.eq_ignore_ascii_case("BUY");
        let order_type = if is_buy { "BUY".to_string() } else { "SELL".to_string() };

        // 実戦遅延シミュレーションが有効な場合
        if self.latency_ms > 0 {
            if is_playing {
                // 再生中: T_match = T_click + Δt 時点までキューイングし、到達時点の実レートで約定
                self.pending_orders.push(PendingOrder {
                    execute_after_msc: virtual_time_msc + self.latency_ms,
                    r#type: order_type,
                    volume,
                    sl_points,
                    tp_points,
                });
                return None;
            } else {
                // 一時停止中: 即座に T_match = T_click + Δt 時点の実レートで約定
                return self.execute_open(symbol, &order_type, volume, sl_points, tp_points, current_tick, virtual_time_msc + self.latency_ms);
            }
        }

        self.execute_open(symbol, &order_type, volume, sl_points, tp_points, current_tick, virtual_time_msc)
    }

    fn execute_open(
        &mut self,
        symbol: &str,
        order_type: &str,
        volume: f64,
        sl_points: f64,
        tp_points: f64,
        current_tick: &ExecutionTick,
        virtual_time_msc: i64,
    ) -> Option<i32> {
        let is_buy = order_type == "BUY";
        let open_price = if is_buy { current_tick.ask } else { current_tick.bid };

        // 両建てOFF (Netting): 逆方向ポジションがあれば優先相殺決済
        if !self.hedging {
            let opposite_type = if is_buy { "SELL" } else { "BUY" };
            let mut remaining_vol = volume;
            let settle_price = open_price;

            let mut to_close = Vec::new();
            for pos in &self.positions {
                if pos.r#type == opposite_type && remaining_vol > 0.0001 {
                    let close_vol = pos.volume.min(remaining_vol);
                    to_close.push((pos.ticket, close_vol));
                    remaining_vol -= close_vol;
                }
            }

            for (ticket, c_vol) in to_close {
                self.close_position_by_ticket(ticket, c_vol, "SETTLEMENT", settle_price, virtual_time_msc);
            }

            if remaining_vol <= 0.0001 {
                self.recalculate_account(current_tick);
                return None;
            }
        }

        // SL / TP 価格の計算 (USDJPY: 1 point = 0.001)
        let point = 0.001;
        let sl = if sl_points > 0.0 {
            Some(if is_buy {
                ((open_price - sl_points * point) * 1000.0).round() / 1000.0
            } else {
                ((open_price + sl_points * point) * 1000.0).round() / 1000.0
            })
        } else {
            None
        };

        let tp = if tp_points > 0.0 {
            Some(if is_buy {
                ((open_price + tp_points * point) * 1000.0).round() / 1000.0
            } else {
                ((open_price - tp_points * point) * 1000.0).round() / 1000.0
            })
        } else {
            None
        };

        let ticket = self.next_ticket;
        self.next_ticket += 1;

        let pos = VirtualPosition {
            ticket,
            symbol: symbol.to_string(),
            r#type: order_type.to_string(),
            volume,
            open_price,
            open_time: virtual_time_msc / 1000,
            open_time_msc: virtual_time_msc,
            close_price: None,
            close_time: None,
            close_time_msc: None,
            sl,
            tp,
            current_price: Some(open_price),
            commission: 0.0,
            swap: 0.0,
            profit: 0.0,
            close_reason: None,
            mfe_pips: 0.0,
            mae_pips: 0.0,
            spread_entry: current_tick.spread * 100.0,
            volatility: 0.0,
            volume_60s: 0,
            accumulated_real_time: 0.0,
        };

        self.positions.push(pos);
        self.recalculate_account(current_tick);
        self.revision = self.revision.wrapping_add(1);

        Some(ticket)
    }

    /// 特定ポジションの決済
    pub fn close_position_by_ticket(
        &mut self,
        ticket: i32,
        volume: f64,
        reason: &str,
        close_price: f64,
        virtual_time_msc: i64,
    ) -> bool {
        let Some(pos_idx) = self.positions.iter().position(|p| p.ticket == ticket) else {
            return false;
        };

        let pos = &mut self.positions[pos_idx];
        let close_vol = if volume > 0.0 && volume < pos.volume { volume } else { pos.volume };

        let is_buy = pos.r#type == "BUY";
        let diff = if is_buy { close_price - pos.open_price } else { pos.open_price - close_price };
        let realized_profit = diff * close_vol * self.contract_size;

        let mut hist_pos = pos.clone();
        hist_pos.volume = close_vol;
        hist_pos.close_price = Some(close_price);
        hist_pos.close_time = Some(virtual_time_msc / 1000);
        hist_pos.close_time_msc = Some(virtual_time_msc);
        hist_pos.profit = realized_profit;
        hist_pos.close_reason = Some(reason.to_string());

        self.account.balance += realized_profit;
        self.account.total_profit += realized_profit;
        self.history.push(hist_pos);

        if close_vol < pos.volume - 0.0001 {
            // 部分決済
            pos.volume -= close_vol;
        } else {
            // 全決済
            self.positions.remove(pos_idx);
        }

        self.revision = self.revision.wrapping_add(1);
        true
    }

    /// 全ポジション一括決済
    pub fn close_all(&mut self, reason: &str, current_tick: &ExecutionTick, virtual_time_msc: i64) {
        let tickets: Vec<(i32, f64, bool)> = self.positions
            .iter()
            .map(|p| (p.ticket, p.volume, p.r#type == "BUY"))
            .collect();

        for (ticket, vol, is_buy) in tickets {
            let close_price = if is_buy { current_tick.bid } else { current_tick.ask };
            self.close_position_by_ticket(ticket, vol, reason, close_price, virtual_time_msc);
        }

        self.recalculate_account(current_tick);
    }

    /// 買いポジション一括決済
    pub fn close_buy(&mut self, reason: &str, current_tick: &ExecutionTick, virtual_time_msc: i64) {
        let tickets: Vec<(i32, f64)> = self.positions
            .iter()
            .filter(|p| p.r#type == "BUY")
            .map(|p| (p.ticket, p.volume))
            .collect();

        for (ticket, vol) in tickets {
            self.close_position_by_ticket(ticket, vol, reason, current_tick.bid, virtual_time_msc);
        }

        self.recalculate_account(current_tick);
    }

    /// 売りポジション一括決済
    pub fn close_sell(&mut self, reason: &str, current_tick: &ExecutionTick, virtual_time_msc: i64) {
        let tickets: Vec<(i32, f64)> = self.positions
            .iter()
            .filter(|p| p.r#type == "SELL")
            .map(|p| (p.ticket, p.volume))
            .collect();

        for (ticket, vol) in tickets {
            self.close_position_by_ticket(ticket, vol, reason, current_tick.ask, virtual_time_msc);
        }

        self.recalculate_account(current_tick);
    }

    /// SL/TPの変更
    pub fn modify_order(&mut self, ticket: i32, sl: Option<f64>, tp: Option<f64>) -> bool {
        if let Some(pos) = self.positions.iter_mut().find(|p| p.ticket == ticket) {
            pos.sl = sl;
            pos.tp = tp;
            self.revision = self.revision.wrapping_add(1);
            true
        } else {
            false
        }
    }

    /// リプレイ進行に伴う通過ティック評価 (SL/TP到達判定・含み損益更新・遅延注文執行)
    pub fn evaluate_ticks(
        &mut self,
        ticks: &[ExecutionTick],
        _current_time_msc: i64,
        symbol: &str,
    ) {
        if ticks.is_empty() {
            return;
        }

        for tick in ticks {
            // 1. 保留中の遅延注文の執行判定
            if !self.pending_orders.is_empty() {
                let pending_list = std::mem::take(&mut self.pending_orders);
                let mut remaining_pending = Vec::new();
                for pending in pending_list {
                    if tick.time_msc >= pending.execute_after_msc {
                        self.execute_open(
                            symbol,
                            &pending.r#type,
                            pending.volume,
                            pending.sl_points,
                            pending.tp_points,
                            tick,
                            tick.time_msc,
                        );
                    } else {
                        remaining_pending.push(pending);
                    }
                }
                self.pending_orders = remaining_pending;
            }

            // 2. 保留中の遅延決済の執行判定
            if !self.pending_closes.is_empty() {
                let pending_closes = std::mem::take(&mut self.pending_closes);
                let mut remaining_closes = Vec::new();
                for pending in pending_closes {
                    if tick.time_msc >= pending.execute_after_msc {
                        let is_buy = self.positions.iter().find(|p| p.ticket == pending.ticket).map(|p| p.r#type == "BUY").unwrap_or(true);
                        let close_price = if is_buy { tick.bid } else { tick.ask };
                        self.close_position_by_ticket(pending.ticket, pending.volume, &pending.reason, close_price, tick.time_msc);
                    } else {
                        remaining_closes.push(pending);
                    }
                }
                self.pending_closes = remaining_closes;
            }

            // 3. SL / TP 判定
            let mut closed_tickets = Vec::new();
            for pos in &self.positions {
                let is_buy = pos.r#type == "BUY";
                let exec_price = if is_buy { tick.bid } else { tick.ask };

                if let Some(sl) = pos.sl {
                    if (is_buy && exec_price <= sl) || (!is_buy && exec_price >= sl) {
                        closed_tickets.push((pos.ticket, pos.volume, "SL", sl));
                        continue;
                    }
                }

                if let Some(tp) = pos.tp {
                    if (is_buy && exec_price >= tp) || (!is_buy && exec_price <= tp) {
                        closed_tickets.push((pos.ticket, pos.volume, "TP", tp));
                        continue;
                    }
                }
            }

            for (ticket, vol, reason, price) in closed_tickets {
                self.close_position_by_ticket(ticket, vol, reason, price, tick.time_msc);
            }
        }

        // 最新ティックで現在値・損益・MFE/MAE更新
        let last_tick = ticks.last().unwrap();
        self.update_positions_mtm(last_tick);
        self.recalculate_account(last_tick);
    }

    /// 各保有ポジションの含み損益およびMFE/MAEの更新
    pub fn update_positions_mtm(&mut self, tick: &ExecutionTick) {
        for pos in &mut self.positions {
            let is_buy = pos.r#type == "BUY";
            let cur_price = if is_buy { tick.bid } else { tick.ask };
            pos.current_price = Some(cur_price);

            let diff = if is_buy { cur_price - pos.open_price } else { pos.open_price - cur_price };
            pos.profit = diff * pos.volume * self.contract_size;

            let diff_pips = diff * 100.0;
            if diff_pips > pos.mfe_pips {
                pos.mfe_pips = diff_pips;
            }
            let adverse = -diff_pips;
            if adverse > pos.mae_pips {
                pos.mae_pips = adverse;
            }
        }
    }

    /// 口座サマリー (Equity, Margin, Free Margin, Margin Level) の再計算
    pub fn recalculate_account(&mut self, tick: &ExecutionTick) {
        let floating_profit: f64 = self.positions.iter().map(|p| p.profit).sum();
        self.account.profit = floating_profit;
        self.account.equity = self.account.balance + floating_profit;

        let total_volume: f64 = self.positions.iter().map(|p| p.volume).sum();
        let notional = total_volume * self.contract_size * tick.bid;
        self.account.margin = if self.leverage > 0.0 { notional / self.leverage } else { 0.0 };
        self.account.free_margin = self.account.equity - self.account.margin;

        self.account.margin_level = if self.account.margin > 0.0 {
            (self.account.equity / self.account.margin) * 100.0
        } else {
            0.0
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_open_and_close_buy() {
        let mut engine = VirtualTradingEngine::new(1_000_000.0, 25.0, 10_000.0, false, 0);
        let tick = ExecutionTick {
            time_msc: 1000,
            bid: 150.000,
            ask: 150.002,
            spread: 0.002,
            is_real: true,
        };

        let ticket = engine.open_order("USDJPY", "BUY", 1.0, 0.0, 0.0, &tick, 1000, false).unwrap();
        assert_eq!(ticket, 1);
        assert_eq!(engine.positions.len(), 1);
        assert_eq!(engine.positions[0].open_price, 150.002);

        // クローズ
        let tick_close = ExecutionTick {
            time_msc: 2000,
            bid: 150.022,
            ask: 150.024,
            spread: 0.002,
            is_real: true,
        };
        engine.close_position_by_ticket(ticket, 1.0, "MANUAL", tick_close.bid, 2000);
        assert_eq!(engine.positions.len(), 0);
        assert_eq!(engine.history.len(), 1);
        // (150.022 - 150.002) * 1.0 * 10,000 = +200 JPY
        assert!((engine.history[0].profit - 200.0).abs() < 1e-4);
        assert!((engine.account.balance - 1_000_200.0).abs() < 1e-4);
    }

    #[test]
    fn test_sl_tp_evaluation() {
        let mut engine = VirtualTradingEngine::new(1_000_000.0, 25.0, 10_000.0, false, 0);
        let tick1 = ExecutionTick { time_msc: 1000, bid: 150.000, ask: 150.002, spread: 0.002, is_real: true };
        // SL: 50 points (0.050), TP: 100 points (0.100)
        let _ = engine.open_order("USDJPY", "BUY", 1.0, 50.0, 100.0, &tick1, 1000, false);
        assert_eq!(engine.positions[0].sl, Some(149.952));
        assert_eq!(engine.positions[0].tp, Some(150.102));

        // 価格がSLに到達
        let tick_sl = ExecutionTick { time_msc: 1500, bid: 149.950, ask: 149.952, spread: 0.002, is_real: true };
        engine.evaluate_ticks(&[tick_sl], 1500, "USDJPY");
        assert_eq!(engine.positions.len(), 0);
        assert_eq!(engine.history.len(), 1);
        assert_eq!(engine.history[0].close_reason, Some("SL".to_string()));
    }

    #[test]
    fn test_rewind_to_time_travel() {
        let mut engine = VirtualTradingEngine::new(1_000_000.0, 25.0, 10_000.0, true, 0);
        let t1 = ExecutionTick { time_msc: 10_000, bid: 150.000, ask: 150.002, spread: 0.002, is_real: true };
        let t2 = ExecutionTick { time_msc: 20_000, bid: 150.020, ask: 150.022, spread: 0.002, is_real: true };
        let t3 = ExecutionTick { time_msc: 30_000, bid: 150.050, ask: 150.052, spread: 0.002, is_real: true };

        // 1. Time 10_000: BUY order (Ticket 1)
        let t1_id = engine.open_order("USDJPY", "BUY", 1.0, 0.0, 0.0, &t1, 10_000, false).unwrap();
        assert_eq!(t1_id, 1);

        // 2. Time 20_000: Close Ticket 1 (+180 JPY profit)
        engine.close_position_by_ticket(t1_id, 1.0, "MANUAL", t2.bid, 20_000);
        assert_eq!(engine.account.balance, 1_000_180.0);

        // 3. Time 30_000: BUY order (Ticket 2)
        let t2_id = engine.open_order("USDJPY", "BUY", 1.0, 0.0, 0.0, &t3, 30_000, false).unwrap();
        assert_eq!(t2_id, 2);
        assert_eq!(engine.positions.len(), 1);
        assert_eq!(engine.history.len(), 1);

        // 4. Time travel rewind to 15_000 (after Ticket 1 opened, but BEFORE Ticket 1 closed and BEFORE Ticket 2 opened):
        let t_rewind = ExecutionTick { time_msc: 15_000, bid: 150.010, ask: 150.012, spread: 0.002, is_real: true };
        engine.rewind_to(15_000, &t_rewind);

        // Ticket 2 (opened at 30_000) was in the future -> DISCARDED!
        // Ticket 1 (opened at 10_000, closed at 20_000) was open at 15_000 -> RESTORED TO OPEN POSITIONS!
        assert_eq!(engine.positions.len(), 1);
        assert_eq!(engine.positions[0].ticket, 1);
        assert_eq!(engine.positions[0].open_price, 150.002);
        assert_eq!(engine.history.len(), 0);

        // Balance restored to 1_000_000 (realized profit reversed)
        assert_eq!(engine.account.balance, 1_000_000.0);
        // Floating profit at 15_000: (150.010 - 150.002) * 10,000 = +80 JPY
        assert!((engine.positions[0].profit - 80.0).abs() < 1e-4);
        assert!((engine.account.equity - 1_000_080.0).abs() < 1e-4);
    }

    #[test]
    fn test_latency_matching_playback_queue() {
        let mut engine = VirtualTradingEngine::new(1_000_000.0, 25.0, 10_000.0, false, 30);
        let tick1 = ExecutionTick { time_msc: 1000, bid: 150.000, ask: 150.002, spread: 0.002, is_real: true };

        // While playing, order is queued until T_click + 30ms = 1030ms
        let res = engine.open_order("USDJPY", "BUY", 1.0, 0.0, 0.0, &tick1, 1000, true);
        assert_eq!(res, None);
        assert_eq!(engine.pending_orders.len(), 1);
        assert_eq!(engine.positions.len(), 0);

        // Tick before 1030ms (e.g. 1020ms) does NOT execute
        let tick2 = ExecutionTick { time_msc: 1020, bid: 150.005, ask: 150.007, spread: 0.002, is_real: true };
        engine.evaluate_ticks(&[tick2], 1020, "USDJPY");
        assert_eq!(engine.pending_orders.len(), 1);
        assert_eq!(engine.positions.len(), 0);

        // Tick at or after 1030ms (1030ms, price has spiked to 150.020 / 150.022) executes at this exact rate!
        let tick3 = ExecutionTick { time_msc: 1030, bid: 150.020, ask: 150.022, spread: 0.002, is_real: true };
        engine.evaluate_ticks(&[tick3], 1030, "USDJPY");
        assert_eq!(engine.pending_orders.len(), 0);
        assert_eq!(engine.positions.len(), 1);
        // Filled at spiked rate (150.022) reproducing real latency slippage!
        assert_eq!(engine.positions[0].open_price, 150.022);
    }

    #[test]
    fn test_rewind_partial_close_merging() {
        let mut engine = VirtualTradingEngine::new(1_000_000.0, 25.0, 10_000.0, true, 0);
        let t1 = ExecutionTick { time_msc: 10_000, bid: 150.000, ask: 150.002, spread: 0.002, is_real: true };
        let t2 = ExecutionTick { time_msc: 20_000, bid: 150.020, ask: 150.022, spread: 0.002, is_real: true };

        // 1. Open BUY 2.0 lots at 10_000
        let t1_id = engine.open_order("USDJPY", "BUY", 2.0, 0.0, 0.0, &t1, 10_000, false).unwrap();
        assert_eq!(engine.positions[0].volume, 2.0);

        // 2. Partially close 0.5 lots at 20_000 (remaining: 1.5 lots, closed: 0.5 lots)
        engine.close_position_by_ticket(t1_id, 0.5, "MANUAL", t2.bid, 20_000);
        assert_eq!(engine.positions.len(), 1);
        assert_eq!(engine.positions[0].volume, 1.5);
        assert_eq!(engine.history.len(), 1);
        assert_eq!(engine.history[0].volume, 0.5);

        // 3. Rewind to 15_000 (before partial close)
        let t_rewind = ExecutionTick { time_msc: 15_000, bid: 150.010, ask: 150.012, spread: 0.002, is_real: true };
        engine.rewind_to(15_000, &t_rewind);

        // Ticket 1 should have its 0.5 lots merged back, resulting in a single position of 2.0 lots!
        assert_eq!(engine.positions.len(), 1);
        assert_eq!(engine.positions[0].ticket, t1_id);
        assert!((engine.positions[0].volume - 2.0).abs() < 1e-6);
        assert_eq!(engine.history.len(), 0);
        assert_eq!(engine.account.balance, 1_000_000.0);
    }
}
