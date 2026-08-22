use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrenhisDbStatus {
    pub connected: bool,
    pub db_path: String,
    pub total_indicators: u64,
    pub total_events: u64,
    pub min_date_ms: Option<i64>,
    pub max_date_ms: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradeProximityQuery {
    pub ticket: String,
    pub symbol: String,
    pub open_time_msc: i64,
    pub close_time_msc: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProximityConfig {
    pub window_minutes: i64,
    pub importance_filter: String, // "all" | "medium_high" | "high_only"
    pub match_currencies: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NearbyEconomicEvent {
    pub event_id: i64,
    pub event_name: String,
    pub currency_code: String,
    pub importance: String,
    pub release_date: i64,
    pub time_diff_sec: i64, // 秒数 (0 = 発表同時, -60 = 発表1分前エントリー, +60 = 発表1分後エントリー)
    pub actual_value: Option<String>,
    pub forecast_value: Option<String>,
    pub previous_value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradeProximityResult {
    pub ticket: String,
    pub is_near_news: bool,
    pub closest_event: Option<NearbyEconomicEvent>,
    pub nearby_events: Vec<NearbyEconomicEvent>,
}

/// DrenhisのSQLite DBパスを自動解決
pub fn resolve_drenhis_db_path(custom_path: Option<&str>) -> Option<PathBuf> {
    if let Some(cp) = custom_path {
        let p = PathBuf::from(cp.trim());
        if p.is_file() {
            return Some(p);
        }
    }

    // Windows LocalAppData: %LOCALAPPDATA%\com.drenhis.app\database\news.db
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let p = PathBuf::from(local_app_data)
            .join("com.drenhis.app")
            .join("database")
            .join("news.db");
        if p.is_file() {
            return Some(p);
        }
    }

    // Windows AppData: %APPDATA%\com.drenhis.app\database\news.db
    if let Ok(app_data) = std::env::var("APPDATA") {
        let p = PathBuf::from(app_data)
            .join("com.drenhis.app")
            .join("database")
            .join("news.db");
        if p.is_file() {
            return Some(p);
        }
    }

    // 相対パス探索 (開発環境)
    let candidate = PathBuf::from("../Drenhis/src-tauri/data/database/news.db");
    if candidate.is_file() {
        return Some(candidate);
    }

    None
}

/// 読み取り専用コネクションをオープン
fn open_readonly_db(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|e| format!("Drenhis DBオープン失敗: {}", e))?;

    conn.execute_batch(
        "
        PRAGMA query_only = ON;
        PRAGMA busy_timeout = 3000;
        ",
    )
    .map_err(|e| format!("PRAGMA設定失敗: {}", e))?;

    Ok(conn)
}

/// Drenhis DBの接続状態および基本統計を取得
pub fn get_drenhis_status(custom_path: Option<String>) -> DrenhisDbStatus {
    let resolved = resolve_drenhis_db_path(custom_path.as_deref());
    let db_path_buf = match resolved {
        Some(p) => p,
        None => {
            return DrenhisDbStatus {
                connected: false,
                db_path: "".to_string(),
                total_indicators: 0,
                total_events: 0,
                min_date_ms: None,
                max_date_ms: None,
                error: Some("Drenhisのデータベース(news.db)が見つかりません。Drenhisを起動するかパスを指定してください。".to_string()),
            };
        }
    };

    let db_path_str = db_path_buf.to_string_lossy().to_string();
    let conn = match open_readonly_db(&db_path_buf) {
        Ok(c) => c,
        Err(e) => {
            return DrenhisDbStatus {
                connected: false,
                db_path: db_path_str,
                total_indicators: 0,
                total_events: 0,
                min_date_ms: None,
                max_date_ms: None,
                error: Some(e),
            };
        }
    };

    let total_indicators: u64 = conn
        .query_row("SELECT COUNT(*) FROM economic_indicators", [], |r| r.get(0))
        .unwrap_or(0);

    let (total_events, min_date_ms, max_date_ms): (u64, Option<i64>, Option<i64>) = conn
        .query_row(
            "SELECT COUNT(*), MIN(release_date), MAX(release_date) FROM economic_events",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap_or((0, None, None));

    DrenhisDbStatus {
        connected: true,
        db_path: db_path_str,
        total_indicators,
        total_events,
        min_date_ms,
        max_date_ms,
        error: None,
    }
}

/// 通貨ペア文字列からベース通貨・クォート通貨を抽出 (例: "USDJPY" -> ["USD", "JPY"])
fn extract_currencies_from_symbol(symbol: &str) -> Vec<String> {
    let s = symbol.to_uppercase().replace('/', "").replace(['-', '_', '.'], "");
    if s.len() >= 6 {
        let base = &s[0..3];
        let quote = &s[3..6];
        vec![base.to_string(), quote.to_string()]
    } else if !s.is_empty() {
        vec![s]
    } else {
        vec![]
    }
}

/// 各トレードに対してDrenhisの経済指標DBから近接イベントをオンデマンド照合
pub fn query_news_proximity(
    trades: Vec<TradeProximityQuery>,
    config: ProximityConfig,
    custom_path: Option<String>,
) -> Result<Vec<TradeProximityResult>, String> {
    let db_path = resolve_drenhis_db_path(custom_path.as_deref())
        .ok_or_else(|| "Drenhisのデータベース(news.db)が見つかりません。".to_string())?;

    let conn = open_readonly_db(&db_path)?;

    let window_ms = config.window_minutes * 60 * 1000;
    let mut results: Vec<TradeProximityResult> = Vec::with_capacity(trades.len());

    for t in trades {
        let entry_ms = t.open_time_msc;
        if entry_ms <= 0 {
            results.push(TradeProximityResult {
                ticket: t.ticket,
                is_near_news: false,
                closest_event: None,
                nearby_events: vec![],
            });
            continue;
        }

        let from_ms = entry_ms - window_ms;
        let to_ms = entry_ms + window_ms;

        // 通貨ペアの関連通貨
        let currencies = if config.match_currencies {
            extract_currencies_from_symbol(&t.symbol)
        } else {
            vec![]
        };

        // SQL構築
        let mut sql = String::from(
            "SELECT e.id, i.event_name, i.currency_code, i.importance, e.release_date,
                    e.actual_value, e.forecast_value, e.previous_value
             FROM economic_events e
             JOIN economic_indicators i ON e.indicator_id = i.id
             WHERE e.release_date BETWEEN ? AND ? ",
        );

        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![
            Box::new(from_ms),
            Box::new(to_ms),
        ];

        // 重要度フィルター
        match config.importance_filter.as_str() {
            "high_only" => {
                sql.push_str("AND (LOWER(i.importance) LIKE '%high%' OR i.importance LIKE '%★★★%' OR i.importance LIKE '%高%') ");
            }
            "medium_high" => {
                sql.push_str("AND (LOWER(i.importance) LIKE '%high%' OR LOWER(i.importance) LIKE '%mid%' OR i.importance LIKE '%★★★%' OR i.importance LIKE '%★★%' OR i.importance LIKE '%高%' OR i.importance LIKE '%中%') ");
            }
            _ => {} // all
        }

        // 通貨フィルター
        if !currencies.is_empty() {
            let placeholders = vec!["?"; currencies.len()].join(",");
            sql.push_str(&format!("AND i.currency_code IN ({}) ", placeholders));
            for c in currencies {
                params_vec.push(Box::new(c));
            }
        }

        sql.push_str("ORDER BY ABS(e.release_date - ?) ASC LIMIT 10");
        params_vec.push(Box::new(entry_ms));

        let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();

        let mut stmt = conn.prepare(&sql).map_err(|e| format!("クエリ作成失敗: {}", e))?;
        let rows = stmt
            .query_map(params_refs.as_slice(), |row| {
                let event_id: i64 = row.get(0)?;
                let event_name: String = row.get(1)?;
                let currency_code: String = row.get(2)?;
                let importance: String = row.get(3).unwrap_or_else(|_| "Normal".to_string());
                let release_date: i64 = row.get(4)?;
                let actual_value: Option<String> = row.get(5)?;
                let forecast_value: Option<String> = row.get(6)?;
                let previous_value: Option<String> = row.get(7)?;

                // タイム差分 (秒): エントリー - 発表日時
                let time_diff_sec = (entry_ms - release_date) / 1000;

                Ok(NearbyEconomicEvent {
                    event_id,
                    event_name,
                    currency_code,
                    importance,
                    release_date,
                    time_diff_sec,
                    actual_value,
                    forecast_value,
                    previous_value,
                })
            })
            .map_err(|e| format!("クエリ実行失敗: {}", e))?;

        let mut nearby_events: Vec<NearbyEconomicEvent> = Vec::new();
        for r in rows {
            if let Ok(ev) = r {
                nearby_events.push(ev);
            }
        }

        let is_near_news = !nearby_events.is_empty();
        let closest_event = nearby_events.first().cloned();

        results.push(TradeProximityResult {
            ticket: t.ticket,
            is_near_news,
            closest_event,
            nearby_events,
        });
    }

    Ok(results)
}
