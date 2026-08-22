export type BrokerType = "gmo" | "dmm" | "sbi" | "mt4" | "mt5" | "generic" | "replay";

export interface NearbyEconomicEvent {
  event_id: number;
  event_name: string;
  currency_code: string;
  importance: string;
  release_date: number;
  time_diff_sec: number; // エントリー時刻との差（秒）: +60は発表1分後、-60は発表1分前
  actual_value?: string | null;
  forecast_value?: string | null;
  previous_value?: string | null;
}

export interface TradeRecord {
  id: string;                      // 一意な識別子
  ticket: string | number;         // 注文番号・チケット番号
  source: BrokerType;              // データ元
  sourceName: string;              // データセット名（例: "GMO_2026年5月.csv", "Replay Session"）
  symbol: string;                  // 通貨ペア（例: "USDJPY", "EURUSD"）
  type: "BUY" | "SELL";            // 売買区分
  lots: number;                    // 取引数量 (ロット)
  open_time: string;               // エントリー日時（表示用フォーマット: YYYY-MM-DD HH:mm:ss）
  open_time_msc: number;           // エントリーUTCミリ秒（Phase 3の指標照合に使用）
  open_price: number;              // エントリーレート
  close_time: string;              // 決済日時（表示用フォーマット: YYYY-MM-DD HH:mm:ss）
  close_time_msc: number;          // 決済UTCミリ秒
  close_price: number;             // 決済レート
  profit: number;                  // 実現損益（円または口座通貨）
  pips: number;                    // 獲得pips（自動算出またはインポート値）
  commission?: number;             // 手数料
  swap?: number;                   // スワップ
  comment?: string;                // コメント・メモ
  // 拡張メトリクス（算出値）
  durationSec: number;             // 保有秒数
  entryIntervalSec?: number;       // 前回決済からの間隔秒数
  hourJst: number;                 // エントリー時間帯 (0-23 JST)
  dayJst: number;                  // エントリー曜日 (0=日, 1=月...6=土)
  // Phase 3でDrenhisから引き当てる拡張フラグ
  isNearNews?: boolean;            // 指標発表近接フラグ (±N分)
  nearNewsEvent?: string;          // 近接指標名
  nearNewsTimeDiffSec?: number;    // 指標発表との時間差 (秒)
  nearNewsImportance?: string;     // 重要度 (High, Mid, Low / ★★★)
  nearNewsCurrency?: string;       // 対象通貨 (USD, JPY等)
  nearNewsActual?: string;         // 発表結果値
  nearNewsForecast?: string;       // 予想値
  nearNewsPrevious?: string;       // 前回値
  nearbyEvents?: NearbyEconomicEvent[]; // 周辺の全指標イベント
  // 追加分析用
  mfe_pips?: number;               // 最大順行幅 (pips)
  mae_pips?: number;               // 最大逆行幅 (pips)
}

export interface DrenhisDbStatus {
  connected: boolean;
  db_path: string;
  total_indicators: number;
  total_events: number;
  min_date_ms: number | null;
  max_date_ms: number | null;
  error: string | null;
}

export interface ProximityConfig {
  window_minutes: number;          // 5, 15, 30, 60
  importance_filter: "all" | "medium_high" | "high_only";
  match_currencies: boolean;       // 通貨ペアの関連通貨のみに絞り込むか
}

export interface ProximityComparisonStats {
  regularTrades: {
    count: number;
    winRate: number;
    totalProfit: number;
    profitFactor: number;
    expectancy: number;
    avgWin: number;
    avgLoss: number;
  };
  nearNewsTrades: {
    count: number;
    winRate: number;
    totalProfit: number;
    profitFactor: number;
    expectancy: number;
    avgWin: number;
    avgLoss: number;
  };
  winRateDiff: number;             // 近接時の勝率差 (%ポイント)
  profitFactorDiff: number;        // PF差
  advice: string;                  // ガバナンス・アドバイス診断文
}

export interface ParsedTradeBatch {
  broker: BrokerType;
  brokerNameJa: string;
  sourceFileName: string;
  totalRecords: number;
  trades: TradeRecord[];
  dateRange: {
    start: string;
    end: string;
  };
  symbols: string[];
}

export interface SavedTradeDataset {
  id: string;
  name: string;
  broker: BrokerType;
  brokerNameJa: string;
  importedAt: string;
  tradeCount: number;
  dateRange: {
    start: string;
    end: string;
  };
  trades: TradeRecord[];
}

export interface TradeStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;                 // % (0-100)
  totalProfit: number;             // 実現損益合計
  totalPips: number;               // 獲得pips合計
  profitFactor: number;            // PF
  expectancy: number;              // 1トレードあたりの期待利益
  expectancyPips: number;          // 1トレードあたりの期待pips
  avgWin: number;                  // 平均利益
  avgLoss: number;                 // 平均損失
  avgWinPips: number;              // 平均利益pips
  avgLossPips: number;             // 平均損失pips
  riskRewardRatio: number;         // リスクリワード比率 (avgWin / avgLoss)
  maxDrawdown: number;             // 最大ドローダウン金額
  maxDrawdownPercent: number;      // 最大ドローダウン率 (%)
  maxConsecutiveWins: number;      // 最大連勝数
  maxConsecutiveLosses: number;    // 最大連敗数
  longTrades: number;              // 買いトレード数
  longWins: number;
  longProfit: number;
  shortTrades: number;             // 売りトレード数
  shortWins: number;
  shortProfit: number;
  avgDurationSec: number;          // 平均保有時間（秒）
}

export interface AnalysisFilterState {
  period: "all" | "today" | "week" | "month" | "custom";
  customStart?: string;
  customEnd?: string;
  symbol: string;                  // "all" or 特定通貨ペア
  side: "all" | "BUY" | "SELL";
  outcome: "all" | "win" | "loss";
  newsProximity: "all" | "near_news" | "regular"; // 指標近接フィルター
  holdingBucket: number | null;    // 0: <5s, 1: 5-15s, 2: 15-30s, 3: 30-60s, 4: 1-3m, 5: >3m
  dayOfWeek: number | null;        // 0-6 (null: all)
  hourOfDay: number | null;        // 0-23 (null: all)
  searchQuery: string;
}
