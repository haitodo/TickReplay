use std::fs::File;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use chrono::{Datelike, NaiveDate, Timelike};
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use parquet::arrow::ProjectionMask;
use arrow::array::{Float64Array, Int64Array};
use crate::error::AppError;

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct ExecutionTick {
    pub time_msc: i64,
    pub bid: f64,
    pub ask: f64,
    pub spread: f64,
    pub is_real: bool,
}

#[derive(Debug, Clone)]
pub struct JfxExecutionFeed {
    pub ticks: Vec<ExecutionTick>,
    pub is_real_jfx: bool,
    pub symbol: String,
    pub current_cursor: usize,
}

impl JfxExecutionFeed {
    pub fn empty(symbol: &str) -> Self {
        Self {
            ticks: Vec::new(),
            is_real_jfx: false,
            symbol: symbol.to_string(),
            current_cursor: 0,
        }
    }

    /// 指定した銘柄および日時範囲の実行用ティックデータをロード
    pub fn load(
        symbol: &str,
        start_time_str: &str,
        end_time_str: &str,
        custom_root_dir: Option<&str>,
    ) -> Result<Self, AppError> {
        let root_dir = custom_root_dir
            .map(PathBuf::from)
            .unwrap_or_else(crate::custom_symbol::get_default_tick_dir);

        let clean_sym = symbol.trim().to_uppercase();
        let pair = clean_sym
            .split(['_', '.'])
            .next()
            .unwrap_or(&clean_sym)
            .to_string();
        let pair_lower = pair.to_lowercase();

        let ym_list = get_year_months_between(start_time_str, end_time_str);
        if ym_list.is_empty() {
            return Ok(Self::empty(&pair));
        }

        let mut all_ticks: Vec<ExecutionTick> = Vec::new();
        let mut any_real_jfx = false;

        for (year, month) in ym_list {
            let jfx_parquet = root_dir
                .join("broker=jfx_mt5")
                .join(format!("symbol={}", pair_lower))
                .join(format!("year={:04}", year))
                .join(format!("month={:02}", month))
                .join("data.parquet");

            if jfx_parquet.exists() {
                // JFX実データのロード
                match load_jfx_parquet(&jfx_parquet) {
                    Ok(ticks) => {
                        println!("[JfxExecutionFeed] JFX実データロード成功: {} ({} ティック)", jfx_parquet.display(), ticks.len());
                        all_ticks.extend(ticks);
                        any_real_jfx = true;
                    }
                    Err(e) => {
                        eprintln!("[JfxExecutionFeed] JFX Parquet読込警告 {}: {}", jfx_parquet.display(), e);
                    }
                }
            } else {
                // JFXデータが存在しない過去期間 -> OANDA Parquet から疑似JFX (原則固定0.2銭) 生成
                let ym_str = format!("{:04}-{:02}", year, month);
                let oanda_parquet = root_dir
                    .join("broker=oanda_zip")
                    .join(format!("symbol={}", pair_lower))
                    .join(format!("year={:04}", year))
                    .join(format!("month={:02}", month))
                    .join("data.parquet");

                if oanda_parquet.exists() {
                    match load_oanda_pseudo_parquet(&oanda_parquet, &pair, &ym_str) {
                        Ok(ticks) => {
                            println!("[JfxExecutionFeed] 疑似JFX (OANDAフォールバック) ロード成功: {} ({} ティック)", oanda_parquet.display(), ticks.len());
                            all_ticks.extend(ticks);
                        }
                        Err(e) => {
                            eprintln!("[JfxExecutionFeed] OANDA Parquet読込警告 {}: {}", oanda_parquet.display(), e);
                        }
                    }
                } else {
                    println!("[JfxExecutionFeed] データなし: {} / {}", jfx_parquet.display(), oanda_parquet.display());
                }
            }
        }

        all_ticks.sort_by_key(|t| t.time_msc);

        Ok(Self {
            ticks: all_ticks,
            is_real_jfx: any_real_jfx,
            symbol: pair,
            current_cursor: 0,
        })
    }

    /// 指定ミリ秒時点での最新クォートを高速取得 (O(log N))
    pub fn get_quote_at(&mut self, time_msc: i64) -> Option<ExecutionTick> {
        if self.ticks.is_empty() {
            return None;
        }

        // 直近カーソルの前方線形探索で 99% の再生時アクセスを O(1) に最適化
        let len = self.ticks.len();
        if self.current_cursor < len && self.ticks[self.current_cursor].time_msc <= time_msc {
            let mut next = self.current_cursor;
            while next + 1 < len && self.ticks[next + 1].time_msc <= time_msc {
                next += 1;
            }
            self.current_cursor = next;
            return Some(self.ticks[self.current_cursor]);
        }

        // シークや巻き戻し時: 全体二分探索
        let idx = match self.ticks.binary_search_by_key(&time_msc, |t| t.time_msc) {
            Ok(exact) => exact,
            Err(0) => 0,
            Err(insert_idx) => insert_idx - 1,
        };

        self.current_cursor = idx;
        Some(self.ticks[idx])
    }

    /// 前回評価時刻から今回時刻までの通過ティック範囲を取得 (SL/TP判定・ポジション評価用)
    pub fn get_ticks_range(&mut self, from_msc: i64, to_msc: i64) -> &[ExecutionTick] {
        if self.ticks.is_empty() || from_msc > to_msc {
            return &[];
        }

        let start_idx = match self.ticks.binary_search_by_key(&from_msc, |t| t.time_msc) {
            Ok(idx) => idx,
            Err(idx) => idx,
        };

        let end_idx = match self.ticks.binary_search_by_key(&to_msc, |t| t.time_msc) {
            Ok(idx) => idx + 1,
            Err(idx) => idx,
        };

        if start_idx < self.ticks.len() && start_idx < end_idx {
            let actual_end = end_idx.min(self.ticks.len());
            self.current_cursor = actual_end.saturating_sub(1);
            &self.ticks[start_idx..actual_end]
        } else {
            &[]
        }
    }
}

/// JFX実測Parquetの読み込み
fn load_jfx_parquet(parquet_path: &Path) -> Result<Vec<ExecutionTick>, AppError> {
    let file = File::open(parquet_path)?;
    let builder = ParquetRecordBatchReaderBuilder::try_new(file)
        .map_err(|e| AppError::Config(format!("JFX Parquetオープン失敗 '{}': {}", parquet_path.display(), e)))?;

    let file_schema = builder.schema();
    let wanted = ["mt5_ms", "utc_ms", "bid", "ask"];
    let mut root_indices = Vec::new();
    for (idx, field) in file_schema.fields().iter().enumerate() {
        if wanted.iter().any(|&c| c.eq_ignore_ascii_case(field.name())) {
            root_indices.push(idx);
        }
    }

    let builder = if !root_indices.is_empty() {
        let mask = ProjectionMask::roots(builder.parquet_schema(), root_indices);
        builder.with_projection(mask)
    } else {
        builder
    };

    let mut reader = builder.build()
        .map_err(|e| AppError::Config(format!("JFX Parquetリーダー生成エラー: {}", e)))?;

    let mut ticks = Vec::new();

    while let Some(Ok(batch)) = reader.next() {
        let schema = batch.schema();
        let mt5_ms_idx = schema.index_of("mt5_ms").ok();
        let utc_ms_idx = schema.index_of("utc_ms").ok();
        let bid_idx = schema.index_of("bid").ok();
        let ask_idx = schema.index_of("ask").ok();

        let (Some(b_idx), Some(a_idx)) = (bid_idx, ask_idx) else { continue; };
        let bid_col = batch.column(b_idx).as_any().downcast_ref::<Float64Array>();
        let ask_col = batch.column(a_idx).as_any().downcast_ref::<Float64Array>();
        let mt5_col = mt5_ms_idx.and_then(|i| batch.column(i).as_any().downcast_ref::<Int64Array>());
        let utc_col = utc_ms_idx.and_then(|i| batch.column(i).as_any().downcast_ref::<Int64Array>());

        let (Some(b_arr), Some(a_arr)) = (bid_col, ask_col) else { continue; };

        for row in 0..batch.num_rows() {
            let bid = b_arr.value(row);
            let ask = a_arr.value(row);
            let spread = ((ask - bid) * 1000.0).round() / 1000.0;

            let time_msc = if let Some(m_arr) = mt5_col {
                m_arr.value(row)
            } else if let Some(u_arr) = utc_col {
                let utc_ms = u_arr.value(row);
                let utc_sec = utc_ms / 1000;
                let dt = chrono::DateTime::from_timestamp(utc_sec, 0)
                    .map(|d| d.naive_utc())
                    .unwrap_or_default();
                let is_dst = crate::pseudo_dmm::PseudoDmmEngine::is_us_dst(dt.year(), dt.month(), dt.day(), dt.hour());
                let offset = if is_dst { 3 * 3600 * 1000 } else { 2 * 3600 * 1000 };
                utc_ms + offset
            } else {
                continue;
            };

            ticks.push(ExecutionTick {
                time_msc,
                bid,
                ask,
                spread,
                is_real: true,
            });
        }
    }

    Ok(ticks)
}

/// OANDA Parquet から疑似JFX (0.2銭原則固定) を生成して読み込み
fn load_oanda_pseudo_parquet(
    parquet_path: &Path,
    pair: &str,
    year_month: &str,
) -> Result<Vec<ExecutionTick>, AppError> {
    let file = File::open(parquet_path)?;
    let builder = ParquetRecordBatchReaderBuilder::try_new(file)
        .map_err(|e| AppError::Config(format!("OANDA Parquetオープン失敗 '{}': {}", parquet_path.display(), e)))?;

    let file_schema = builder.schema();
    let wanted = ["mt5_ms", "utc_ms", "bid", "ask"];
    let mut root_indices = Vec::new();
    for (idx, field) in file_schema.fields().iter().enumerate() {
        if wanted.iter().any(|&c| c.eq_ignore_ascii_case(field.name())) {
            root_indices.push(idx);
        }
    }

    let builder = if !root_indices.is_empty() {
        let mask = ProjectionMask::roots(builder.parquet_schema(), root_indices);
        builder.with_projection(mask)
    } else {
        builder
    };

    let mut reader = builder.build()
        .map_err(|e| AppError::Config(format!("OANDA Parquetリーダー生成エラー: {}", e)))?;

    let mut pseudo_engine = crate::pseudo_dmm::PseudoDmmEngine::new(pair, year_month);
    let mut ticks = Vec::new();

    while let Some(Ok(batch)) = reader.next() {
        let schema = batch.schema();
        let mt5_ms_idx = schema.index_of("mt5_ms").ok();
        let utc_ms_idx = schema.index_of("utc_ms").ok();
        let bid_idx = schema.index_of("bid").ok();
        let ask_idx = schema.index_of("ask").ok();

        let (Some(b_idx), Some(a_idx)) = (bid_idx, ask_idx) else { continue; };
        let bid_col = batch.column(b_idx).as_any().downcast_ref::<Float64Array>();
        let ask_col = batch.column(a_idx).as_any().downcast_ref::<Float64Array>();
        let mt5_col = mt5_ms_idx.and_then(|i| batch.column(i).as_any().downcast_ref::<Int64Array>());
        let utc_col = utc_ms_idx.and_then(|i| batch.column(i).as_any().downcast_ref::<Int64Array>());

        let (Some(b_arr), Some(a_arr)) = (bid_col, ask_col) else { continue; };

        for row in 0..batch.num_rows() {
            let raw_bid = b_arr.value(row);
            let raw_ask = a_arr.value(row);

            let time_msc = if let Some(m_arr) = mt5_col {
                m_arr.value(row)
            } else if let Some(u_arr) = utc_col {
                let utc_ms = u_arr.value(row);
                let utc_sec = utc_ms / 1000;
                let dt = chrono::DateTime::from_timestamp(utc_sec, 0)
                    .map(|d| d.naive_utc())
                    .unwrap_or_default();
                let is_dst = crate::pseudo_dmm::PseudoDmmEngine::is_us_dst(dt.year(), dt.month(), dt.day(), dt.hour());
                let offset = if is_dst { 3 * 3600 * 1000 } else { 2 * 3600 * 1000 };
                utc_ms + offset
            } else {
                continue;
            };

            if let Some((p_bid, p_ask, p_spread)) = pseudo_engine.process_tick(time_msc, raw_bid, raw_ask) {
                ticks.push(ExecutionTick {
                    time_msc,
                    bid: p_bid,
                    ask: p_ask,
                    spread: p_spread,
                    is_real: false,
                });
            }
        }
    }

    Ok(ticks)
}

/// 開始日時・終了日時文字列から (年, 月) のリストを生成
pub fn get_year_months_between(start_str: &str, end_str: &str) -> Vec<(i32, u32)> {
    let parse_dt = |s: &str| -> Option<NaiveDate> {
        let clean = s.trim().replace('T', " ").replace('.', "-").replace('/', "-");
        let parts: Vec<&str> = clean.split(' ').collect();
        let date_part = parts.first()?;
        let d_parts: Vec<&str> = date_part.split('-').collect();
        if d_parts.len() >= 3 {
            let y: i32 = d_parts[0].parse().ok()?;
            let m: u32 = d_parts[1].parse().ok()?;
            let d: u32 = d_parts[2].parse().ok()?;
            NaiveDate::from_ymd_opt(y, m, d)
        } else {
            None
        }
    };

    let start_date = parse_dt(start_str).unwrap_or_else(|| NaiveDate::from_ymd_opt(2026, 1, 1).unwrap());
    let end_date = parse_dt(end_str).unwrap_or(start_date);

    let mut result = Vec::new();
    let mut cur_y = start_date.year();
    let mut cur_m = start_date.month();
    let end_y = end_date.year();
    let end_m = end_date.month();

    while (cur_y < end_y) || (cur_y == end_y && cur_m <= end_m) {
        result.push((cur_y, cur_m));
        if cur_m == 12 {
            cur_y += 1;
            cur_m = 1;
        } else {
            cur_m += 1;
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_year_months_between() {
        let list = get_year_months_between("2026-02-01 00:00:00", "2026-04-15 12:00:00");
        assert_eq!(list, vec![(2026, 2), (2026, 3), (2026, 4)]);
    }

    #[test]
    fn test_get_quote_binary_search() {
        let mut feed = JfxExecutionFeed {
            ticks: vec![
                ExecutionTick { time_msc: 1000, bid: 150.000, ask: 150.002, spread: 0.002, is_real: true },
                ExecutionTick { time_msc: 2000, bid: 150.005, ask: 150.007, spread: 0.002, is_real: true },
                ExecutionTick { time_msc: 3000, bid: 150.010, ask: 150.012, spread: 0.002, is_real: true },
            ],
            is_real_jfx: true,
            symbol: "USDJPY".to_string(),
            current_cursor: 0,
        };

        let q1 = feed.get_quote_at(1500).unwrap();
        assert_eq!(q1.time_msc, 1000);
        assert_eq!(q1.bid, 150.000);

        let q2 = feed.get_quote_at(2000).unwrap();
        assert_eq!(q2.time_msc, 2000);
        assert_eq!(q2.bid, 150.005);

        let q3 = feed.get_quote_at(500).unwrap();
        assert_eq!(q3.time_msc, 1000);
    }

    #[test]
    fn test_real_vs_pseudo_month_fallback() {
        let root = Path::new(r"D:\Drehis\tick");
        if !root.exists() {
            return;
        }

        // 2026年1月: JFX実データが存在しないため、OANDA擬似スプレッドに自動フォールバック
        let feed_jan = JfxExecutionFeed::load("USDJPY", "2026-01-05 09:00:00", "2026-01-05 09:05:00", Some(r"D:\Drehis\tick")).unwrap();
        if !feed_jan.ticks.is_empty() {
            assert!(!feed_jan.is_real_jfx, "2026年1月はJFX実データが存在しないためis_real_jfxはfalseであるべき");
            assert!(!feed_jan.ticks[0].is_real);
        }

        // 2026年2月: JFX実データが存在するため、JFXリアルを読み込み
        let feed_feb = JfxExecutionFeed::load("USDJPY", "2026-02-05 09:00:00", "2026-02-05 09:05:00", Some(r"D:\Drehis\tick")).unwrap();
        if !feed_feb.ticks.is_empty() {
            assert!(feed_feb.is_real_jfx, "2026年2月はJFX実データが存在するためis_real_jfxはtrueであるべき");
            assert!(feed_feb.ticks[0].is_real);
        }
    }
}
