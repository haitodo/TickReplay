import React, { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Chart,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ScatterController,
  BarController,
  LineController
} from 'chart.js';
import {
  parseTimeStrToUtcMs,
  convertServerStrToJstStr as convertServerToJstStr,
  convertJstStrToServerStr
} from "./utils/timeUtils";
import { formatRate } from "./utils/rateUtils";

// Chart.js のコンポーネント登録
Chart.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ScatterController,
  BarController,
  LineController
);

// --- ヘルパー関数 ---
const formatHoldingTime = (ms: number) => {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

const getHoldingTimeBucketIndex = (sec: number) => {
  if (sec < 5) return 0;
  if (sec < 15) return 1;
  if (sec < 30) return 2;
  if (sec < 60) return 3;
  if (sec < 180) return 4;
  return 5;
};

const holdingBucketLabels = ["< 5s", "5-15s", "15-30s", "30-60s", "1-3m", "> 3m"];

interface ThemePreset {
  id: string;
  nameJa: string;
  nameEn: string;
  color: string;      // --primary-color
  rgb: string;        // --primary-rgb
  hover: string;      // --primary-hover
  onPrimary: string;  // --on-primary
  light: string;      // --primary-light
  border: string;     // --primary-border
}

const THEME_PRESETS: ThemePreset[] = [
  {
    id: "mint",
    nameJa: "サイバーミント",
    nameEn: "Cyber Mint",
    color: "#4adfc8",
    rgb: "74, 223, 200",
    hover: "#37cbb4",
    onPrimary: "#003730",
    light: "#69f9e1",
    border: "#19c3ad"
  },
  {
    id: "blue",
    nameJa: "オーシャンブルー",
    nameEn: "Ocean Blue",
    color: "#38bdf8",
    rgb: "56, 189, 248",
    hover: "#0ea5e9",
    onPrimary: "#0369a1",
    light: "#7dd3fc",
    border: "#0284c7"
  },
  {
    id: "orange",
    nameJa: "サンセットオレンジ",
    nameEn: "Sunset Orange",
    color: "#fb923c",
    rgb: "251, 146, 60",
    hover: "#f97316",
    onPrimary: "#7c2d12",
    light: "#fdba74",
    border: "#ea580c"
  },
  {
    id: "purple",
    nameJa: "ラベンダーパープル",
    nameEn: "Lavender Purple",
    color: "#c084fc",
    rgb: "192, 132, 252",
    hover: "#a855f7",
    onPrimary: "#581c87",
    light: "#d8b4fe",
    border: "#9333ea"
  },
  {
    id: "pink",
    nameJa: "サクラピンク",
    nameEn: "Sakura Pink",
    color: "#f472b6",
    rgb: "244, 114, 182",
    hover: "#ec4899",
    onPrimary: "#831843",
    light: "#f9a8d4",
    border: "#db2777"
  },
  {
    id: "gold",
    nameJa: "レモンゴールド",
    nameEn: "Lemon Gold",
    color: "#fbbf24",
    rgb: "251, 191, 36",
    hover: "#f59e0b",
    onPrimary: "#78350f",
    light: "#fde047",
    border: "#d97706"
  },
  {
    id: "green",
    nameJa: "フォレストグリーン",
    nameEn: "Forest Green",
    color: "#4ade80",
    rgb: "74, 222, 128",
    hover: "#22c55e",
    onPrimary: "#14532d",
    light: "#86efac",
    border: "#16a34a"
  },
  {
    id: "white",
    nameJa: "プラチナホワイト",
    nameEn: "Platinum White",
    color: "#ffffff",
    rgb: "255, 255, 255",
    hover: "#e2e2e9",
    onPrimary: "#0d0f14",
    light: "#ffffff",
    border: "#cbd5e1"
  },
  {
    id: "cream",
    nameJa: "ウォームクリーム",
    nameEn: "Warm Cream",
    color: "#f5e6ca",
    rgb: "245, 230, 202",
    hover: "#e8d4b3",
    onPrimary: "#1c1917",
    light: "#fdf6e2",
    border: "#d7c39d"
  }
];

const THEME_PRESETS_LIGHT: Record<string, Partial<ThemePreset>> = {
  mint: {
    color: "#0d9488",
    rgb: "13, 148, 136",
    hover: "#0f766e",
    onPrimary: "#ffffff",
    light: "#14b8a6",
    border: "#0d9488"
  },
  blue: {
    color: "#0284c7",
    rgb: "2, 132, 199",
    hover: "#0369a1",
    onPrimary: "#ffffff",
    light: "#38bdf8",
    border: "#0284c7"
  },
  orange: {
    color: "#ea580c",
    rgb: "234, 88, 12",
    hover: "#c2410c",
    onPrimary: "#ffffff",
    light: "#fb923c",
    border: "#ea580c"
  },
  purple: {
    color: "#7c3aed",
    rgb: "124, 58, 237",
    hover: "#6d28d9",
    onPrimary: "#ffffff",
    light: "#a78bfa",
    border: "#7c3aed"
  },
  pink: {
    color: "#db2777",
    rgb: "219, 39, 119",
    hover: "#be185d",
    onPrimary: "#ffffff",
    light: "#f472b6",
    border: "#db2777"
  },
  gold: {
    color: "#d97706",
    rgb: "217, 119, 6",
    hover: "#b45309",
    onPrimary: "#ffffff",
    light: "#fbbf24",
    border: "#d97706"
  },
  green: {
    color: "#16a34a",
    rgb: "22, 163, 74",
    hover: "#15803d",
    onPrimary: "#ffffff",
    light: "#4ade80",
    border: "#16a34a"
  },
  white: {
    color: "#1e293b",
    rgb: "30, 41, 59",
    hover: "#0f172a",
    onPrimary: "#ffffff",
    light: "#475569",
    border: "#1e293b"
  },
  cream: {
    color: "#78350f",
    rgb: "120, 53, 15",
    hover: "#451a03",
    onPrimary: "#ffffff",
    light: "#b45309",
    border: "#78350f"
  }
};

export const TradeAnalysisWindowContent: React.FC = () => {
  const [history, setHistory] = useState<any[]>([]);
  const [newsItems] = useState<any[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<number | null>(null);

  // レスポンシブ (コンパクト画面対応) 状態
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [compactTab, setCompactTab] = useState<"dashboard" | "filters" | "inspector">("dashboard");

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const isCompact = windowWidth <= 900;

  // テーマ・CSS同期
  const [themeId, setThemeId] = useState(() => localStorage.getItem("accent-theme") || "cream");
  const [themeMode, setThemeMode] = useState<"dark" | "light">(() => (localStorage.getItem("theme-mode") as "dark" | "light") || "dark");
  const [glassEffect, setGlassEffect] = useState(() => localStorage.getItem("glass-effect") === "true");
  const [plStyle, setPlStyle] = useState(() => localStorage.getItem("pl-style") || "red-blue");

  // 損益配色に応じた具体的なカラー値の算出 (Canvas/SVG描画用)
  const { profitColor, lossColor } = useMemo(() => {
    if (themeMode === "light") {
      if (plStyle === "green-red") {
        return { profitColor: "#16a34a", lossColor: "#dc2626" }; // 利益:緑, 損失:赤
      } else {
        return { profitColor: "#dc2626", lossColor: "#0284c7" }; // 利益:赤, 損失:青
      }
    } else {
      if (plStyle === "green-red") {
        return { profitColor: "#22c55e", lossColor: "#f87171" }; // 利益:緑, 損失:赤
      } else {
        return { profitColor: "#f87171", lossColor: "#38bdf8" }; // 利益:赤, 損失:青
      }
    }
  }, [themeMode, plStyle]);

  // RGBAカラー作成用のヘルパー
  const getRgba = (hex: string, alpha: number) => {
    const trimmed = hex.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      const r = parseInt(trimmed.substring(1, 3), 16);
      const g = parseInt(trimmed.substring(3, 5), 16);
      const b = parseInt(trimmed.substring(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return trimmed;
  };

  // テーマ連動カラーの定義 (Canvas用)
  const labelColor = themeMode === "dark" ? "rgba(255, 255, 255, 0.5)" : "rgba(15, 23, 42, 0.5)";
  const textColor = themeMode === "dark" ? "rgba(255, 255, 255, 0.85)" : "rgba(15, 23, 42, 0.85)";
  const gridColor = themeMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(15, 23, 42, 0.08)";

  // フィルタ状態
  const [filterPeriod, setFilterPeriod] = useState<"all" | "today" | "week" | "month" | "custom">("all");
  const [filterCustomStart, setFilterCustomStart] = useState("");
  const [filterCustomEnd, setFilterCustomEnd] = useState("");
  const [filterSession, setFilterSession] = useState<"all" | "tokyo" | "london" | "newyork">("all");
  const [filterSide, setFilterSide] = useState<"all" | "buy" | "sell">("all");
  const [filterLots, setFilterLots] = useState<"all" | "small" | "medium" | "large">("all");
  const [filterVolatility, setFilterVolatility] = useState<"all" | "low" | "medium" | "high">("all");
  const [filterVolume, setFilterVolume] = useState<"all" | "low" | "medium" | "high">("all");
  const [filterHolding, setFilterHolding] = useState<"all" | "short" | "medium" | "long">("all");

  // クロスフィルタ選択状態
  const [crossFilterHour, setCrossFilterHour] = useState<number | null>(null);
  const [crossFilterDay, setCrossFilterDay] = useState<number | null>(null); // 0=Sun, 1=Mon...
  const [crossFilterHoldingBucket, setCrossFilterHoldingBucket] = useState<number | null>(null);

  // ソートテーブル
  const [sortKey, setSortKey] = useState<string>("close_time_msc");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  // グラフ用 Canvas Ref
  const holdingChartRef = useRef<HTMLCanvasElement>(null);
  const scatterChartRef = useRef<HTMLCanvasElement>(null);

  // Chart インスタンスキャッシュ
  const holdingChartInst = useRef<Chart | null>(null);
  const scatterChartInst = useRef<Chart | null>(null);

  // 初期化とデータ読み込み
  useEffect(() => {
    // テーマ・配色の適用
    document.documentElement.setAttribute("data-theme", themeMode);
    document.documentElement.setAttribute("data-pl-style", plStyle);
    if (glassEffect) {
      document.documentElement.setAttribute("data-glass-effect", "true");
    } else {
      document.documentElement.removeAttribute("data-glass-effect");
    }

    // テーマカラーの適用 (CSS変数)
    const selected = THEME_PRESETS.find(t => t.id === themeId) || THEME_PRESETS[0];
    let color = selected.color;
    let rgb = selected.rgb;
    let hover = selected.hover;
    let onPrimary = selected.onPrimary;
    let light = selected.light;
    let border = selected.border;

    if (themeMode === "light") {
      const lightAdjusted = THEME_PRESETS_LIGHT[selected.id];
      if (lightAdjusted) {
        color = lightAdjusted.color ?? color;
        rgb = lightAdjusted.rgb ?? rgb;
        hover = lightAdjusted.hover ?? hover;
        onPrimary = lightAdjusted.onPrimary ?? onPrimary;
        light = lightAdjusted.light ?? light;
        border = lightAdjusted.border ?? border;
      }
    }

    const docStyle = document.documentElement.style;
    docStyle.setProperty('--primary-color', color);
    docStyle.setProperty('--primary-rgb', rgb);
    docStyle.setProperty('--primary-hover', hover);
    docStyle.setProperty('--on-primary', onPrimary);
    docStyle.setProperty('--primary-light', light);
    docStyle.setProperty('--primary-border', border);
  }, [themeMode, themeId, glassEffect, plStyle]);

  useEffect(() => {
    // 1. 最新ステータスの取得
    invoke<string>("get_last_status").then((last) => {
      if (last && last.trim() !== "") {
        try {
          const data = JSON.parse(last);
          if (data.history) {
            setHistory(data.history);
          }
        } catch (e) {
          console.error("Failed to parse history from status", e);
        }
      }
    });


    // 3. リアルタイムステータスの受信リッスン
    let lastHistoryStr = "";
    const unlisten = listen<string>("mt5-status", (event) => {
      try {
        const data = JSON.parse(event.payload);
        if (data.history) {
          const historyStr = JSON.stringify(data.history);
          if (historyStr !== lastHistoryStr) {
            lastHistoryStr = historyStr;
            setHistory(data.history);
          }
        }
      } catch (e) {
        console.error("Failed to parse history update", e);
      }
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, []);

  // テーマカラーの同期
  useEffect(() => {
    // HTMLストレージ変更検知用
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "accent-theme" && e.newValue) setThemeId(e.newValue);
      if (e.key === "theme-mode" && e.newValue) setThemeMode(e.newValue as "dark" | "light");
      if (e.key === "glass-effect") setGlassEffect(e.newValue === "true");
      if (e.key === "pl-style" && e.newValue) setPlStyle(e.newValue);
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);



  // 各トレードへの追加算出パラメータ（前回決済からの間隔・指標近接チェック）のマップ
  const enrichedHistory = useMemo(() => {
    const sorted = [...history].sort((a, b) => a.open_time_msc - b.open_time_msc);
    return sorted.map((h, idx) => {
      // 連続エントリー間隔 (EntryIntervalSec) の算出
      let entryInterval = 0;
      if (idx > 0) {
        const prev = sorted[idx - 1];
        entryInterval = Math.max(0, (h.open_time_msc - prev.close_time_msc) / 1000);
      }

      // エントリー仮想時間におけるJST時刻の算出
      const openJstStr = convertServerToJstStr(h.open_time);
      const openJstMsc = parseTimeStrToUtcMs(openJstStr);

      // 指標近接フラグ (NewsProximityFlag) のチェック
      let isNearNews = false;
      let nearNewsEvent = "";
      if (!isNaN(openJstMsc) && newsItems.length > 0) {
        for (const item of newsItems) {
          if (item.importance === "HIGH" || item.importance === "VERY_HIGH") {
            const newsTimeMsc = parseTimeStrToUtcMs(item.time);
            if (!isNaN(newsTimeMsc)) {
              const diffMinutes = Math.abs(openJstMsc - newsTimeMsc) / (60 * 1000);
              if (diffMinutes <= 5.0) {
                isNearNews = true;
                nearNewsEvent = `${item.currency}: ${item.event}`;
                break;
              }
            }
          }
        }
      }

      // 保有秒数 (HoldingTimeSec)
      const durationSec = h.close_time_msc && h.open_time_msc ? (h.close_time_msc - h.open_time_msc) / 1000 : 0;

      // エントリー時間から曜日と時間を抽出 (JST基準)
      let hourJst = 0;
      let dayJst = 1; // 1 = Monday
      if (!isNaN(openJstMsc)) {
        const d = new Date(openJstMsc);
        hourJst = d.getUTCHours();
        dayJst = d.getUTCDay(); // 0 = Sun, 1 = Mon...
      }

      return {
        ...h,
        entryInterval,
        isNearNews,
        nearNewsEvent,
        durationSec: typeof durationSec === 'number' && isFinite(durationSec) ? durationSec : 0,
        hourJst,
        dayJst,
        mfe_pips: typeof h.mfe_pips === 'number' && isFinite(h.mfe_pips) ? h.mfe_pips : 0.0,
        mae_pips: typeof h.mae_pips === 'number' && isFinite(h.mae_pips) ? h.mae_pips : 0.0,
        spread_entry: typeof h.spread_entry === 'number' && isFinite(h.spread_entry) ? h.spread_entry : 0.0,
        volatility: typeof h.volatility === 'number' && isFinite(h.volatility) ? h.volatility : 0.0,
        volume_60s: typeof h.volume_60s === 'number' && isFinite(h.volume_60s) ? h.volume_60s : 0,
      };
    });
  }, [history, newsItems]);

  // フィルタの適用
  const filteredHistory = useMemo(() => {
    return enrichedHistory.filter((h) => {
      // 1. 期間フィルタ
      if (filterPeriod === "today") {
        const jstToday = new Date().toLocaleDateString();
        const tradeDate = new Date(h.close_time_msc).toLocaleDateString();
        if (jstToday !== tradeDate) return false;
      } else if (filterPeriod === "week") {
        const now = Date.now();
        if (now - h.close_time_msc > 7 * 24 * 3600 * 1000) return false;
      } else if (filterPeriod === "month") {
        const now = Date.now();
        if (now - h.close_time_msc > 30 * 24 * 3600 * 1000) return false;
      } else if (filterPeriod === "custom") {
        if (filterCustomStart) {
          const startServerMsc = parseTimeStrToUtcMs(convertJstStrToServerStr(filterCustomStart));
          if (!isNaN(startServerMsc) && h.close_time_msc < startServerMsc) return false;
        }
        if (filterCustomEnd) {
          const endServerMsc = parseTimeStrToUtcMs(convertJstStrToServerStr(filterCustomEnd));
          if (!isNaN(endServerMsc) && h.close_time_msc > endServerMsc) return false;
        }
      }

      // 2. セッションフィルタ
      if (filterSession !== "all") {
        const hJst = h.hourJst;
        if (filterSession === "tokyo" && (hJst < 9 || hJst >= 15)) return false;
        if (filterSession === "london" && (hJst < 16 && hJst >= 0)) return false; // ロンドン 16-24JST
        if (filterSession === "newyork" && (hJst < 21 && hJst >= 6)) return false; // NY 21-6JST
      }

      // 3. 売買フィルタ
      if (filterSide !== "all" && h.type.toUpperCase() !== filterSide.toUpperCase()) return false;

      // 4. ロットサイズフィルタ
      if (filterLots !== "all") {
        if (filterLots === "small" && h.volume >= 0.1) return false;
        if (filterLots === "medium" && (h.volume < 0.1 || h.volume >= 1.0)) return false;
        if (filterLots === "large" && h.volume < 1.0) return false;
      }

      // 5. ボラティリティフィルタ
      if (filterVolatility !== "all") {
        if (filterVolatility === "low" && h.volatility >= 2.0) return false;
        if (filterVolatility === "medium" && (h.volatility < 2.0 || h.volatility >= 5.0)) return false;
        if (filterVolatility === "high" && h.volatility < 5.0) return false;
      }

      // 6. 直近出来高フィルタ
      if (filterVolume !== "all") {
        if (filterVolume === "low" && h.volume_60s >= 30) return false;
        if (filterVolume === "medium" && (h.volume_60s < 30 || h.volume_60s >= 100)) return false;
        if (filterVolume === "high" && h.volume_60s < 100) return false;
      }

      // 7. 保有時間フィルタ
      if (filterHolding !== "all") {
        if (filterHolding === "short" && h.durationSec >= 15) return false;
        if (filterHolding === "medium" && (h.durationSec < 15 || h.durationSec >= 60)) return false;
        if (filterHolding === "long" && h.durationSec < 60) return false;
      }

      // 8. クロスフィルタ (曜日×時間ヒートマップ)
      if (crossFilterHour !== null && h.hourJst !== crossFilterHour) return false;
      if (crossFilterDay !== null && h.dayJst !== crossFilterDay) return false;

      // 9. クロスフィルタ (保有時間バケット)
      if (crossFilterHoldingBucket !== null) {
        const bucket = getHoldingTimeBucketIndex(h.durationSec);
        if (bucket !== crossFilterHoldingBucket) return false;
      }

      return true;
    });
  }, [enrichedHistory, filterPeriod, filterCustomStart, filterCustomEnd, filterSession, filterSide, filterLots, filterVolatility, filterVolume, filterHolding, crossFilterHour, crossFilterDay, crossFilterHoldingBucket]);

  // 主要統計の計算
  const stats = useMemo(() => {
    const total = filteredHistory.length;
    if (total === 0) return { total: 0, wins: 0, losses: 0, winRate: 0, pf: 0, expectancy: 0, avgWin: 0, avgLoss: 0, maxDD: 0, avgSpread: 0 };

    const wins = filteredHistory.filter(h => h.profit > 0);
    const losses = filteredHistory.filter(h => h.profit <= 0);

    const winRate = (wins.length / total) * 100;
    
    const totalWinVal = wins.reduce((sum, h) => sum + h.profit, 0);
    const totalLossVal = Math.abs(losses.reduce((sum, h) => sum + h.profit, 0));
    const pf = totalLossVal > 0 ? totalWinVal / totalLossVal : totalWinVal > 0 ? 99.9 : 0;

    const totalPips = filteredHistory.reduce((sum, h) => {
      const isJpy = h.symbol && h.symbol.includes("JPY");
      const pips = h.profit / (h.volume * (isJpy ? 1000 : 10)); // 簡易pips逆算
      return sum + (isFinite(pips) ? pips : 0);
    }, 0);
    const expectancy = totalPips / total;

    const avgWin = wins.length > 0 ? totalWinVal / wins.length : 0;
    const avgLoss = losses.length > 0 ? totalLossVal / losses.length : 0;

    // 最大ドローダウンの簡易計算
    let peak = 0;
    let currentBalance = 1000000; // ダミー初期残高基準
    let maxDD = 0;
    const sortedByTime = [...filteredHistory].sort((a, b) => a.close_time_msc - b.close_time_msc);
    sortedByTime.forEach(h => {
      currentBalance += h.profit;
      if (currentBalance > peak) peak = currentBalance;
      const dd = peak - currentBalance;
      if (dd > maxDD) maxDD = dd;
    });

    const avgSpread = filteredHistory.reduce((sum, h) => sum + h.spread_entry, 0) / total;

    return {
      total,
      wins: wins.length,
      losses: losses.length,
      winRate,
      pf,
      expectancy,
      avgWin,
      avgLoss,
      maxDD,
      avgSpread
    };
  }, [filteredHistory]);

  // 保有秒数バケットヘルパーはファイル先頭に移設されました

  // 時刻×曜日ヒートマップデータの構築 (JST)
  const heatmapData = useMemo(() => {
    // 5行 (Mon-Fri) × 24列 (0-23時) のマトリクスを初期化
    const matrix = Array.from({ length: 5 }, (_, dIdx) => 
      Array.from({ length: 24 }, (_, hIdx) => ({
        day: dIdx + 1, // 1=Mon, 5=Fri
        hour: hIdx,
        count: 0,
        profit: 0.0,
        expectancy: 0.0
      }))
    );

    filteredHistory.forEach(h => {
      const d = h.dayJst;
      const hr = h.hourJst;
      if (d >= 1 && d <= 5 && hr >= 0 && hr < 24) {
        const cell = matrix[d - 1][hr];
        cell.count++;
        cell.profit += h.profit;
      }
    });

    // 平均損益（期待値カラー用）の計算
    matrix.forEach(row => {
      row.forEach(cell => {
        if (cell.count > 0) {
          cell.expectancy = cell.profit / cell.count;
        }
      });
    });

    return matrix;
  }, [filteredHistory]);

  // ウィジェット②: 保有秒数別期待値データの構築
  const holdingBucketStats = useMemo(() => {
    const buckets = Array.from({ length: 6 }, (_, idx) => ({
      index: idx,
      label: holdingBucketLabels[idx],
      count: 0,
      wins: 0,
      profit: 0.0,
      expectancy: 0.0
    }));

    filteredHistory.forEach(h => {
      const bIdx = getHoldingTimeBucketIndex(h.durationSec);
      const b = buckets[bIdx];
      b.count++;
      if (h.profit > 0) b.wins++;
      b.profit += h.profit;
    });

    buckets.forEach(b => {
      if (b.count > 0) {
        b.expectancy = b.profit / b.count;
      }
    });

    return buckets;
  }, [filteredHistory]);

  // ウィジェット③: 散布図データの構築
  const scatterData = useMemo(() => {
    return filteredHistory.map(h => ({
      x: h.mae_pips,
      y: h.mfe_pips,
      profit: h.profit,
      ticket: h.ticket,
      side: h.type
    }));
  }, [filteredHistory]);

  // 1. 保有時間別期待値 Chart.js マウント
  useEffect(() => {
    if (!holdingChartRef.current) return;
    
    // 既存インスタンスの破棄
    if (holdingChartInst.current) {
      holdingChartInst.current.destroy();
    }

    const labels = holdingBucketStats.map(b => b.label);
    const datasetData = holdingBucketStats.map(b => b.expectancy);
    const bgColors = holdingBucketStats.map(b => b.expectancy >= 0 ? getRgba(profitColor, 0.6) : getRgba(lossColor, 0.6));
    const borderColors = holdingBucketStats.map(b => b.expectancy >= 0 ? profitColor : lossColor);

    const ctx = holdingChartRef.current.getContext("2d");
    if (!ctx) return;

    holdingChartInst.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: '平均損益 (JPY)',
          data: datasetData,
          backgroundColor: bgColors,
          borderColor: borderColors,
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (_event, elements) => {
          if (elements.length > 0) {
            const idx = elements[0].index;
            setTimeout(() => {
              setCrossFilterHoldingBucket(prev => prev === idx ? null : idx);
            }, 0);
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` 期待損益: ${Number(ctx.raw).toLocaleString()} JPY (取引件数: ${holdingBucketStats[ctx.dataIndex].count}回)`
            }
          }
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { color: labelColor }
          },
          y: {
            grid: { color: gridColor },
            ticks: { color: labelColor }
          }
        }
      }
    });

    return () => {
      if (holdingChartInst.current) {
        holdingChartInst.current.destroy();
      }
    };
  }, [holdingBucketStats, themeMode, labelColor, gridColor, profitColor, lossColor]);

  // 2. 決済品質散布図 Chart.js マウント
  useEffect(() => {
    if (!scatterChartRef.current) return;

    if (scatterChartInst.current) {
      scatterChartInst.current.destroy();
    }

    const ctx = scatterChartRef.current.getContext("2d");
    if (!ctx) return;

    const dataPoints = scatterData.map(d => ({
      x: d.x,
      y: d.y,
      ticket: d.ticket,
      profit: d.profit,
      side: d.side
    }));

    const pointColors = scatterData.map(d => d.profit > 0 ? profitColor : lossColor);

    scatterChartInst.current = new Chart(ctx, {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'MAE/MFE',
          data: dataPoints,
          backgroundColor: pointColors,
          pointRadius: 6,
          pointHoverRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (_event, elements) => {
          if (elements.length > 0) {
            const datasetIndex = elements[0].datasetIndex;
            const index = elements[0].index;
            const dataPoint: any = scatterChartInst.current?.data.datasets[datasetIndex].data[index];
            if (dataPoint) {
              setTimeout(() => {
                handleSelectTrade(dataPoint.ticket);
              }, 0);
            }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx: any) => {
                const item = ctx.raw;
                return ` Ticket: #${item.ticket} (${item.side}) | MAE: ${item.x.toFixed(1)}p | MFE: ${item.y.toFixed(1)}p | 損益: ${item.profit.toLocaleString()}円`;
              }
            }
          }
        },
        scales: {
          x: {
            title: { display: true, text: "MAE (最大逆行幅 - pips)", color: textColor },
            grid: { color: gridColor },
            ticks: { color: labelColor }
          },
          y: {
            title: { display: true, text: "MFE (最大順行幅 - pips)", color: textColor },
            grid: { color: gridColor },
            ticks: { color: labelColor }
          }
        }
      }
    });

    return () => {
      if (scatterChartInst.current) {
        scatterChartInst.current.destroy();
      }
    };
  }, [scatterData, themeMode, labelColor, textColor, gridColor, profitColor, lossColor]);



  // 取引選択処理
  const handleSelectTrade = (ticket: number) => {
    setSelectedTicket(ticket);
    if (isCompact) {
      setCompactTab("inspector");
    }
  };

  // 選択トレードのメタデータ
  const selectedTrade = useMemo(() => {
    if (selectedTicket === null) return null;
    return enrichedHistory.find(h => h.ticket === selectedTicket) || null;
  }, [selectedTicket, enrichedHistory]);

  // ソートされた明細リスト
  const sortedHistory = useMemo(() => {
    const list = [...filteredHistory];
    list.sort((a, b) => {
      let aVal = a[sortKey];
      let bVal = b[sortKey];
      if (aVal === undefined) aVal = 0;
      if (bVal === undefined) bVal = 0;

      if (typeof aVal === 'string') {
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return list;
  }, [filteredHistory, sortKey, sortDirection]);

  // ソートの切り替え
  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortKey === key && sortDirection === 'asc') {
      direction = 'desc';
    }
    setSortKey(key);
    setSortDirection(direction);
  };

  // 曜日テキスト
  const dayNames = ["日", "月", "火", "水", "木", "金", "土"];

  // ウィジェット④: 勝ち／負け上位20%差異分析 (Context Extractor)
  const contextAdvice = useMemo(() => {
    if (filteredHistory.length < 5) {
      return ["分析を行うには最低5件以上の取引履歴が必要です。さらにリプレイ検証を実行してください。"];
    }

    const sortedByProfit = [...filteredHistory].sort((a, b) => b.profit - a.profit);
    const size20 = Math.max(1, Math.floor(sortedByProfit.length * 0.2));

    const top20 = sortedByProfit.slice(0, size20);
    const bottom20 = sortedByProfit.slice(-size20);

    const avgHoldingTop = top20.reduce((sum, h) => sum + h.durationSec, 0) / size20;
    const avgHoldingBottom = bottom20.reduce((sum, h) => sum + h.durationSec, 0) / size20;

    const avgIntervalBottom = bottom20.reduce((sum, h) => sum + h.entryInterval, 0) / size20;

    const avgVolatilityTop = top20.reduce((sum, h) => sum + h.volatility, 0) / size20;
    const avgVolatilityBottom = bottom20.reduce((sum, h) => sum + h.volatility, 0) / size20;

    const avgVolumeTop = top20.reduce((sum, h) => sum + h.volume_60s, 0) / size20;
    const avgVolumeBottom = bottom20.reduce((sum, h) => sum + h.volume_60s, 0) / size20;

    const advices: string[] = [];

    // 1. 保有時間分析
    if (avgHoldingBottom > avgHoldingTop * 1.5) {
      advices.push(`優秀なトレードの平均保有時間は ${avgHoldingTop.toFixed(1)}秒 ですが、損失上位20%は平均 ${avgHoldingBottom.toFixed(1)}秒 と長くお祈り状態で塩漬けされています。負けポジションの損切りを早めるか時間枠制限を設けてください。`);
    } else if (avgHoldingTop > avgHoldingBottom * 1.5) {
      advices.push(`優秀トレードの平均保有時間は ${avgHoldingTop.toFixed(1)}秒 で、負けトレード（平均 ${avgHoldingBottom.toFixed(1)}秒）に比べて長くなっています。利益を微小でチキン利食いしすぎている可能性があります。目標価格まで利を伸ばしましょう。`);
    }

    // 2. 連敗ポジポジ病チェック
    if (avgIntervalBottom < 15) {
      advices.push(`損失上位20%トレードは、前回決済後平均 ${avgIntervalBottom.toFixed(1)}秒 で再エントリーしています。感情的なリベンジトレードが多発しています。取引終了後は最低1分間キーボードから手を離してください。`);
    }

    // 3. ボラティリティ分析
    if (avgVolatilityTop > avgVolatilityBottom * 1.3) {
      advices.push(`優秀トレードはボラティリティが平均 ${avgVolatilityTop.toFixed(1)}pips の活発な環境で執行されていますが、負けトレードは平均 ${avgVolatilityBottom.toFixed(1)}pips の膠着した相場で行われています。値動きが鈍いときは無駄打ちを避けてください。`);
    }

    // 4. 出来高分析
    if (avgVolumeTop > avgVolumeBottom * 1.3) {
      advices.push(`優秀トレードは直近1分間出来高が平均 ${avgVolumeTop.toFixed(0)}ティック の流動性の高い時間帯に発生していますが、損失トレードは平均 ${avgVolumeBottom.toFixed(0)}ティック の閑散時に集中しています。急激な変動を伴う流動性の高い局面のみを狙いましょう。`);
    }

    if (advices.length === 0) {
      advices.push("優秀トレードと損失トレードの間で行動パターンに顕著な乖離はありません。現在の規律正しい運用を維持してください。");
    }

    return advices;
  }, [filteredHistory]);

  // CSVエクスポート
  const handleExportCSV = () => {
    if (filteredHistory.length === 0) return;
    let csvContent = "\uFEFF"; // BOM
    csvContent += "Ticket,Type,Lots,OpenPrice,OpenTimeJST,ClosePrice,CloseTimeJST,HoldingTimeSec,Profit(JPY),MFE(pips),MAE(pips),Volatility(pips),Volume60s,EntryIntervalSec,NewsProximity\n";
    
    filteredHistory.forEach(h => {
      const row = [
        h.ticket,
        h.type,
        h.volume.toFixed(2),
        h.open_price ? formatRate(h.open_price, h.symbol) : "-",
        convertServerToJstStr(h.open_time),
        h.close_price ? formatRate(h.close_price, h.symbol) : "-",
        convertServerToJstStr(h.close_time),
        h.durationSec.toFixed(1),
        h.profit.toFixed(0),
        h.mfe_pips.toFixed(1),
        h.mae_pips.toFixed(1),
        h.volatility.toFixed(1),
        h.volume_60s,
        h.entryInterval.toFixed(1),
        h.isNearNews ? "YES" : "NO"
      ];
      csvContent += row.join(",") + "\n";
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `trade_analysis_${Date.now()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ショートカットキーハンドラ
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. ↑ / ↓ キーでのリスト選択移動
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (sortedHistory.length === 0) return;
        e.preventDefault();
        const curIdx = sortedHistory.findIndex(h => h.ticket === selectedTicket);
        let targetIdx = 0;
        if (e.key === "ArrowUp") {
          targetIdx = curIdx > 0 ? curIdx - 1 : sortedHistory.length - 1;
        } else {
          targetIdx = curIdx < sortedHistory.length - 1 ? curIdx + 1 : 0;
        }
        handleSelectTrade(sortedHistory[targetIdx].ticket);
      }
      // 2. Ctrl + E でCSVエクスポート
      if (e.ctrlKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        handleExportCSV();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sortedHistory, selectedTicket]);

  return (
    <div className="trade-analysis-window-root" style={{
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      width: "100vw",
      backgroundColor: "var(--background)",
      color: "var(--on-background)",
      overflow: "hidden",
      fontFamily: "'Inter', sans-serif"
    }}>
      {/* 領域1. 上部固定バー (KPI & filters) */}
      <div className="analysis-header" style={{
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        padding: "12px 16px",
        backgroundColor: "var(--surface-container)",
        borderBottom: "1px solid var(--outline-variant)",
        flexShrink: 0
      }}>
        {/* 行1: フィルタコントローラ */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ fontSize: "11px", color: "var(--on-surface-variant)" }}>期間:</span>
            <select className="pro-input" style={{ padding: "4px 8px", fontSize: "11px", height: "26px" }}
              value={filterPeriod} onChange={(e) => setFilterPeriod(e.target.value as any)}>
              <option value="all">すべて</option>
              <option value="today">今日</option>
              <option value="week">直近7日間</option>
              <option value="month">直近30日間</option>
              <option value="custom">カスタム範囲</option>
            </select>
            {filterPeriod === "custom" && (
              <>
                <input type="datetime-local" className="pro-input" style={{ padding: "2px 4px", fontSize: "10px", height: "26px" }}
                  value={filterCustomStart} onChange={(e) => setFilterCustomStart(e.target.value)} />
                <span style={{ fontSize: "10px" }}>〜</span>
                <input type="datetime-local" className="pro-input" style={{ padding: "2px 4px", fontSize: "10px", height: "26px" }}
                  value={filterCustomEnd} onChange={(e) => setFilterCustomEnd(e.target.value)} />
              </>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ fontSize: "11px", color: "var(--on-surface-variant)" }}>市場時間:</span>
            <select className="pro-input" style={{ padding: "4px 8px", fontSize: "11px", height: "26px" }}
              value={filterSession} onChange={(e) => setFilterSession(e.target.value as any)}>
              <option value="all">全セッション</option>
              <option value="tokyo">東京コア (09-15 JST)</option>
              <option value="london">ロンドンコア (16-24 JST)</option>
              <option value="newyork">ニューヨークコア (21-06 JST)</option>
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ fontSize: "11px", color: "var(--on-surface-variant)" }}>売買:</span>
            <select className="pro-input" style={{ padding: "4px 8px", fontSize: "11px", height: "26px" }}
              value={filterSide} onChange={(e) => setFilterSide(e.target.value as any)}>
              <option value="all">両方</option>
              <option value="buy">BUY</option>
              <option value="sell">SELL</option>
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ fontSize: "11px", color: "var(--on-surface-variant)" }}>ロット数:</span>
            <select className="pro-input" style={{ padding: "4px 8px", fontSize: "11px", height: "26px" }}
              value={filterLots} onChange={(e) => setFilterLots(e.target.value as any)}>
              <option value="all">すべて</option>
              <option value="small">S (&lt; 0.1 Lot)</option>
              <option value="medium">M (0.1 - 1.0 Lot)</option>
              <option value="large">L (&gt;= 1.0 Lot)</option>
            </select>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
            {(crossFilterHour !== null || crossFilterDay !== null || crossFilterHoldingBucket !== null) && (
              <button className="pro-btn danger" style={{ padding: "4px 10px", fontSize: "11px", height: "26px" }}
                onClick={() => {
                  setCrossFilterHour(null);
                  setCrossFilterDay(null);
                  setCrossFilterHoldingBucket(null);
                }}>
                連動フィルタクリア
              </button>
            )}
            <button className="pro-btn primary" style={{ padding: "4px 10px", fontSize: "11px", height: "26px" }}
              onClick={handleExportCSV}>
              CSVエクスポート
            </button>
          </div>
        </div>

        {/* 行2: KPIsサマリー */}
        <div style={{ display: "grid", gridTemplateColumns: isCompact ? "repeat(4, 1fr)" : "repeat(8, 1fr)", gap: "6px", marginTop: "4px" }}>
          <div className="stat-card" style={{ padding: "6px 10px", display: "flex", flexDirection: "column", gap: "2px" }}>
            <span style={{ fontSize: "9px", color: "var(--on-surface-variant)" }}>取引件数</span>
            <span style={{ fontSize: "14px", fontWeight: "bold" }}>{stats.total} 回</span>
          </div>
          <div className="stat-card" style={{ padding: "6px 10px", display: "flex", flexDirection: "column", gap: "2px" }}>
            <span style={{ fontSize: "9px", color: "var(--on-surface-variant)" }}>勝率</span>
            <span style={{ fontSize: "14px", fontWeight: "bold", color: "var(--profit-color)" }}>{stats.winRate.toFixed(1)} %</span>
          </div>
          <div className="stat-card" style={{ padding: "6px 10px", display: "flex", flexDirection: "column", gap: "2px" }}>
            <span style={{ fontSize: "9px", color: "var(--on-surface-variant)" }}>PF</span>
            <span style={{ fontSize: "14px", fontWeight: "bold", color: stats.pf >= 1 ? "var(--profit-color)" : "var(--loss-color)" }}>{stats.pf.toFixed(2)}</span>
          </div>
          <div className="stat-card" style={{ padding: "6px 10px", display: "flex", flexDirection: "column", gap: "2px" }}>
            <span style={{ fontSize: "9px", color: "var(--on-surface-variant)" }}>取引期待値</span>
            <span style={{ fontSize: "14px", fontWeight: "bold" }}>{stats.expectancy >= 0 ? "+" : ""}{stats.expectancy.toFixed(1)} pips</span>
          </div>
          <div className="stat-card" style={{ padding: "6px 10px", display: "flex", flexDirection: "column", gap: "2px" }}>
            <span style={{ fontSize: "9px", color: "var(--on-surface-variant)" }}>平均勝トレード</span>
            <span style={{ fontSize: "14px", fontWeight: "bold", color: "var(--profit-color)" }}>+{stats.avgWin.toLocaleString(undefined, { maximumFractionDigits: 0 })} 円</span>
          </div>
          <div className="stat-card" style={{ padding: "6px 10px", display: "flex", flexDirection: "column", gap: "2px" }}>
            <span style={{ fontSize: "9px", color: "var(--on-surface-variant)" }}>平均負トレード</span>
            <span style={{ fontSize: "14px", fontWeight: "bold", color: "var(--loss-color)" }}>-{stats.avgLoss.toLocaleString(undefined, { maximumFractionDigits: 0 })} 円</span>
          </div>
          <div className="stat-card" style={{ padding: "6px 10px", display: "flex", flexDirection: "column", gap: "2px" }}>
            <span style={{ fontSize: "9px", color: "var(--on-surface-variant)" }}>最大DD</span>
            <span style={{ fontSize: "14px", fontWeight: "bold", color: "var(--loss-color)" }}>-{stats.maxDD.toLocaleString(undefined, { maximumFractionDigits: 0 })} 円</span>
          </div>
          <div className="stat-card" style={{ padding: "6px 10px", display: "flex", flexDirection: "column", gap: "2px" }}>
            <span style={{ fontSize: "9px", color: "var(--on-surface-variant)" }}>平均スプレッド</span>
            <span style={{ fontSize: "14px", fontWeight: "bold" }}>{stats.avgSpread.toFixed(1)} pips</span>
          </div>
        </div>

        {/* コンパクト表示用 タブ切り替えバー */}
        {isCompact && (
          <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
            <button
              className={`pro-btn ${compactTab === "dashboard" ? "primary" : ""}`}
              style={{ flex: 1, padding: "4px 6px", fontSize: "10.5px", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}
              onClick={() => setCompactTab("dashboard")}
            >
              <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>analytics</span>
              <span>分析 & 明細</span>
            </button>
            <button
              className={`pro-btn ${compactTab === "filters" ? "primary" : ""}`}
              style={{ flex: 1, padding: "4px 6px", fontSize: "10.5px", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}
              onClick={() => setCompactTab("filters")}
            >
              <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>filter_alt</span>
              <span>環境フィルタ</span>
            </button>
            <button
              className={`pro-btn ${compactTab === "inspector" ? "primary" : ""}`}
              style={{ flex: 1, padding: "4px 6px", fontSize: "10.5px", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}
              onClick={() => setCompactTab("inspector")}
            >
              <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>info</span>
              <span>詳細インスペクタ</span>
            </button>
          </div>
        )}
      </div>

      {/* メイングリッド構成 (3カラム) */}
      <div className="analysis-workspace" style={{
        display: "flex",
        flex: 1,
        overflow: "hidden",
        width: "100%"
      }}>
        {/* 領域2. 左レール */}
        {(!isCompact || compactTab === "filters") && (
          <div className="col-filters" style={{
            width: isCompact ? "100%" : "180px",
            backgroundColor: "var(--surface-container-low)",
            borderRight: isCompact ? "none" : "1px solid var(--outline-variant)",
            padding: "16px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            overflowY: "auto",
            flexShrink: 0
          }}>
            <div>
              <h4 style={{ fontSize: "11px", fontWeight: "bold", marginBottom: "8px", textTransform: "uppercase", color: "var(--on-surface-variant)" }}>市場環境フィルタ</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: "3px", fontSize: "10px" }}>
                  <span>ボラティリティ (pips):</span>
                  <select className="pro-input" style={{ fontSize: "10px", padding: "2px 4px" }}
                    value={filterVolatility} onChange={(e) => setFilterVolatility(e.target.value as any)}>
                    <option value="all">すべて</option>
                    <option value="low">低 (&lt; 2.0 p) </option>
                    <option value="medium">中 (2.0 - 5.0 p)</option>
                    <option value="high">高 (&gt;= 5.0 p)</option>
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "3px", fontSize: "10px" }}>
                  <span>出来高 (60秒間):</span>
                  <select className="pro-input" style={{ fontSize: "10px", padding: "2px 4px" }}
                    value={filterVolume} onChange={(e) => setFilterVolume(e.target.value as any)}>
                    <option value="all">すべて</option>
                    <option value="low">低 (&lt; 30)</option>
                    <option value="medium">中 (30 - 100)</option>
                    <option value="high">高 (&gt;= 100)</option>
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "3px", fontSize: "10px" }}>
                  <span>保有時間 (秒):</span>
                  <select className="pro-input" style={{ fontSize: "10px", padding: "2px 4px" }}
                    value={filterHolding} onChange={(e) => setFilterHolding(e.target.value as any)}>
                    <option value="all">すべて</option>
                    <option value="short">超短期 (&lt; 15s)</option>
                    <option value="medium">短期 (15s - 1m)</option>
                    <option value="long">長期 (&gt;= 1m)</option>
                  </select>
                </label>
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--outline-variant)", paddingTop: "12px" }}>
              <h4 style={{ fontSize: "11px", fontWeight: "bold", marginBottom: "8px", textTransform: "uppercase", color: "var(--on-surface-variant)" }}>分析プリセット</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <button className="pro-btn" style={{ padding: "4px 8px", fontSize: "10px", textAlign: "left" }}
                  onClick={() => {
                    setFilterSession("tokyo");
                    setFilterPeriod("all");
                    setFilterSide("all");
                    setFilterLots("all");
                    setFilterVolatility("all");
                    setFilterVolume("all");
                    setFilterHolding("all");
                    if (isCompact) setCompactTab("dashboard");
                  }}>
                  Tokyo Open
                </button>
                <button className="pro-btn" style={{ padding: "4px 8px", fontSize: "10px", textAlign: "left" }}
                  onClick={() => {
                    setFilterSession("london");
                    setFilterPeriod("all");
                    setFilterSide("all");
                    setFilterLots("all");
                    setFilterVolatility("all");
                    setFilterVolume("all");
                    setFilterHolding("all");
                    if (isCompact) setCompactTab("dashboard");
                  }}>
                  London Open
                </button>
                <button className="pro-btn" style={{ padding: "4px 8px", fontSize: "10px", textAlign: "left" }}
                  onClick={() => {
                    setFilterSession("newyork");
                    setFilterPeriod("all");
                    setFilterSide("all");
                    setFilterLots("all");
                    setFilterVolatility("all");
                    setFilterVolume("all");
                    setFilterHolding("all");
                    if (isCompact) setCompactTab("dashboard");
                  }}>
                  NY Open
                </button>
                <button className="pro-btn danger" style={{ padding: "4px 8px", fontSize: "10px", textAlign: "left" }}
                  onClick={() => {
                    setFilterHolding("all");
                    setFilterVolatility("all");
                    setCrossFilterHoldingBucket(null);
                    setCrossFilterHour(null);
                    setCrossFilterDay(null);
                    alert("下部一覧から前回取引時間(EntryInterval)が短いものをソートすることで、ポジポジ病の検証が行えます。");
                    if (isCompact) setCompactTab("dashboard");
                  }}>
                  連敗リベンジ分析
                </button>
                <button className="pro-btn" style={{ padding: "4px 8px", fontSize: "10px", textAlign: "left" }}
                  onClick={() => {
                    setFilterHolding("long");
                    setFilterVolatility("all");
                    setFilterVolume("all");
                    if (isCompact) setCompactTab("dashboard");
                  }}>
                  短期お祈りトレード
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 領域3. 中央分析キャンバス & 領域5. 下部トレード明細 */}
        {(!isCompact || compactTab === "dashboard") && (
          <div style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            height: "100%",
            minWidth: 0
          }}>
            {/* 2x2中央グリッド */}
            <div className="analysis-grid" style={{
              display: "grid",
              gridTemplateColumns: isCompact ? "1fr" : "1fr 1fr",
              gridTemplateRows: isCompact ? "auto" : "1fr 1fr",
              gap: "10px",
              padding: "10px",
              backgroundColor: "rgba(0,0,0,0.1)",
              flex: 1,
              overflowY: "auto"
            }}>
              {/* ウィジェット①: ヒートマップ */}
              <div className="pro-panel" style={{ padding: "10px", display: "flex", flexDirection: "column", minHeight: isCompact ? "180px" : undefined }}>
                <div className="pro-panel-header" style={{ marginBottom: "6px", flexShrink: 0 }}>
                  <h3 className="pro-panel-title" style={{ fontSize: "11px" }}>① 時刻 × 曜日 ヒートマップ (期待損益カラー)</h3>
                </div>
                <div style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column", gap: "3px", justifyContent: "space-between" }}>
                  {/* 曜日行のループ */}
                  {heatmapData.map((row, rIdx) => {
                    const dayNum = rIdx + 1;
                    return (
                      <div key={dayNum} style={{ display: "flex", alignItems: "center", gap: "3px", height: "18%" }}>
                        <span style={{ fontSize: "9px", width: "16px", color: "var(--on-surface-variant)", textAlign: "center" }}>
                          {dayNames[dayNum]}
                        </span>
                        {row.map((cell) => {
                          let bg = themeMode === "dark" ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)";
                          if (cell.count > 0) {
                            if (cell.expectancy > 0) {
                              const strength = Math.min(0.8, 0.1 + (cell.expectancy / 50000));
                              bg = getRgba(profitColor, strength);
                            } else {
                              const strength = Math.min(0.8, 0.1 + (Math.abs(cell.expectancy) / 50000));
                              bg = getRgba(lossColor, strength);
                            }
                          }
                          const isSelected = crossFilterDay === cell.day && crossFilterHour === cell.hour;

                          return (
                            <div
                              key={cell.hour}
                              onClick={() => {
                                if (cell.count === 0) return;
                                if (isSelected) {
                                  setCrossFilterDay(null);
                                  setCrossFilterHour(null);
                                } else {
                                  setCrossFilterDay(cell.day);
                                  setCrossFilterHour(cell.hour);
                                }
                              }}
                              title={`JST ${cell.hour}時 | 取引: ${cell.count}回\n平均損益: ${cell.expectancy.toFixed(0)} JPY`}
                              style={{
                                flex: 1,
                                height: "100%",
                                backgroundColor: bg,
                                border: isSelected ? "1.5px solid var(--primary-color)" : "1px solid rgba(255,255,255,0.03)",
                                cursor: cell.count > 0 ? "pointer" : "default",
                                borderRadius: "2px",
                                transition: "all 0.15s ease"
                              }}
                            />
                          );
                        })}
                      </div>
                    );
                  })}
                  {/* 時間軸の目盛り */}
                  <div style={{ display: "flex", gap: "3px", height: "12px", alignItems: "center", marginTop: "2px" }}>
                    <span style={{ width: "16px" }} />
                    {Array.from({ length: 24 }).map((_, h) => (
                      <span key={h} style={{ flex: 1, fontSize: "8px", textAlign: "center", color: "var(--on-surface-variant)" }}>
                        {h % 4 === 0 ? h : ""}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* ウィジェット②: 保有秒数期待値 */}
              <div className="pro-panel" style={{ padding: "10px", display: "flex", flexDirection: "column", minHeight: isCompact ? "180px" : undefined }}>
                <div className="pro-panel-header" style={{ marginBottom: "6px", flexShrink: 0 }}>
                  <h3 className="pro-panel-title" style={{ fontSize: "11px" }}>② 保有秒数別期待値 (pips/値幅期待値グラフ)</h3>
                </div>
                <div style={{ flex: 1, position: "relative", minHeight: "140px" }}>
                  <canvas ref={holdingChartRef} />
                </div>
              </div>

              {/* ウィジェット③: 決済品質散布図 */}
              <div className="pro-panel" style={{ padding: "10px", display: "flex", flexDirection: "column", minHeight: isCompact ? "180px" : undefined }}>
                <div className="pro-panel-header" style={{ marginBottom: "6px", flexShrink: 0 }}>
                  <h3 className="pro-panel-title" style={{ fontSize: "11px" }}>③ 決済品質散布図 (MAE / MFE 分布)</h3>
                </div>
                <div style={{ flex: 1, position: "relative", minHeight: "140px" }}>
                  <canvas ref={scatterChartRef} />
                </div>
              </div>

              {/* ウィジェット④: AI文脈・差異分析 */}
              <div className="pro-panel" style={{ padding: "10px", display: "flex", flexDirection: "column", minHeight: isCompact ? "140px" : undefined }}>
                <div className="pro-panel-header" style={{ marginBottom: "6px", flexShrink: 0 }}>
                  <h3 className="pro-panel-title" style={{ fontSize: "11px" }}>④ 勝ち/負け上位20% 行動差異分析</h3>
                </div>
                <div style={{
                  flex: 1,
                  overflowY: "auto",
                  fontSize: "11px",
                  lineHeight: "1.6",
                  color: "var(--on-surface-variant)",
                  padding: "8px",
                  backgroundColor: "rgba(255,255,255,0.01)",
                  borderRadius: "4px",
                  border: "1px solid var(--outline-variant)"
                }}>
                  <ul style={{ paddingLeft: "14px", margin: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
                    {contextAdvice.map((adv, idx) => (
                      <li key={idx} style={{ marginBottom: "4px" }}>
                        {adv}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* 領域5. 下部トレード明細 */}
            <div className="pro-panel" style={{
              height: isCompact ? "180px" : "220px",
              margin: "0 10px 10px 10px",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              flexShrink: 0
            }}>
              <div className="pro-panel-header" style={{ flexShrink: 0, padding: "8px 12px" }}>
                <h3 className="pro-panel-title" style={{ fontSize: "11px" }}>取引履歴明細 (ソート可能テーブル)</h3>
                <span className="pro-panel-meta" style={{ fontSize: "9px" }}>↑ / ↓: 取引選択 | Ctrl+E: エクスポート</span>
              </div>
              <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
                <table className="dashboard-table clickable-rows" style={{ fontSize: "11px", width: "100%", tableLayout: "auto" }}>
                  <thead style={{ position: "sticky", top: 0, backgroundColor: "var(--surface-container-high)", zIndex: 1 }}>
                    <tr style={{ whiteSpace: "nowrap" }}>
                      <th onClick={() => requestSort("ticket")} style={{ cursor: "pointer" }} title="Ticket Number [クリックでソート]">Ticket</th>
                      <th onClick={() => requestSort("type")} style={{ cursor: "pointer" }} title="Order Side (BUY/SELL) [クリックでソート]">Side</th>
                      <th onClick={() => requestSort("volume")} style={{ cursor: "pointer" }} title="Volume (Lots) [クリックでソート]">Lots</th>
                      <th onClick={() => requestSort("open_price")} style={{ cursor: "pointer" }} title="Entry Price (新規価格) [クリックでソート]">新規価格</th>
                      <th onClick={() => requestSort("close_price")} style={{ cursor: "pointer" }} title="Exit Price (決済価格) [クリックでソート]">決済価格</th>
                      <th onClick={() => requestSort("close_time_msc")} style={{ cursor: "pointer" }} title="Close Time (Server) (約定日時) [クリックでソート]">決済日時</th>
                      <th onClick={() => requestSort("durationSec")} style={{ cursor: "pointer" }} title="Holding Duration (ポジション保有時間) [クリックでソート]">保有</th>
                      <th onClick={() => requestSort("spread_entry")} style={{ cursor: "pointer" }} title="Spread at Entry (エントリー時スプレッド pips) [クリックでソート]">スプレッド</th>
                      <th onClick={() => requestSort("mfe_pips")} style={{ cursor: "pointer" }} title="Maximum Favorable Excursion (含み益最大値 pips) [クリックでソート]">MFE</th>
                      <th onClick={() => requestSort("mae_pips")} style={{ cursor: "pointer" }} title="Maximum Adverse Excursion (含み損最大値 pips) [クリックでソート]">MAE</th>
                      <th onClick={() => requestSort("volatility")} style={{ cursor: "pointer" }} title="Volatility (直近ボラティリティ pips) [クリックでソート]">ボラ</th>
                      <th onClick={() => requestSort("volume_60s")} style={{ cursor: "pointer" }} title="Volume 60s (直近60秒出来高) [クリックでソート]">出来高</th>
                      <th onClick={() => requestSort("entryInterval")} style={{ cursor: "pointer" }} title="Entry Interval (前回決済からの経過時間) [クリックでソート]">間隔</th>
                      <th onClick={() => requestSort("profit")} style={{ cursor: "pointer" }} title="Profit / Loss (損益 JPY) [クリックでソート]">損益</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedHistory.map((h) => {
                      const isSelected = h.ticket === selectedTicket;
                      const formattedProfit = h.profit.toLocaleString();

                      return (
                        <tr
                          key={h.ticket}
                          onClick={() => handleSelectTrade(h.ticket)}
                          style={{
                            backgroundColor: isSelected ? "rgba(var(--primary-rgb), 0.12)" : "",
                            borderLeft: isSelected ? "3px solid var(--primary-color)" : "",
                            cursor: "pointer"
                          }}
                        >
                          <td className="font-data">{h.ticket}</td>
                          <td>
                            <span className={`type-badge ${h.type.toLowerCase()}`}>{h.type}</span>
                          </td>
                          <td className="font-data">{h.volume.toFixed(2)}</td>
                          <td className="font-data">{formatRate(h.open_price, h.symbol)}</td>
                          <td className="font-data">{formatRate(h.close_price, h.symbol)}</td>
                          <td className="font-data" style={{ fontSize: "10px" }}>{h.close_time}</td>
                          <td className="font-data" style={{ fontSize: "10px" }}>{formatHoldingTime(h.durationSec * 1000)}</td>
                          <td className="font-data">{h.spread_entry.toFixed(1)}</td>
                          <td className="font-data" style={{ color: "var(--profit-color)" }}>{h.mfe_pips.toFixed(1)}</td>
                          <td className="font-data" style={{ color: "var(--loss-color)" }}>{h.mae_pips.toFixed(1)}</td>
                          <td className="font-data">{h.volatility.toFixed(1)}</td>
                          <td className="font-data">{h.volume_60s}</td>
                          <td className="font-data" style={{ color: h.entryInterval < 15 ? "var(--status-danger)" : "" }}>
                            {h.entryInterval > 0 ? `${h.entryInterval.toFixed(0)}s` : "-"}
                          </td>
                          <td className="font-data" style={{
                            fontWeight: "bold",
                            color: h.profit > 0 ? "var(--profit-color)" : "var(--loss-color)"
                          }}>
                            {h.profit > 0 ? `+${formattedProfit}` : formattedProfit}
                          </td>
                        </tr>
                      );
                    })}
                    {sortedHistory.length === 0 && (
                      <tr>
                        <td colSpan={14} style={{ textAlign: "center", padding: "24px 0", color: "var(--on-surface-variant)" }}>
                          フィルタ条件に一致する取引データはありません。
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 領域4. 右インスペクタ (Single Trade Deep-Dive) */}
        {(!isCompact || compactTab === "inspector") && (
          <div className="col-inspector" style={{
            width: isCompact ? "100%" : "280px",
            backgroundColor: "var(--surface-container)",
            borderLeft: isCompact ? "none" : "1px solid var(--outline-variant)",
            padding: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            overflowY: "auto",
            flexShrink: 0
          }}>
            {isCompact && (
              <button
                className="pro-btn"
                style={{ padding: "4px 8px", fontSize: "10px", alignSelf: "flex-start", marginBottom: "4px" }}
                onClick={() => setCompactTab("dashboard")}
              >
                ← 分析＆明細一覧へ戻る
              </button>
            )}
            <h4 style={{ fontSize: "11px", fontWeight: "bold", margin: 0, textTransform: "uppercase", color: "var(--on-surface-variant)" }}>右インスペクタ (詳細分析)</h4>
          
          {selectedTrade ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", flex: 1 }}>
              {/* チケット & Side */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "6px", borderBottom: "1px solid var(--outline-variant)" }}>
                <span style={{ fontSize: "12px", fontWeight: "bold" }}>Ticket #{selectedTrade.ticket}</span>
                <span className={`type-badge ${selectedTrade.type.toLowerCase()}`} style={{ fontSize: "10px" }}>{selectedTrade.type}</span>
              </div>



              {/* 約定価格時系列 */}
              <div className="stat-card" style={{ padding: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "9px", color: "var(--on-surface-variant)" }}>約定イベント時系列</span>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "10px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Entry Price:</span>
                    <strong className="font-data">{formatRate(selectedTrade.open_price, selectedTrade.symbol)}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Entry Time (JST):</span>
                    <span className="font-data" style={{ fontSize: "9px" }}>{convertServerToJstStr(selectedTrade.open_time)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px", paddingTop: "4px", borderTop: "1px dashed rgba(255,255,255,0.05)" }}>
                    <span>Exit Price:</span>
                    <strong className="font-data">{formatRate(selectedTrade.close_price, selectedTrade.symbol)}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Exit Time (JST):</span>
                    <span className="font-data" style={{ fontSize: "9px" }}>{convertServerToJstStr(selectedTrade.close_time)}</span>
                  </div>
                </div>
              </div>

              {/* 環境データ */}
              <div className="stat-card" style={{ padding: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "9px", color: "var(--on-surface-variant)" }}>環境品質データ</span>
                <div style={{ display: "flex", flexDirection: "column", gap: "5px", fontSize: "10px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>スプレッド:</span>
                    <span className="font-data">{selectedTrade.spread_entry.toFixed(1)} pips</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>直近出来高 (60s):</span>
                    <span className="font-data">{selectedTrade.volume_60s} ティック</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>直近ボラティリティ:</span>
                    <span className="font-data">{selectedTrade.volatility.toFixed(1)} pips</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>連続発注間隔:</span>
                    <span className="font-data" style={{ color: selectedTrade.entryInterval < 15 ? "var(--status-danger)" : "" }}>
                      {selectedTrade.entryInterval > 0 ? `${selectedTrade.entryInterval.toFixed(0)} 秒` : "初回取引"}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>経済指標近接 (5分):</span>
                    <span style={{
                      padding: "1px 6px",
                      borderRadius: "3px",
                      fontSize: "9px",
                      backgroundColor: selectedTrade.isNearNews ? "rgba(239, 68, 68, 0.15)" : "rgba(255,255,255,0.03)",
                      color: selectedTrade.isNearNews ? "var(--status-danger)" : "var(--on-surface-variant)"
                    }}>
                      {selectedTrade.isNearNews ? "YES" : "NO"}
                    </span>
                  </div>
                  {selectedTrade.isNearNews && (
                    <div style={{ fontSize: "8px", color: "var(--status-danger)", backgroundColor: "rgba(239, 68, 68, 0.05)", padding: "4px", borderRadius: "3px" }}>
                      近接イベント: {selectedTrade.nearNewsEvent}
                    </div>
                  )}
                </div>
              </div>

              {/* MFE / MAE */}
              <div className="stat-card" style={{ padding: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "9px", color: "var(--on-surface-variant)" }}>逆行・順行変動</span>
                <div style={{ display: "flex", flexDirection: "column", gap: "5px", fontSize: "10px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>最大順行幅 (MFE):</span>
                    <strong className="font-data" style={{ color: "var(--profit-color)" }}>+{selectedTrade.mfe_pips.toFixed(1)} pips</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>最大逆行幅 (MAE):</span>
                    <strong className="font-data" style={{ color: "var(--loss-color)" }}>-{selectedTrade.mae_pips.toFixed(1)} pips</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>最終取引利益:</span>
                    <span className="font-data" style={{
                      fontWeight: "bold",
                      color: selectedTrade.profit > 0 ? "var(--profit-color)" : "var(--loss-color)"
                    }}>{selectedTrade.profit.toLocaleString()} JPY</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", color: "var(--on-surface-variant)", textAlign: "center" }}>
              明細テーブルから取引を選択すると、詳細分析がここに表示されます。
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
};
