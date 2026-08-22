use crate::drenhis_db::{
    self, DrenhisDbStatus, ProximityConfig, TradeProximityQuery, TradeProximityResult,
};

#[tauri::command]
pub fn check_drenhis_status(custom_path: Option<String>) -> DrenhisDbStatus {
    drenhis_db::get_drenhis_status(custom_path)
}

#[tauri::command]
pub fn match_trades_with_drenhis(
    trades: Vec<TradeProximityQuery>,
    config: ProximityConfig,
    custom_path: Option<String>,
) -> Result<Vec<TradeProximityResult>, String> {
    drenhis_db::query_news_proximity(trades, config, custom_path)
}
