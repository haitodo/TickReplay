use serde::{Deserialize, Serialize};
use crate::core::types::{CoreTick, LatencyModel, OrderSide, SlippageModel, TimeStopMode};
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

#[inline]
fn contains_ignore_case(haystack: &str, needle_upper: &[u8]) -> bool {
    if needle_upper.is_empty() {
        return true;
    }
    if haystack.len() < needle_upper.len() {
        return false;
    }
    haystack.as_bytes().windows(needle_upper.len()).any(|w| {
        w.iter().zip(needle_upper.iter()).all(|(&a, &b)| a.to_ascii_uppercase() == b)
    })
}

#[inline]
pub fn symbol_specs(symbol: &str, ref_price: f64) -> (f64, f64, u32) {
    if contains_ignore_case(symbol, b"JPY") || (symbol.is_empty() && ref_price > 20.0) {
        (0.001, 0.01, 3)
    } else if contains_ignore_case(symbol, b"XAU") || contains_ignore_case(symbol, b"GOLD") {
        (0.01, 0.1, 2)
    } else if contains_ignore_case(symbol, b"BTC")
        || contains_ignore_case(symbol, b"ETH")
        || contains_ignore_case(symbol, b"225")
        || contains_ignore_case(symbol, b"US30")
        || contains_ignore_case(symbol, b"NAS")
    {
        (0.01, 1.0, 2)
    } else {
        (0.00001, 0.0001, 5)
    }
}

#[inline]
pub fn round_to_point(price: f64, digits: u32) -> f64 {
    const POW10: [f64; 9] = [
        1.0, 10.0, 100.0, 1_000.0, 10_000.0, 100_000.0, 1_000_000.0, 10_000_000.0, 100_000_000.0,
    ];
    let factor = if (digits as usize) < POW10.len() {
        POW10[digits as usize]
    } else {
        10f64.powi(digits as i32)
    };
    (price * factor).round() / factor
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
    pub hedging: bool,
    pub history_revision: u64,
    pub latency_model: LatencyModel,
    pub slippage_model: SlippageModel,
    pub next_ticket: i32,
    pub next_order_id: u64,
    pub prng: DeterministicPrng,
    pub time_stop_enabled: bool,
    pub time_stop_seconds: u32,
    pub time_stop_mode: TimeStopMode,
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
            hedging: true,
            history_revision: 1,
            latency_model: LatencyModel::Zero,
            slippage_model: SlippageModel::None,
            next_ticket: 1,
            next_order_id: 1,
            prng: DeterministicPrng::new(42),
            time_stop_enabled: false,
            time_stop_seconds: 20,
            time_stop_mode: TimeStopMode::LossOnly,
        }
    }

    #[inline]
    pub fn revision(&self) -> u64 {
        self.journal.revision()
    }

    #[inline]
    pub fn has_pending_triggers(&self) -> bool {
        !self.pending_orders.is_empty() || !self.pending_closes.is_empty()
    }

    pub fn set_time_stop(&mut self, enabled: bool, seconds: u32, mode: TimeStopMode) {
        self.time_stop_enabled = enabled;
        self.time_stop_seconds = seconds;
        self.time_stop_mode = mode;
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

    pub fn set_hedging(&mut self, hedging: bool) {
        self.hedging = hedging;
    }

    pub fn set_contract_size(&mut self, size: f64) {
        self.contract_size = size;
    }

    pub fn set_leverage(&mut self, leverage: f64) {
        if leverage > 0.0 {
            self.leverage = leverage;
            self.account.leverage = leverage;
        }
    }

    pub fn restore_account(&mut self, account: VirtualAccount, next_ticket: i32) {
        self.leverage = account.leverage.max(1.0);
        self.account = account;
        self.positions.clear();
        self.history.clear();
        self.pending_orders.clear();
        self.pending_closes.clear();
        self.next_ticket = next_ticket.max(1);
        self.history_revision = self.history_revision.wrapping_add(1);
    }

    pub fn restore_position(&mut self, pos: VirtualPosition) {
        if pos.ticket >= self.next_ticket {
            self.next_ticket = pos.ticket + 1;
        }
        self.positions.push(pos);
    }

    pub fn restore_history(&mut self, hist: VirtualPosition) {
        if hist.ticket >= self.next_ticket {
            self.next_ticket = hist.ticket + 1;
        }
        self.history.push(hist);
        self.history_revision = self.history_revision.wrapping_add(1);
    }

    pub fn account_transaction(
        &mut self,
        is_deposit: bool,
        amount: f64,
        comment: Option<String>,
        now_msc: i64,
    ) {
        let delta = if is_deposit { amount } else { -amount };
        self.account.balance += delta;
        self.account.equity += delta;
        self.account.free_margin += delta;
        self.history_revision = self.history_revision.wrapping_add(1);
        self.journal.record(
            now_msc,
            JournalEvent::AccountTransaction {
                is_deposit,
                amount,
                comment,
                time_msc: now_msc,
            },
        );
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
        self.history_revision = self.history_revision.wrapping_add(1);

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
            } else if pos.close_time_msc.is_some_and(|ct| ct > target_time_msc) {
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
        self.history_revision = self.history_revision.wrapping_add(1);

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
    #[allow(clippy::too_many_arguments)]
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

    #[allow(clippy::too_many_arguments)]
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
        let mut actual_volume = volume;

        // 両建てOFF (Netting): 逆方向建玉があれば優先相殺決済
        if !self.hedging {
            let opposite_type = if is_buy { "SELL" } else { "BUY" };
            let mut to_close = Vec::new();
            for pos in &self.positions {
                if pos.r#type == opposite_type && actual_volume > 0.0001 {
                    let close_vol = pos.volume.min(actual_volume);
                    to_close.push((pos.ticket, close_vol));
                    actual_volume -= close_vol;
                }
            }
            for (t_ticket, c_vol) in to_close {
                self.execute_close(t_ticket, Some(c_vol), "SETTLEMENT".to_string(), fill_time_msc, tick);
            }
            if actual_volume <= 0.0001 {
                self.evaluate_mtm(tick);
                return None;
            }
        }

        let (_point, pip_size, digits) = symbol_specs(&symbol, tick.ask);
        let mut fill_price = if is_buy { tick.ask } else { tick.bid };

        // スリッページ適用
        let slippage_pips = self.calculate_slippage_pips(tick);
        let slip_diff = slippage_pips * pip_size;
        if is_buy {
            fill_price += slip_diff;
        } else {
            fill_price -= slip_diff;
        }
        fill_price = round_to_point(fill_price, digits);

        let ticket = self.next_ticket;
        self.next_ticket += 1;

        let sl = if sl_points > 0.0 {
            let raw_sl = if is_buy { fill_price - sl_points * pip_size } else { fill_price + sl_points * pip_size };
            Some(round_to_point(raw_sl, digits))
        } else {
            None
        };

        let tp = if tp_points > 0.0 {
            let raw_tp = if is_buy { fill_price + tp_points * pip_size } else { fill_price - tp_points * pip_size };
            Some(round_to_point(raw_tp, digits))
        } else {
            None
        };

        let pos = VirtualPosition {
            ticket,
            symbol: symbol.clone(),
            r#type: side.as_str().to_string(),
            volume: actual_volume,
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
            volume: actual_volume,
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

    pub fn close_buy_positions(
        &mut self,
        reason: String,
        now_virtual_msc: i64,
        is_playing: bool,
        current_tick: Option<&CoreTick>,
    ) {
        let buy_tickets: Vec<(i32, f64)> = self.positions
            .iter()
            .filter(|p| p.r#type == "BUY")
            .map(|p| (p.ticket, p.volume))
            .collect();
        for (ticket, vol) in buy_tickets {
            self.close_position(ticket, Some(vol), reason.clone(), now_virtual_msc, is_playing, current_tick);
        }
    }

    pub fn close_sell_positions(
        &mut self,
        reason: String,
        now_virtual_msc: i64,
        is_playing: bool,
        current_tick: Option<&CoreTick>,
    ) {
        let sell_tickets: Vec<(i32, f64)> = self.positions
            .iter()
            .filter(|p| p.r#type == "SELL")
            .map(|p| (p.ticket, p.volume))
            .collect();
        for (ticket, vol) in sell_tickets {
            self.close_position(ticket, Some(vol), reason.clone(), now_virtual_msc, is_playing, current_tick);
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
        let (_point, pip_size, digits) = symbol_specs(&pos.symbol, tick.bid);
        let mut close_price = if is_buy { tick.bid } else { tick.ask };

        // 成行手動決済時のスリッページ適用
        if reason == "MANUAL" || reason == "CLOSE_ALL" {
            let slip_pips = self.calculate_slippage_pips(tick);
            let slip_diff = slip_pips * pip_size;
            if is_buy {
                close_price -= slip_diff;
            } else {
                close_price += slip_diff;
            }
            close_price = round_to_point(close_price, digits);
        }

        let price_diff = if is_buy {
            close_price - pos.open_price
        } else {
            pos.open_price - close_price
        };
        let raw_profit = price_diff * close_volume * self.contract_size;
        let profit = if self.account.currency == "JPY" {
            raw_profit.round()
        } else {
            (raw_profit * 100.0).round() / 100.0
        };

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
        self.history_revision = self.history_revision.wrapping_add(1);
        self.evaluate_mtm(tick);
        true
    }

    /// バッチ区間の通過ティック一括評価 (中間全ティックのSL/TP・注文約定・MFE/MAE極値を漏れなく評価し、最新ティックでMTM計算)
    #[inline]
    pub fn on_tick_batch(&mut self, ticks: &[CoreTick], _current_time_msc: i64) {
        if ticks.is_empty() {
            return;
        }
        if self.positions.is_empty() && self.pending_orders.is_empty() && self.pending_closes.is_empty() {
            return;
        }
        let first = &ticks[0];
        let mut min_bid = first.bid;
        let mut max_bid = first.bid;
        let mut min_ask = first.ask;
        let mut max_ask = first.ask;

        for tick in ticks {
            if tick.bid < min_bid { min_bid = tick.bid; }
            if tick.bid > max_bid { max_bid = tick.bid; }
            if tick.ask < min_ask { min_ask = tick.ask; }
            if tick.ask > max_ask { max_ask = tick.ask; }
            self.on_tick_advance_triggers(tick, tick.time_msc);
        }
        if let Some(last_tick) = ticks.last() {
            self.evaluate_mtm_with_extremes(last_tick, min_bid, max_bid, min_ask, max_ask);
        }
    }

    /// 単一ティックによるトリガー評価 (保留注文、保留決済、SL/TP) - ゼロヒープアロケーション
    #[inline]
    pub fn on_tick_advance_triggers(&mut self, tick: &CoreTick, current_time_msc: i64) {
        // 1. 保留中注文の評価 (インプレース FIFO 処理で Vec 確保を完全排除)
        let mut i = 0;
        while i < self.pending_orders.len() {
            if current_time_msc >= self.pending_orders[i].execute_after_msc {
                let p = self.pending_orders.remove(i);
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
            } else {
                i += 1;
            }
        }

        // 2. 保留中決済の評価 (インプレース FIFO 処理で Vec 確保を完全排除)
        let mut i = 0;
        while i < self.pending_closes.len() {
            if current_time_msc >= self.pending_closes[i].execute_after_msc {
                let p = self.pending_closes.remove(i);
                self.execute_close(p.ticket, p.volume, p.reason, p.execute_after_msc, tick);
            } else {
                i += 1;
            }
        }

        // 3. SL / TP 自動トリガー判定 (インプレース判定で通常ティックのヒープ確保 0回)
        let mut i = 0;
        while i < self.positions.len() {
            let pos = &self.positions[i];
            let is_buy = pos.r#type.as_bytes().first() == Some(&b'B');
            let reason_opt = if is_buy {
                if pos.sl.is_some_and(|sl| tick.bid <= sl) {
                    Some("SL")
                } else if pos.tp.is_some_and(|tp| tick.bid >= tp) {
                    Some("TP")
                } else {
                    None
                }
            } else if pos.sl.is_some_and(|sl| tick.ask >= sl) {
                Some("SL")
            } else if pos.tp.is_some_and(|tp| tick.ask <= tp) {
                Some("TP")
            } else {
                None
            };

            if let Some(reason) = reason_opt {
                let ticket = pos.ticket;
                self.execute_close(ticket, None, reason.to_string(), current_time_msc, tick);
            } else {
                i += 1;
            }
        }

        // 4. タイムストップ判定 (指定秒数経過時の自動決済)
        if self.time_stop_enabled && self.time_stop_seconds > 0 {
            let timeout_ms = (self.time_stop_seconds as i64) * 1000;
            let mut i = 0;
            while i < self.positions.len() {
                let pos = &self.positions[i];
                let elapsed_ms = current_time_msc - pos.open_time_msc;
                if elapsed_ms >= timeout_ms {
                    let is_buy = pos.r#type.as_bytes().first() == Some(&b'B');
                    let current_close_price = if is_buy { tick.bid } else { tick.ask };
                    let diff = if is_buy {
                        current_close_price - pos.open_price
                    } else {
                        pos.open_price - current_close_price
                    };
                    let should_close = match self.time_stop_mode {
                        TimeStopMode::LossOnly => diff <= 0.0,
                        TimeStopMode::Always => true,
                    };
                    if should_close {
                        let ticket = pos.ticket;
                        self.execute_close(ticket, None, "TIME_STOP".to_string(), current_time_msc, tick);
                        continue;
                    }
                }
                i += 1;
            }
        }
    }

    /// 毎ティック / タイマー進行時の評価処理
    #[inline]
    pub fn on_tick_advance(&mut self, tick: &CoreTick, current_time_msc: i64) {
        if self.positions.is_empty() && self.pending_orders.is_empty() && self.pending_closes.is_empty() {
            return;
        }
        self.on_tick_advance_triggers(tick, current_time_msc);
        self.evaluate_mtm(tick);
    }

    /// MTM (時価評価損益・証拠金計算)
    #[inline]
    pub fn evaluate_mtm(&mut self, tick: &CoreTick) {
        self.evaluate_mtm_with_extremes(tick, tick.bid, tick.bid, tick.ask, tick.ask);
    }

    /// バッチ極値を考慮した MTM (時価評価損益・MFE/MAE・証拠金計算)
    #[inline]
    pub fn evaluate_mtm_with_extremes(
        &mut self,
        tick: &CoreTick,
        min_bid: f64,
        max_bid: f64,
        min_ask: f64,
        max_ask: f64,
    ) {
        let mut total_unrealized_profit = 0.0;
        let mut total_margin = 0.0;

        for pos in &mut self.positions {
            let is_buy = pos.r#type.as_bytes().first() == Some(&b'B');
            let current_price = if is_buy { tick.bid } else { tick.ask };
            pos.current_price = Some(current_price);

            let (diff, best_diff_pips, worst_diff_pips) = if is_buy {
                let d = current_price - pos.open_price;
                let best = (max_bid - pos.open_price) * 100.0;
                let worst = (min_bid - pos.open_price) * 100.0;
                (d, best, worst)
            } else {
                let d = pos.open_price - current_price;
                let best = (pos.open_price - min_ask) * 100.0;
                let worst = (pos.open_price - max_ask) * 100.0;
                (d, best, worst)
            };

            // MFE / MAE (バッチ内の中間ティック極値も反映)
            if best_diff_pips > pos.mfe_pips {
                pos.mfe_pips = best_diff_pips;
            }
            if worst_diff_pips < pos.mae_pips {
                pos.mae_pips = worst_diff_pips;
            }

            let raw_profit = diff * pos.volume * self.contract_size;
            let profit = if self.account.currency == "JPY" {
                raw_profit.round()
            } else {
                (raw_profit * 100.0).round() / 100.0
            };
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

    #[test]
    fn test_netting_settlement() {
        let mut engine = CoreMatchingEngine::new(1_000_000.0, 25.0, 10_000.0);
        engine.set_hedging(false);

        let t1 = sample_tick(1000, 150.000, 150.002);
        // BUY 1.0 lot @ 150.002
        let t1_id = engine.submit_order("USDJPY".to_string(), OrderSide::Buy, 1.0, 0.0, 0.0, None, 1000, true, Some(&t1)).unwrap();
        assert_eq!(t1_id, 1);
        assert_eq!(engine.positions.len(), 1);

        // SELL 1.0 lot @ 150.020 (相殺決済)
        let t2 = sample_tick(2000, 150.020, 150.022);
        let t2_res = engine.submit_order("USDJPY".to_string(), OrderSide::Sell, 1.0, 0.0, 0.0, None, 2000, true, Some(&t2));
        assert!(t2_res.is_none()); // Netting: completely settled, no new position
        assert_eq!(engine.positions.len(), 0);
        assert_eq!(engine.history.len(), 1);
        // (150.020 - 150.002) * 1.0 * 10,000 = +180 JPY
        assert!((engine.history[0].profit - 180.0).abs() < 1e-4);
        assert!((engine.account.balance - 1_000_180.0).abs() < 1e-4);
    }

    #[test]
    fn test_close_buy_and_sell() {
        let mut engine = CoreMatchingEngine::new(1_000_000.0, 25.0, 10_000.0);
        let t1 = sample_tick(1000, 150.000, 150.002);
        engine.submit_order("USDJPY".to_string(), OrderSide::Buy, 1.0, 0.0, 0.0, None, 1000, true, Some(&t1));
        engine.submit_order("USDJPY".to_string(), OrderSide::Sell, 2.0, 0.0, 0.0, None, 1000, true, Some(&t1));
        assert_eq!(engine.positions.len(), 2);

        // Close only BUY
        let t2 = sample_tick(2000, 150.050, 150.052);
        engine.close_buy_positions("MANUAL".to_string(), 2000, false, Some(&t2));
        assert_eq!(engine.positions.len(), 1);
        assert_eq!(engine.positions[0].r#type, "SELL");
        assert_eq!(engine.history.len(), 1);
    }

    #[test]
    fn test_time_stop_loss_only() {
        let mut engine = CoreMatchingEngine::new(1_000_000.0, 25.0, 10_000.0);
        engine.set_time_stop(true, 10, TimeStopMode::LossOnly);

        let t1 = sample_tick(1_000, 150.000, 150.005);
        let ticket = engine.submit_order(
            "USDJPY".to_string(),
            OrderSide::Buy,
            1.0,
            0.0,
            0.0,
            None,
            1_000,
            true,
            Some(&t1),
        ).unwrap();

        // 9秒後 (10_000ms): まだ制限時間前なので含み損でも切られない
        let t2 = sample_tick(10_000, 149.990, 149.995);
        engine.on_tick_advance(&t2, 10_000);
        assert_eq!(engine.positions.len(), 1);

        // 10秒後 (11_000ms): 含み損 (149.990 <= 150.005) なので TIME_STOP で決済される
        let t3 = sample_tick(11_000, 149.990, 149.995);
        engine.on_tick_advance(&t3, 11_000);
        assert_eq!(engine.positions.len(), 0);
        assert_eq!(engine.history.len(), 1);
        assert_eq!(engine.history[0].ticket, ticket);
        assert_eq!(engine.history[0].close_reason, Some("TIME_STOP".to_string()));

        // 次に、含み益が出ている場合は決済されないことのテスト
        let t4 = sample_tick(12_000, 150.000, 150.005);
        let ticket2 = engine.submit_order(
            "USDJPY".to_string(),
            OrderSide::Buy,
            1.0,
            0.0,
            0.0,
            None,
            12_000,
            true,
            Some(&t4),
        ).unwrap();

        // 10秒経過 (22_000ms): 含み益 (150.020 > 150.005) なので決済されず維持される
        let t5 = sample_tick(22_000, 150.020, 150.025);
        engine.on_tick_advance(&t5, 22_000);
        assert_eq!(engine.positions.len(), 1);
        assert_eq!(engine.positions[0].ticket, ticket2);
    }

    #[test]
    fn test_time_stop_always() {
        let mut engine = CoreMatchingEngine::new(1_000_000.0, 25.0, 10_000.0);
        engine.set_time_stop(true, 10, TimeStopMode::Always);

        let t1 = sample_tick(1_000, 150.000, 150.005);
        let ticket = engine.submit_order(
            "USDJPY".to_string(),
            OrderSide::Buy,
            1.0,
            0.0,
            0.0,
            None,
            1_000,
            true,
            Some(&t1),
        ).unwrap();

        // 10秒経過 (11_000ms): 含み益 (150.050 > 150.005) でも Always モードなので無条件で決済される
        let t2 = sample_tick(11_000, 150.050, 150.055);
        engine.on_tick_advance(&t2, 11_000);
        assert_eq!(engine.positions.len(), 0);
        assert_eq!(engine.history.len(), 1);
        assert_eq!(engine.history[0].ticket, ticket);
        assert_eq!(engine.history[0].close_reason, Some("TIME_STOP".to_string()));
    }
}
