use serde::{Deserialize, Serialize};
use crate::core::types::{CoreTick, LatencyModel, OrderSide, SlippageModel};
use crate::core::journal::{ExecutionAuditRecord, JournalEvent, JournalStore};
use crate::virtual_trading::{VirtualAccount, VirtualPosition};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PendingCoreOrder {
    pub order_id: u64,
    pub submit_time_msc: i64,
    pub execute_after_msc: i64,
    pub symbol: String,
    pub side: OrderSide,
    pub volume: f64,
    pub sl_points: f64,
    pub tp_points: f64,
    pub request_price: f64,
    pub comment: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PendingCoreClose {
    pub execute_after_msc: i64,
    pub ticket: i32,
    pub volume: Option<f64>,
    pub reason: String,
}

#[derive(Debug, Clone)]
pub struct DeterministicPrng {
    state: u64,
}

impl DeterministicPrng {
    pub fn new(seed: u64) -> Self {
        Self {
            state: if seed == 0 { 0x853c49e6748fea9b } else { seed },
        }
    }

    #[inline]
    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.state;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.state = x;
        x
    }

    #[inline]
    pub fn next_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 * (1.0 / (1u64 << 53) as f64)
    }

    /// Box-Muller 変換による標準正規分布乱数 (μ=0, σ=1)
    pub fn next_standard_normal(&mut self) -> f64 {
        let u1 = self.next_f64().max(1e-15);
        let u2 = self.next_f64();
        (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos()
    }
}

/// Core 決定的約定エンジン
#[derive(Debug, Clone)]
pub struct CoreMatchingEngine {
    pub account: VirtualAccount,
    pub positions: Vec<VirtualPosition>,
    pub history: Vec<VirtualPosition>,
    pub pending_orders: Vec<PendingCoreOrder>,
    pub pending_closes: Vec<PendingCoreClose>,
    pub audit_log: Vec<ExecutionAuditRecord>,
    pub journal: JournalStore,

    pub contract_size: f64,
    pub leverage: f64,
    pub latency_model: LatencyModel,
    pub slippage_model: SlippageModel,
    pub next_ticket: i32,
    pub next_order_id: u64,
    pub prng: DeterministicPrng,
}

impl Default for CoreMatchingEngine {
    fn default() -> Self {
        Self::new(1_000_000.0, 25.0, 10_000.0)
    }
}

impl CoreMatchingEngine {
    pub fn new(initial_balance: f64, leverage: f64, contract_size: f64) -> Self {
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
            pending_orders: Vec::new(),
            pending_closes: Vec::new(),
            audit_log: Vec::new(),
            journal: JournalStore::new(),
            contract_size,
            leverage,
            latency_model: LatencyModel::Zero,
            slippage_model: SlippageModel::None,
            next_ticket: 1,
            next_order_id: 1,
            prng: DeterministicPrng::new(42),
        }
    }

    #[inline]
    pub fn revision(&self) -> u64 {
        self.journal.revision()
    }

    pub fn set_latency_model(&mut self, model: LatencyModel) {
        self.latency_model = model;
    }

    pub fn set_slippage_model(&mut self, model: SlippageModel) {
        self.slippage_model = model;
    }

    fn calculate_latency_ms(&mut self) -> i64 {
        match self.latency_model {
            LatencyModel::Zero => 0,
            LatencyModel::Fixed { latency_ms } => latency_ms as i64,
            LatencyModel::Normal { mean_ms, std_dev_ms } => {
                let sample = mean_ms + std_dev_ms * self.prng.next_standard_normal();
                sample.max(0.0).round() as i64
            }
        }
    }

    fn calculate_slippage_pips(&mut self, tick: &CoreTick) -> f64 {
        match self.slippage_model {
            SlippageModel::None => 0.0,
            SlippageModel::Realistic { base_slippage_pips, volatility_factor } => {
                let normal = self.prng.next_standard_normal().abs();
                let spread_factor = (tick.spread() * 100.0 - 0.3).max(0.0); // 0.3pips超のスプレッド拡大に比例
                let slip = base_slippage_pips + volatility_factor * spread_factor + normal * 0.1;
                slip.max(0.0)
            }
        }
    }

    pub fn reset(&mut self, initial_balance: f64, now_msc: i64) {
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
        self.audit_log.clear();
        self.next_ticket = 1;
        self.next_order_id = 1;

        self.journal.clear();
        self.journal.record(
            now_msc,
            JournalEvent::AccountReset {
                initial_balance,
                time_msc: now_msc,
            },
        );
    }

    /// タイムトラベル（指定時刻への巻き戻し）
    pub fn rewind_to(&mut self, target_time_msc: i64, current_tick: Option<&CoreTick>) {
        // 1. target_time_msc より未来に発注された建玉を削除
        self.positions.retain(|p| p.open_time_msc <= target_time_msc);

        // 2. 履歴の整合的巻き戻し
        let mut restored_positions = Vec::new();
        let mut kept_history = Vec::new();

        for mut pos in self.history.drain(..) {
            if pos.open_time_msc > target_time_msc {
                // target_time_msc より未来に発注された建玉 -> 残高から確定損益を差し引いて完全消去
                self.account.balance -= pos.profit;
                self.account.total_profit -= pos.profit;
            } else if pos.close_time_msc.map_or(false, |ct| ct > target_time_msc) {
                // target_time_msc 以前にオープンされたが決済は未来 -> 未決済建玉として復元
                self.account.balance -= pos.profit;
                self.account.total_profit -= pos.profit;
                pos.close_price = None;
                pos.close_time = None;
                pos.close_time_msc = None;
                pos.close_reason = None;
                restored_positions.push(pos);
            } else {
                kept_history.push(pos);
            }
        }

        self.history = kept_history;

        for restored in restored_positions {
            if let Some(existing) = self.positions.iter_mut().find(|p| p.ticket == restored.ticket) {
                existing.volume += restored.volume;
            } else {
                self.positions.push(restored);
            }
        }
        self.positions.sort_by_key(|p| p.ticket);

        self.pending_orders.clear();
        self.pending_closes.clear();
        self.audit_log.retain(|a| a.click_time_msc <= target_time_msc);

        let max_pos = self.positions.iter().map(|p| p.ticket).max().unwrap_or(0);
        let max_hist = self.history.iter().map(|p| p.ticket).max().unwrap_or(0);
        self.next_ticket = max_pos.max(max_hist) + 1;

        // ジャーナルの未来切り捨て
        self.journal.truncate_future(target_time_msc);
        self.journal.record(
            target_time_msc,
            JournalEvent::SeekOccurred {
                target_time_msc,
                epoch: 0,
            },
        );

        if let Some(tick) = current_tick {
            self.evaluate_mtm(tick);
        }
    }

    /// 注文の受付 (クリック時即刻印)
    pub fn submit_order(
        &mut self,
        symbol: String,
        side: OrderSide,
        volume: f64,
        sl_points: f64,
        tp_points: f64,
        comment: Option<String>,
        now_virtual_msc: i64,
        is_playing: bool,
        current_tick: Option<&CoreTick>,
    ) -> Option<i32> {
        let order_id = self.next_order_id;
        self.next_order_id += 1;

        let request_price = match current_tick {
            Some(t) => if side == OrderSide::Buy { t.ask } else { t.bid },
            None => 0.0,
        };

        self.journal.record(
            now_virtual_msc,
            JournalEvent::OrderSubmitted {
                order_id,
                click_time_msc: now_virtual_msc,
                symbol: symbol.clone(),
                side,
                volume,
                sl_points,
                tp_points,
                request_price,
                comment: comment.clone(),
            },
        );

        let latency_ms = self.calculate_latency_ms();

        if latency_ms > 0 && is_playing {
            // 再生中かつ遅延あり: 遅延後に約定
            self.pending_orders.push(PendingCoreOrder {
                order_id,
                submit_time_msc: now_virtual_msc,
                execute_after_msc: now_virtual_msc + latency_ms,
                symbol,
                side,
                volume,
                sl_points,
                tp_points,
                request_price,
                comment,
            });
            None
        } else {
            // 即時約定
            let fill_time = now_virtual_msc + latency_ms;
            let tick = current_tick?;
            self.execute_fill(order_id, symbol, side, volume, sl_points, tp_points, comment, request_price, fill_time, latency_ms, tick)
        }
    }

    fn execute_fill(
        &mut self,
        order_id: u64,
        symbol: String,
        side: OrderSide,
        volume: f64,
        sl_points: f64,
        tp_points: f64,
        _comment: Option<String>,
        request_price: f64,
        fill_time_msc: i64,
        latency_ms: i64,
        tick: &CoreTick,
    ) -> Option<i32> {
        let is_buy = side == OrderSide::Buy;
        let mut fill_price = if is_buy { tick.ask } else { tick.bid };

        // スリッページ適用
        let slippage_pips = self.calculate_slippage_pips(tick);
        let slip_diff = slippage_pips * 0.01; // USDJPY 0.01 = 1 pip
        if is_buy {
            fill_price += slip_diff;
        } else {
            fill_price -= slip_diff;
        }

        let ticket = self.next_ticket;
        self.next_ticket += 1;

        let sl = if sl_points > 0.0 {
            Some(if is_buy { fill_price - sl_points * 0.01 } else { fill_price + sl_points * 0.01 })
        } else {
            None
        };

        let tp = if tp_points > 0.0 {
            Some(if is_buy { fill_price + tp_points * 0.01 } else { fill_price - tp_points * 0.01 })
        } else {
            None
        };

        let pos = VirtualPosition {
            ticket,
            symbol: symbol.clone(),
            r#type: side.as_str().to_string(),
            volume,
            open_price: fill_price,
            open_time: fill_time_msc / 1000,
            open_time_msc: fill_time_msc,
            close_price: None,
            close_time: None,
            close_time_msc: None,
            sl,
            tp,
            current_price: Some(fill_price),
            commission: 0.0,
            swap: 0.0,
            profit: 0.0,
            close_reason: None,
            mfe_pips: 0.0,
            mae_pips: 0.0,
            spread_entry: tick.spread(),
            volatility: 0.0,
            volume_60s: 0,
            accumulated_real_time: 0.0,
        };

        self.positions.push(pos);

        // ジャーナル & 監査ログ
        self.journal.record(
            fill_time_msc,
            JournalEvent::OrderFilled {
                ticket,
                order_id,
                fill_time_msc,
                fill_price,
                slippage_pips,
                latency_ms,
            },
        );

        self.audit_log.push(ExecutionAuditRecord {
            ticket,
            symbol,
            side: side.as_str().to_string(),
            volume,
            click_time_msc: fill_time_msc - latency_ms,
            fill_time_msc,
            latency_ms,
            request_price,
            fill_price,
            slippage_pips,
        });

        self.evaluate_mtm(tick);
        Some(ticket)
    }

    /// 建玉の決済要求
    pub fn close_position(
        &mut self,
        ticket: i32,
        volume: Option<f64>,
        reason: String,
        now_virtual_msc: i64,
        is_playing: bool,
        current_tick: Option<&CoreTick>,
    ) -> bool {
        let latency_ms = self.calculate_latency_ms();

        if latency_ms > 0 && is_playing {
            self.pending_closes.push(PendingCoreClose {
                execute_after_msc: now_virtual_msc + latency_ms,
                ticket,
                volume,
                reason,
            });
            true
        } else {
            let tick = match current_tick {
                Some(t) => t,
                None => return false,
            };
            self.execute_close(ticket, volume, reason, now_virtual_msc + latency_ms, tick)
        }
    }

    pub fn close_all_positions(
        &mut self,
        reason: String,
        now_virtual_msc: i64,
        is_playing: bool,
        current_tick: Option<&CoreTick>,
    ) {
        let tickets: Vec<i32> = self.positions.iter().map(|p| p.ticket).collect();
        for ticket in tickets {
            self.close_position(ticket, None, reason.clone(), now_virtual_msc, is_playing, current_tick);
        }
    }

    fn execute_close(
        &mut self,
        ticket: i32,
        volume: Option<f64>,
        reason: String,
        close_time_msc: i64,
        tick: &CoreTick,
    ) -> bool {
        let idx = match self.positions.iter().position(|p| p.ticket == ticket) {
            Some(i) => i,
            None => return false,
        };

        let mut pos = self.positions.remove(idx);
        let close_volume = volume.unwrap_or(pos.volume).min(pos.volume);
        let is_buy = pos.r#type == "BUY";
        let mut close_price = if is_buy { tick.bid } else { tick.ask };

        // 成行手動決済時のスリッページ適用
        if reason == "MANUAL" || reason == "CLOSE_ALL" {
            let slip_pips = self.calculate_slippage_pips(tick);
            let slip_diff = slip_pips * 0.01;
            if is_buy {
                close_price -= slip_diff;
            } else {
                close_price += slip_diff;
            }
        }

        let price_diff = if is_buy {
            close_price - pos.open_price
        } else {
            pos.open_price - close_price
        };
        let profit = price_diff * close_volume * self.contract_size;

        if close_volume < pos.volume {
            // 部分決済: 残部を再登録
            let remaining_vol = pos.volume - close_volume;
            let mut remaining_pos = pos.clone();
            remaining_pos.volume = remaining_vol;
            self.positions.push(remaining_pos);
            pos.volume = close_volume;
        }

        pos.close_price = Some(close_price);
        pos.close_time = Some(close_time_msc / 1000);
        pos.close_time_msc = Some(close_time_msc);
        pos.close_reason = Some(reason.clone());
        pos.profit = profit;

        self.account.balance += profit;
        self.account.total_profit += profit;

        self.journal.record(
            close_time_msc,
            JournalEvent::PositionClosed {
                ticket,
                close_time_msc,
                close_price,
                profit,
                reason,
            },
        );

        self.history.push(pos);
        self.evaluate_mtm(tick);
        true
    }

    /// 毎ティック / タイマー進行時の評価処理
    pub fn on_tick_advance(&mut self, tick: &CoreTick, current_time_msc: i64) {
        // 1. 保留中注文の評価
        let mut executed_order_indices = Vec::new();
        for (i, p) in self.pending_orders.iter().enumerate() {
            if current_time_msc >= p.execute_after_msc {
                executed_order_indices.push(i);
            }
        }

        // 逆順で実行 & 削除
        for idx in executed_order_indices.into_iter().rev() {
            let p = self.pending_orders.remove(idx);
            let latency = p.execute_after_msc - p.submit_time_msc;
            self.execute_fill(
                p.order_id,
                p.symbol,
                p.side,
                p.volume,
                p.sl_points,
                p.tp_points,
                p.comment,
                p.request_price,
                p.execute_after_msc,
                latency,
                tick,
            );
        }

        // 2. 保留中決済の評価
        let mut executed_close_indices = Vec::new();
        for (i, p) in self.pending_closes.iter().enumerate() {
            if current_time_msc >= p.execute_after_msc {
                executed_close_indices.push(i);
            }
        }
        for idx in executed_close_indices.into_iter().rev() {
            let p = self.pending_closes.remove(idx);
            self.execute_close(p.ticket, p.volume, p.reason, p.execute_after_msc, tick);
        }

        // 3. SL / TP 自動トリガー判定
        let mut sl_tp_to_close: Vec<(i32, String)> = Vec::new();
        for pos in &self.positions {
            let is_buy = pos.r#type == "BUY";
            if is_buy {
                if let Some(sl) = pos.sl {
                    if tick.bid <= sl {
                        sl_tp_to_close.push((pos.ticket, "SL".to_string()));
                        continue;
                    }
                }
                if let Some(tp) = pos.tp {
                    if tick.bid >= tp {
                        sl_tp_to_close.push((pos.ticket, "TP".to_string()));
                        continue;
                    }
                }
            } else {
                if let Some(sl) = pos.sl {
                    if tick.ask >= sl {
                        sl_tp_to_close.push((pos.ticket, "SL".to_string()));
                        continue;
                    }
                }
                if let Some(tp) = pos.tp {
                    if tick.ask <= tp {
                        sl_tp_to_close.push((pos.ticket, "TP".to_string()));
                        continue;
                    }
                }
            }
        }

        for (ticket, reason) in sl_tp_to_close {
            self.execute_close(ticket, None, reason, current_time_msc, tick);
        }

        // 4. 時価評価更新
        self.evaluate_mtm(tick);
    }

    /// MTM (時価評価損益・証拠金計算)
    pub fn evaluate_mtm(&mut self, tick: &CoreTick) {
        let mut total_unrealized_profit = 0.0;
        let mut total_margin = 0.0;

        for pos in &mut self.positions {
            let is_buy = pos.r#type == "BUY";
            let current_price = if is_buy { tick.bid } else { tick.ask };
            pos.current_price = Some(current_price);

            let diff = if is_buy {
                current_price - pos.open_price
            } else {
                pos.open_price - current_price
            };
            let diff_pips = diff * 100.0; // JPYペア基準 (1 pip = 0.01)

            // MFE / MAE
            if diff_pips > pos.mfe_pips {
                pos.mfe_pips = diff_pips;
            }
            if diff_pips < pos.mae_pips {
                pos.mae_pips = diff_pips;
            }

            let profit = diff * pos.volume * self.contract_size;
            pos.profit = profit;
            total_unrealized_profit += profit;

            // 証拠金計算
            let notional = current_price * pos.volume * self.contract_size;
            total_margin += notional / self.leverage;
        }

        self.account.profit = total_unrealized_profit;
        self.account.equity = self.account.balance + total_unrealized_profit;
        self.account.margin = total_margin;
        self.account.free_margin = self.account.equity - total_margin;
        self.account.margin_level = if total_margin > 0.0 {
            (self.account.equity / total_margin) * 100.0
        } else {
            0.0
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_tick(msc: i64, bid: f64, ask: f64) -> CoreTick {
        CoreTick {
            index: 1,
            time_sec: msc / 1000,
            time_msc: msc,
            bid,
            ask,
            last: 0.0,
            volume: 1,
            volume_real: 0.0,
            flags: 6,
        }
    }

    #[test]
    fn test_submit_and_fill_order() {
        let mut engine = CoreMatchingEngine::new(1_000_000.0, 25.0, 10_000.0);
        let tick = sample_tick(1000, 150.000, 150.005);

        // 成行買い (0ms 遅延)
        let ticket = engine.submit_order(
            "USDJPY".to_string(),
            OrderSide::Buy,
            1.0,
            10.0,
            20.0,
            None,
            1000,
            true,
            Some(&tick),
        );

        assert!(ticket.is_some());
        assert_eq!(engine.positions.len(), 1);
        let ticket_id = engine.positions[0].ticket;
        assert_eq!(engine.positions[0].open_price, 150.005);
        assert_eq!(engine.positions[0].volume, 1.0);
        assert!((engine.positions[0].sl.unwrap() - 149.905).abs() < 1e-4);
        assert!((engine.positions[0].tp.unwrap() - 150.205).abs() < 1e-4);

        // 利益方向へのレート変動 (bid = 150.100) -> 損益は (150.100 - 150.005) * 1.0 * 10000 = +950 JPY
        let next_tick = sample_tick(2000, 150.100, 150.105);
        engine.on_tick_advance(&next_tick, 2000);
        assert!((engine.account.profit - 950.0).abs() < 1e-4);

        // 決済 (bid = 150.100 で決済)
        let res = engine.close_position(ticket_id, None, "MANUAL".to_string(), 2000, true, Some(&next_tick));
        assert!(res);
        assert_eq!(engine.positions.len(), 0);
        assert_eq!(engine.history.len(), 1);
        assert!((engine.account.balance - 1_000_950.0).abs() < 1e-4);
    }

    #[test]
    fn test_rewind_time_travel() {
        let mut engine = CoreMatchingEngine::new(1_000_000.0, 25.0, 10_000.0);
        let tick1 = sample_tick(1000, 150.000, 150.005);
        let ticket = engine.submit_order(
            "USDJPY".to_string(),
            OrderSide::Buy,
            1.0,
            0.0,
            0.0,
            None,
            1000,
            true,
            Some(&tick1),
        ).unwrap();

        // 2000ms で決済
        let tick2 = sample_tick(2000, 150.050, 150.055);
        engine.close_position(ticket, None, "MANUAL".to_string(), 2000, true, Some(&tick2));
        assert_eq!(engine.positions.len(), 0);
        assert_eq!(engine.history.len(), 1);

        // 1500ms へタイムトラベル巻き戻し -> 決済前の未決済ポジションとして復元されるはず
        let tick_rewind = sample_tick(1500, 150.020, 150.025);
        engine.rewind_to(1500, Some(&tick_rewind));

        assert_eq!(engine.positions.len(), 1);
        assert_eq!(engine.history.len(), 0);
        assert_eq!(engine.positions[0].ticket, ticket);
        // 残高は決済前の初期残高に戻る
        assert_eq!(engine.account.balance, 1_000_000.0);
    }

    #[test]
    fn test_realistic_slippage_and_audit_log() {
        let mut engine = CoreMatchingEngine::new(1_000_000.0, 25.0, 10_000.0);
        engine.set_slippage_model(SlippageModel::Realistic {
            base_slippage_pips: 0.5,
            volatility_factor: 1.0,
        });

        let tick = sample_tick(1000, 150.000, 150.005);
        let ticket = engine.submit_order(
            "USDJPY".to_string(),
            OrderSide::Buy,
            1.0,
            0.0,
            0.0,
            None,
            1000,
            true,
            Some(&tick),
        ).unwrap();

        assert_eq!(engine.positions.len(), 1);
        let pos = &engine.positions[0];
        // 基本スリッページ 0.5pips 以上が悪化して約定していること
        assert!(pos.open_price > 150.005);

        // 監査ログの検証
        assert_eq!(engine.audit_log.len(), 1);
        let audit = &engine.audit_log[0];
        assert_eq!(audit.ticket, ticket);
        assert_eq!(audit.click_time_msc, 1000);
        assert_eq!(audit.request_price, 150.005);
        assert_eq!(audit.fill_price, pos.open_price);
        assert!(audit.slippage_pips >= 0.5);
    }
}
