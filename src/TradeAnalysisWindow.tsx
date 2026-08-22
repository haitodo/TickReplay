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
  LineController,
  Filler
} from 'chart.js';
import {
  TradeRecord,
  SavedTradeDataset,
  AnalysisFilterState
} from "./domain/tradeAnalysis/types";
import {
  calculateTradeStats,
  calculateHoldingDistribution,
  calculateTimeHeatmap,
  calculateEquityCurve,
  HOLDING_BUCKET_LABELS,
  getHoldingBucketIndex
} from "./domain/tradeAnalysis/tradeMetrics";
import { CsvImportModal } from "./components/TradeAnalysis/CsvImportModal";
import { formatRate } from "./utils/rateUtils";

// Chart.js コンポーネント登録
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
  LineController,
  Filler
);

interface ThemePreset {
  id: string;
  nameJa: string;
  nameEn: string;
  color: string;
  rgb: string;
  hover: string;
  onPrimary: string;
  light: string;
  border: string;
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

export const TradeAnalysisWindowContent: React.FC = () => {
  // --- データソース管理 ---
  const [activeSource, setActiveSource] = useState<"replay" | "imported">("replay");
  const [replayHistory, setReplayHistory] = useState<any[]>([]);
  const [savedDatasets, setSavedDatasets] = useState<SavedTradeDataset[]>(() => {
    try {
      const stored = localStorage.getItem("saved-trade-datasets");
      return stored ? JSON.parse(stored) : [];
    } catch (_e) {
      return [];
    }
  });
  const [activeDatasetId, setActiveDatasetId] = useState<string | null>(() => {
    try {
      const stored = localStorage.getItem("saved-trade-datasets");
      const list = stored ? JSON.parse(stored) : [];
      return list.length > 0 ? list[0].id : null;
    } catch (_e) {
      return null;
    }
  });

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<string | number | null>(null);
  const [activeMainTab, setActiveMainTab] = useState<"overview" | "distribution" | "ledger">("overview");

  // フィルター状態
  const [filterPeriod, setFilterPeriod] = useState<AnalysisFilterState["period"]>("all");
  const [filterCustomStart, setFilterCustomStart] = useState("");
  const [filterCustomEnd, setFilterCustomEnd] = useState("");
  const [filterSymbol, setFilterSymbol] = useState("all");
  const [filterSide, setFilterSide] = useState<"all" | "BUY" | "SELL">("all");
  const [filterOutcome, setFilterOutcome] = useState<"all" | "win" | "loss">("all");
  const [filterSearchQuery, setFilterSearchQuery] = useState("");
  const [crossFilterHoldingBucket, setCrossFilterHoldingBucket] = useState<number | null>(null);
  const [crossFilterDay, setCrossFilterDay] = useState<number | null>(null);
  const [crossFilterHour, setCrossFilterHour] = useState<number | null>(null);

  // ソート状態
  const [sortKey, setSortKey] = useState<string>("close_time_msc");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  // テーマ・配色設定
  const [themeId, setThemeId] = useState(() => localStorage.getItem("accent-theme") || "mint");
  const [themeMode, setThemeMode] = useState<"dark" | "light">(() => (localStorage.getItem("theme-mode") as "dark" | "light") || "dark");
  const [plStyle, setPlStyle] = useState(() => localStorage.getItem("pl-style") || "red-blue");

  // MT5 リプレイ履歴の初期ロード & リアルタイム同期
  useEffect(() => {
    invoke<string>("get_last_status").then((last) => {
      if (last && last.trim() !== "") {
        try {
          const data = JSON.parse(last);
          if (data.history) {
            setReplayHistory(data.history);
          }
        } catch (e) {
          console.error("Failed to parse history from status", e);
        }
      }
    });

    let lastHistoryStr = "";
    const unlisten = listen<string>("mt5-status", (event) => {
      try {
        const data = JSON.parse(event.payload);
        if (data.history) {
          const historyStr = JSON.stringify(data.history);
          if (historyStr !== lastHistoryStr) {
            lastHistoryStr = historyStr;
            setReplayHistory(data.history);
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

  // localStorage 変更検知 (テーマ連動)
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "accent-theme" && e.newValue) setThemeId(e.newValue);
      if (e.key === "theme-mode" && e.newValue) setThemeMode(e.newValue as "dark" | "light");
      if (e.key === "pl-style" && e.newValue) setPlStyle(e.newValue);
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  // テーマCSS変数の適用
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeMode);
    const preset = THEME_PRESETS.find(p => p.id === themeId) || THEME_PRESETS[0];
    document.documentElement.style.setProperty("--primary-color", preset.color);
    document.documentElement.style.setProperty("--primary-rgb", preset.rgb);
    document.documentElement.style.setProperty("--primary-hover", preset.hover);
    document.documentElement.style.setProperty("--on-primary", preset.onPrimary);
    document.documentElement.style.setProperty("--primary-light", preset.light);
    document.documentElement.style.setProperty("--primary-border", preset.border);
  }, [themeId, themeMode]);

  // アクティブな生データセットの選択
  const rawTrades: TradeRecord[] = useMemo(() => {
    if (activeSource === "replay") {
      // Replay履歴の正規化
      return replayHistory.map((h: any, idx: number) => {
        const openMsc = h.open_time_msc || (h.open_time ? Date.parse(h.open_time.replace(/\./g, "-")) : 0);
        const closeMsc = h.close_time_msc || (h.close_time ? Date.parse(h.close_time.replace(/\./g, "-")) : 0);
        const durationSec = (closeMsc && openMsc && closeMsc >= openMsc) ? Math.floor((closeMsc - openMsc) / 1000) : 0;
        
        const d = new Date(openMsc || Date.now());
        const hourJst = d.getHours();
        const dayJst = d.getDay();

        return {
          id: `replay_${h.ticket || idx}`,
          ticket: h.ticket || idx + 1,
          source: "replay" as const,
          sourceName: "Live Replay",
          symbol: h.symbol || "UNKNOWN",
          type: (h.type || "BUY").toUpperCase() as "BUY" | "SELL",
          lots: h.lots || h.volume || 0.1,
          open_time: h.open_time || "",
          open_time_msc: openMsc,
          open_price: h.open_price || 0,
          close_time: h.close_time || "",
          close_time_msc: closeMsc,
          close_price: h.close_price || 0,
          profit: h.profit || 0,
          pips: typeof h.pips === "number" ? h.pips : 0,
          durationSec,
          hourJst,
          dayJst,
          mfe_pips: h.mfe_pips || 0,
          mae_pips: h.mae_pips || 0,
          comment: h.comment || undefined
        };
      });
    } else {
      const activeDataset = savedDatasets.find(d => d.id === activeDatasetId);
      return activeDataset ? activeDataset.trades : [];
    }
  }, [activeSource, replayHistory, savedDatasets, activeDatasetId]);

  // 利用可能な通貨ペア一覧
  const availableSymbols = useMemo(() => {
    const set = new Set<string>();
    rawTrades.forEach(t => {
      if (t.symbol) set.add(t.symbol);
    });
    return Array.from(set).sort();
  }, [rawTrades]);

  // フィルター適用後の取引リスト
  const filteredTrades = useMemo(() => {
    return rawTrades.filter(t => {
      // 1. 通貨ペア
      if (filterSymbol !== "all" && t.symbol !== filterSymbol) return false;

      // 2. 売買区分
      if (filterSide !== "all" && t.type !== filterSide) return false;

      // 3. 勝敗
      if (filterOutcome === "win" && t.profit <= 0) return false;
      if (filterOutcome === "loss" && t.profit > 0) return false;

      // 4. 期間フィルター
      if (filterPeriod === "custom") {
        if (filterCustomStart) {
          const startMsc = Date.parse(filterCustomStart.replace(/\//g, "-"));
          if (!isNaN(startMsc) && t.close_time_msc < startMsc) return false;
        }
        if (filterCustomEnd) {
          const endMsc = Date.parse(filterCustomEnd.replace(/\//g, "-"));
          if (!isNaN(endMsc) && t.close_time_msc > endMsc) return false;
        }
      }

      // 5. クロスフィルター (保有時間)
      if (crossFilterHoldingBucket !== null) {
        const bucket = getHoldingBucketIndex(t.durationSec || 0);
        if (bucket !== crossFilterHoldingBucket) return false;
      }

      // 6. クロスフィルター (曜日・時間)
      if (crossFilterDay !== null && t.dayJst !== crossFilterDay) return false;
      if (crossFilterHour !== null && t.hourJst !== crossFilterHour) return false;

      // 7. 検索クエリ
      if (filterSearchQuery.trim()) {
        const q = filterSearchQuery.toLowerCase();
        const matchTicket = String(t.ticket).toLowerCase().includes(q);
        const matchSymbol = t.symbol.toLowerCase().includes(q);
        const matchComment = (t.comment || "").toLowerCase().includes(q);
        if (!matchTicket && !matchSymbol && !matchComment) return false;
      }

      return true;
    });
  }, [rawTrades, filterSymbol, filterSide, filterOutcome, filterPeriod, filterCustomStart, filterCustomEnd, crossFilterHoldingBucket, crossFilterDay, crossFilterHour, filterSearchQuery]);

  // 主要パフォーマンス統計
  const stats = useMemo(() => calculateTradeStats(filteredTrades), [filteredTrades]);

  // 保有時間バケット集計
  const holdingDistribution = useMemo(() => calculateHoldingDistribution(filteredTrades), [filteredTrades]);

  // 時間帯 × 曜日ヒートマップ
  const timeHeatmap = useMemo(() => calculateTimeHeatmap(filteredTrades), [filteredTrades]);

  // 資産曲線データ
  const equityPoints = useMemo(() => calculateEquityCurve(filteredTrades), [filteredTrades]);

  // ソートされた取引リスト
  const sortedTrades = useMemo(() => {
    const list = [...filteredTrades];
    list.sort((a: any, b: any) => {
      let aVal = a[sortKey] ?? 0;
      let bVal = b[sortKey] ?? 0;
      if (typeof aVal === "string") {
        return sortDirection === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
    });
    return list;
  }, [filteredTrades, sortKey, sortDirection]);

  const requestSort = (key: string) => {
    if (sortKey === key) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection("desc");
    }
  };

  // 選択されたトレード詳細
  const selectedTrade = useMemo(() => {
    if (selectedTicket === null) return null;
    return filteredTrades.find(t => t.ticket === selectedTicket) || null;
  }, [selectedTicket, filteredTrades]);

  // CSVインポート成功ハンドラー
  const handleImportSuccess = (dataset: SavedTradeDataset) => {
    const updated = [dataset, ...savedDatasets.filter(d => d.id !== dataset.id)];
    setSavedDatasets(updated);
    setActiveDatasetId(dataset.id);
    setActiveSource("imported");
    localStorage.setItem("saved-trade-datasets", JSON.stringify(updated));
  };

  // データセット削除
  const handleDeleteDataset = (id: string) => {
    if (!window.confirm("このインポートデータセットを削除しますか？")) return;
    const updated = savedDatasets.filter(d => d.id !== id);
    setSavedDatasets(updated);
    localStorage.setItem("saved-trade-datasets", JSON.stringify(updated));
    if (activeDatasetId === id) {
      setActiveDatasetId(updated.length > 0 ? updated[0].id : null);
    }
  };

  // CSVエクスポート
  const handleExportCsv = () => {
    if (filteredTrades.length === 0) return;
    let csvContent = "\uFEFFTicket,Source,Symbol,Type,Lots,OpenTime,OpenPrice,CloseTime,ClosePrice,Profit,Pips,DurationSec\n";
    filteredTrades.forEach(t => {
      const row = [
        t.ticket,
        t.source,
        t.symbol,
        t.type,
        t.lots,
        t.open_time,
        t.open_price,
        t.close_time,
        t.close_price,
        t.profit,
        t.pips,
        t.durationSec
      ];
      csvContent += row.join(",") + "\n";
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `trade_analysis_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // 配色ヘルパー
  const profitColor = plStyle === "red-blue" ? "#ef4444" : "#10b981";
  const lossColor = plStyle === "red-blue" ? "#3b82f6" : "#ef4444";
  const gridColor = themeMode === "dark" ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.06)";
  const labelColor = themeMode === "dark" ? "#94a3b8" : "#64748b";

  // --- Chart.js マウント用 Ref ---
  const equityChartRef = useRef<HTMLCanvasElement | null>(null);
  const equityChartInst = useRef<Chart | null>(null);

  const holdingChartRef = useRef<HTMLCanvasElement | null>(null);
  const holdingChartInst = useRef<Chart | null>(null);

  // 1. 資産推移曲線グラフ
  useEffect(() => {
    if (!equityChartRef.current || equityPoints.length === 0) return;
    if (equityChartInst.current) equityChartInst.current.destroy();

    const ctx = equityChartRef.current.getContext("2d");
    if (!ctx) return;

    const labels = equityPoints.map(p => p.tradeNum === 0 ? "Start" : `#${p.tradeNum}`);
    const dataProfit = equityPoints.map(p => p.cumProfit);
    const dataDrawdown = equityPoints.map(p => -p.drawdown);

    equityChartInst.current = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "累積実現損益 (JPY)",
            data: dataProfit,
            borderColor: profitColor,
            backgroundColor: "rgba(var(--primary-rgb), 0.1)",
            borderWidth: 2,
            pointRadius: equityPoints.length > 50 ? 0 : 3,
            pointHoverRadius: 6,
            fill: true,
            tension: 0.1
          },
          {
            label: "ドローダウン (JPY)",
            data: dataDrawdown,
            borderColor: lossColor,
            backgroundColor: "rgba(239, 68, 68, 0.08)",
            borderWidth: 1.5,
            pointRadius: 0,
            fill: true,
            tension: 0.1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            display: true,
            labels: { color: labelColor, font: { size: 10 } }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ¥${Number(ctx.raw).toLocaleString()}`
            }
          }
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: labelColor, maxTicksLimit: 12 } },
          y: { grid: { color: gridColor }, ticks: { color: labelColor } }
        }
      }
    });

    return () => {
      if (equityChartInst.current) equityChartInst.current.destroy();
    };
  }, [equityPoints, profitColor, lossColor, gridColor, labelColor]);

  // 2. 保有時間分布グラフ
  useEffect(() => {
    if (!holdingChartRef.current || holdingDistribution.length === 0) return;
    if (holdingChartInst.current) holdingChartInst.current.destroy();

    const ctx = holdingChartRef.current.getContext("2d");
    if (!ctx) return;

    const labels = holdingDistribution.map(b => b.label);
    const dataProfit = holdingDistribution.map(b => b.profit);
    const bgColors = dataProfit.map(p => p >= 0 ? profitColor : lossColor);

    holdingChartInst.current = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "損益合計 (JPY)",
          data: dataProfit,
          backgroundColor: bgColors,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (_e, elements) => {
          if (elements.length > 0) {
            const idx = elements[0].index;
            setCrossFilterHoldingBucket(prev => prev === idx ? null : idx);
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` 損益: ¥${Number(ctx.raw).toLocaleString()} (件数: ${holdingDistribution[ctx.dataIndex].count}回)`
            }
          }
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: labelColor } },
          y: { grid: { color: gridColor }, ticks: { color: labelColor } }
        }
      }
    });

    return () => {
      if (holdingChartInst.current) holdingChartInst.current.destroy();
    };
  }, [holdingDistribution, profitColor, lossColor, gridColor, labelColor]);

  const dayNames = ["日", "月", "火", "水", "木", "金", "土"];

  return (
    <div className="trade-analysis-app-container">
      {/* 1. Header Bar with Source Switcher */}
      <header className="trade-analysis-header glass-panel">
        <div className="trade-header-left">
          <span className="material-symbols-outlined icon-accent text-[22px]">analytics</span>
          <div>
            <h1 className="trade-header-title">Trade Performance Analytics</h1>
            <span className="trade-header-subtitle">統合トレード分析 & 統計インスペクター</span>
          </div>
        </div>

        {/* Source Selector Pills */}
        <div className="trade-source-selector">
          <button
            className={`source-pill-btn ${activeSource === "replay" ? "active" : ""}`}
            onClick={() => setActiveSource("replay")}
          >
            <span className="material-symbols-outlined text-[14px]">sports_esports</span>
            <span>仮想リプレイ ({replayHistory.length})</span>
          </button>
          <button
            className={`source-pill-btn ${activeSource === "imported" ? "active" : ""}`}
            onClick={() => setActiveSource("imported")}
          >
            <span className="material-symbols-outlined text-[14px]">folder_open</span>
            <span>インポート履歴 ({savedDatasets.length})</span>
          </button>
        </div>

        {/* Action Controls */}
        <div className="trade-header-right">
          {activeSource === "imported" && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              {savedDatasets.length > 0 && (
                <select
                  className="pro-input dataset-select"
                  value={activeDatasetId || ""}
                  onChange={(e) => setActiveDatasetId(e.target.value)}
                >
                  {savedDatasets.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.tradeCount}件)
                    </option>
                  ))}
                </select>
              )}

              {activeDatasetId && (
                <button
                  className="pro-btn-square danger"
                  onClick={() => handleDeleteDataset(activeDatasetId)}
                  title="選択中のデータセットを削除"
                >
                  <span className="material-symbols-outlined text-[15px]">delete</span>
                </button>
              )}
            </div>
          )}

          <button
            className="pro-btn primary pro-glow"
            style={{ padding: "4px 10px", fontSize: "11px", gap: "4px" }}
            onClick={() => setIsImportModalOpen(true)}
            title="FX業者の取引履歴CSVをインポート"
          >
            <span className="material-symbols-outlined text-[15px]">upload_file</span>
            <span>CSVインポート</span>
          </button>

          <button
            className="pro-btn"
            style={{ padding: "4px 8px", fontSize: "11px" }}
            onClick={handleExportCsv}
            disabled={filteredTrades.length === 0}
            title="分析結果をCSV出力"
          >
            <span className="material-symbols-outlined text-[15px]">download</span>
          </button>
        </div>
      </header>

      {/* 2. Main KPI Ticker Cards */}
      <section className="trade-kpi-grid">
        <div className="trade-kpi-card">
          <span className="kpi-label">実現損益合計</span>
          <div className={`kpi-value ${stats.totalProfit >= 0 ? "text-profit" : "text-loss"}`}>
            {stats.totalProfit >= 0 ? `+¥${stats.totalProfit.toLocaleString()}` : `-¥${Math.abs(stats.totalProfit).toLocaleString()}`}
          </div>
          <span className="kpi-sub">
            獲得: {stats.totalPips >= 0 ? `+${stats.totalPips}p` : `${stats.totalPips}p`}
          </span>
        </div>

        <div className="trade-kpi-card">
          <span className="kpi-label">勝率 / PF</span>
          <div className="kpi-value text-accent font-data">
            {stats.winRate}% <span className="kpi-sub-highlight">PF {stats.profitFactor}</span>
          </div>
          <span className="kpi-sub">
            {stats.wins}勝 {stats.losses}敗 (全{stats.totalTrades}回)
          </span>
        </div>

        <div className="trade-kpi-card">
          <span className="kpi-label">期待値 (1回あたり)</span>
          <div className={`kpi-value ${stats.expectancy >= 0 ? "text-profit" : "text-loss"}`}>
            {stats.expectancy >= 0 ? `+¥${stats.expectancy.toLocaleString()}` : `-¥${Math.abs(stats.expectancy).toLocaleString()}`}
          </div>
          <span className="kpi-sub">
            {stats.expectancyPips >= 0 ? `+${stats.expectancyPips}p` : `${stats.expectancyPips}p`} / トレード
          </span>
        </div>

        <div className="trade-kpi-card">
          <span className="kpi-label">最大ドローダウン</span>
          <div className="kpi-value text-loss font-data">
            -¥{stats.maxDrawdown.toLocaleString()}
          </div>
          <span className="kpi-sub">
            最大連敗: {stats.maxConsecutiveLosses}回 (連勝: {stats.maxConsecutiveWins}回)
          </span>
        </div>

        <div className="trade-kpi-card">
          <span className="kpi-label">平均損益 / RR比率</span>
          <div className="kpi-value font-data" style={{ color: "var(--on-surface)" }}>
            1 : {stats.riskRewardRatio}
          </div>
          <span className="kpi-sub">
            利: +¥{stats.avgWin.toLocaleString()} / 損: -¥{stats.avgLoss.toLocaleString()}
          </span>
        </div>

        <div className="trade-kpi-card">
          <span className="kpi-label">買い / 売り損益</span>
          <div className="kpi-value font-data text-[13px]" style={{ display: "flex", gap: "6px" }}>
            <span className={stats.longProfit >= 0 ? "text-profit" : "text-loss"}>
              L: ¥{stats.longProfit.toLocaleString()}
            </span>
            <span style={{ opacity: 0.4 }}>/</span>
            <span className={stats.shortProfit >= 0 ? "text-profit" : "text-loss"}>
              S: ¥{stats.shortProfit.toLocaleString()}
            </span>
          </div>
          <span className="kpi-sub">
            L: {stats.longTrades}回 / S: {stats.shortTrades}回
          </span>
        </div>
      </section>

      {/* 3. Navigation Filter Toolbar */}
      <div className="trade-filter-bar glass-panel">
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", flex: 1 }}>
          {/* Main Tab Switcher */}
          <div className="trade-tab-group">
            <button
              className={`trade-tab-btn ${activeMainTab === "overview" ? "active" : ""}`}
              onClick={() => setActiveMainTab("overview")}
            >
              <span className="material-symbols-outlined text-[15px]">show_chart</span>
              <span>総合チャート</span>
            </button>
            <button
              className={`trade-tab-btn ${activeMainTab === "distribution" ? "active" : ""}`}
              onClick={() => setActiveMainTab("distribution")}
            >
              <span className="material-symbols-outlined text-[15px]">grid_view</span>
              <span>時間・曜日分布</span>
            </button>
            <button
              className={`trade-tab-btn ${activeMainTab === "ledger" ? "active" : ""}`}
              onClick={() => setActiveMainTab("ledger")}
            >
              <span className="material-symbols-outlined text-[15px]">table_rows</span>
              <span>取引履歴 ({filteredTrades.length})</span>
            </button>
          </div>

          <div style={{ width: "1px", height: "16px", backgroundColor: "var(--outline-variant)", margin: "0 4px" }} />

          {/* Period Filter */}
          <select
            className="pro-input"
            style={{ width: "95px", height: "26px", fontSize: "11px", padding: "0 6px" }}
            value={filterPeriod}
            onChange={(e) => setFilterPeriod(e.target.value as any)}
          >
            <option value="all">全期間</option>
            <option value="today">本日</option>
            <option value="week">直近7日</option>
            <option value="month">直近30日</option>
            <option value="custom">カスタム指定</option>
          </select>

          {filterPeriod === "custom" && (
            <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
              <input
                type="date"
                className="pro-input"
                style={{ height: "26px", fontSize: "10px", padding: "0 4px" }}
                value={filterCustomStart}
                onChange={(e) => setFilterCustomStart(e.target.value)}
              />
              <span style={{ fontSize: "10px", opacity: 0.6 }}>〜</span>
              <input
                type="date"
                className="pro-input"
                style={{ height: "26px", fontSize: "10px", padding: "0 4px" }}
                value={filterCustomEnd}
                onChange={(e) => setFilterCustomEnd(e.target.value)}
              />
            </div>
          )}

          {/* Currency Pair Filter */}
          <select
            className="pro-input"
            style={{ width: "110px", height: "26px", fontSize: "11px", padding: "0 6px" }}
            value={filterSymbol}
            onChange={(e) => setFilterSymbol(e.target.value)}
          >
            <option value="all">全通貨ペア</option>
            {availableSymbols.map(sym => (
              <option key={sym} value={sym}>{sym}</option>
            ))}
          </select>

          {/* Side Filter */}
          <select
            className="pro-input"
            style={{ width: "85px", height: "26px", fontSize: "11px", padding: "0 6px" }}
            value={filterSide}
            onChange={(e) => setFilterSide(e.target.value as any)}
          >
            <option value="all">売買全種</option>
            <option value="BUY">BUYのみ</option>
            <option value="SELL">SELLのみ</option>
          </select>

          {/* Outcome Filter */}
          <select
            className="pro-input"
            style={{ width: "85px", height: "26px", fontSize: "11px", padding: "0 6px" }}
            value={filterOutcome}
            onChange={(e) => setFilterOutcome(e.target.value as any)}
          >
            <option value="all">全勝敗</option>
            <option value="win">利益のみ</option>
            <option value="loss">損失のみ</option>
          </select>

          {/* Search Query */}
          <div style={{ position: "relative" }}>
            <input
              type="text"
              className="pro-input"
              style={{ width: "140px", height: "26px", fontSize: "11px", padding: "0 6px 0 24px" }}
              placeholder="Ticket / メモ検索..."
              value={filterSearchQuery}
              onChange={(e) => setFilterSearchQuery(e.target.value)}
            />
            <span
              className="material-symbols-outlined"
              style={{ position: "absolute", left: "6px", top: "5px", fontSize: "14px", color: "var(--on-surface-variant)" }}
            >
              search
            </span>
          </div>

          {/* Reset Filters */}
          {(filterSymbol !== "all" || filterSide !== "all" || filterOutcome !== "all" || filterSearchQuery || crossFilterHoldingBucket !== null || crossFilterDay !== null || crossFilterHour !== null) && (
            <button
              className="pro-btn"
              style={{ height: "26px", padding: "0 8px", fontSize: "10px", gap: "3px" }}
              onClick={() => {
                setFilterSymbol("all");
                setFilterSide("all");
                setFilterOutcome("all");
                setFilterSearchQuery("");
                setCrossFilterHoldingBucket(null);
                setCrossFilterDay(null);
                setCrossFilterHour(null);
              }}
              title="絞り込みを解除"
            >
              <span className="material-symbols-outlined text-[13px]">filter_alt_off</span>
              <span>リセット</span>
            </button>
          )}
        </div>
      </div>

      {/* 4. Main Body Content Area */}
      <main className="trade-analysis-main-content">
        {filteredTrades.length === 0 ? (
          <div className="trade-empty-state glass-panel">
            <span className="material-symbols-outlined text-[48px] icon-accent">
              query_stats
            </span>
            <h3 style={{ margin: "8px 0 4px", fontSize: "16px", color: "var(--on-surface)" }}>
              {rawTrades.length === 0 ? "取引履歴データがありません" : "絞り込み条件に一致する取引がありません"}
            </h3>
            <p style={{ margin: "0 0 16px", fontSize: "12px", color: "var(--on-surface-variant)", maxWidth: "400px", textAlign: "center" }}>
              {rawTrades.length === 0
                ? "MT5リプレイでトレードを実行するか、お使いのFX業者（GMO、DMM、SBI、MT4/5等）から出力した取引CSVをインポートしてください。"
                : "フィルター設定を調整するか、「リセット」ボタンをクリックして全件表示に戻してください。"}
            </p>
            {rawTrades.length === 0 && (
              <button
                className="pro-btn primary pro-glow"
                style={{ padding: "8px 16px", gap: "6px" }}
                onClick={() => setIsImportModalOpen(true)}
              >
                <span className="material-symbols-outlined text-[18px]">upload_file</span>
                <span>CSVファイルをインポート</span>
              </button>
            )}
          </div>
        ) : (
          <>
            {/* TAB 1: 総合チャート */}
            {activeMainTab === "overview" && (
              <div className="trade-overview-grid">
                {/* 累積損益・ドローダウンチャート */}
                <div className="pro-panel chart-panel" style={{ minHeight: "320px", flex: 2 }}>
                  <div className="pro-panel-header">
                    <h3 className="pro-panel-title">
                      <span className="material-symbols-outlined icon-accent">show_chart</span>
                      <span>累積損益 & ドローダウン推移曲線</span>
                    </h3>
                    <span className="font-data text-[11px]" style={{ color: "var(--on-surface-variant)" }}>
                      全 {equityPoints.length - 1} 取引ポイント
                    </span>
                  </div>
                  <div className="pro-panel-body" style={{ position: "relative", height: "260px" }}>
                    <canvas ref={equityChartRef} />
                  </div>
                </div>

                {/* 保有時間分布チャート */}
                <div className="pro-panel chart-panel" style={{ minHeight: "320px", flex: 1 }}>
                  <div className="pro-panel-header">
                    <h3 className="pro-panel-title">
                      <span className="material-symbols-outlined icon-accent">timer</span>
                      <span>保有時間別 損益期待値</span>
                    </h3>
                    {crossFilterHoldingBucket !== null && (
                      <span className="preview-stat-pill">
                        {HOLDING_BUCKET_LABELS[crossFilterHoldingBucket]} 絞込中
                      </span>
                    )}
                  </div>
                  <div className="pro-panel-body" style={{ position: "relative", height: "260px" }}>
                    <canvas ref={holdingChartRef} />
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: 時間帯・曜日ヒートマップ */}
            {activeMainTab === "distribution" && (
              <div className="trade-distribution-view">
                <div className="pro-panel" style={{ width: "100%" }}>
                  <div className="pro-panel-header">
                    <h3 className="pro-panel-title">
                      <span className="material-symbols-outlined icon-accent">calendar_view_week</span>
                      <span>曜日 × 時間帯別 (JST) パフォーマンス・マトリクス</span>
                    </h3>
                    <span className="text-[11px]" style={{ color: "var(--on-surface-variant)" }}>
                      セルをクリックして該当時間帯のトレードを絞り込み
                    </span>
                  </div>
                  <div className="pro-panel-body" style={{ overflowX: "auto" }}>
                    <div className="heatmap-grid-table">
                      <div className="heatmap-header-row">
                        <div className="heatmap-corner-cell">曜日 / 時</div>
                        {Array.from({ length: 24 }).map((_, h) => (
                          <div key={h} className="heatmap-hour-th">{h}時</div>
                        ))}
                      </div>

                      {dayNames.map((dName, dIdx) => (
                        <div key={dIdx} className="heatmap-row">
                          <div className="heatmap-day-td">{dName}</div>
                          {Array.from({ length: 24 }).map((_, h) => {
                            const cell = timeHeatmap[dIdx][h];
                            const isSelected = crossFilterDay === dIdx && crossFilterHour === h;
                            let cellBg = "rgba(255, 255, 255, 0.02)";
                            if (cell.count > 0) {
                              cellBg = cell.profit >= 0
                                ? `rgba(16, 185, 129, ${Math.min(0.8, 0.15 + (cell.count * 0.1))})`
                                : `rgba(239, 68, 68, ${Math.min(0.8, 0.15 + (cell.count * 0.1))})`;
                            }

                            return (
                              <div
                                key={h}
                                className={`heatmap-cell ${isSelected ? "selected" : ""} ${cell.count > 0 ? "has-data" : ""}`}
                                style={{ backgroundColor: cellBg }}
                                onClick={() => {
                                  if (cell.count === 0) return;
                                  if (crossFilterDay === dIdx && crossFilterHour === h) {
                                    setCrossFilterDay(null);
                                    setCrossFilterHour(null);
                                  } else {
                                    setCrossFilterDay(dIdx);
                                    setCrossFilterHour(h);
                                  }
                                }}
                                title={`${dName}曜 ${h}時: ${cell.count}件 | 損益: ¥${cell.profit.toLocaleString()} (${cell.pips >= 0 ? "+" : ""}${cell.pips}p)`}
                              >
                                {cell.count > 0 && (
                                  <div className="heatmap-cell-inner">
                                    <span className="heatmap-cell-count">{cell.count}</span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: 取引履歴ログ & 詳細インスペクター */}
            {activeMainTab === "ledger" && (
              <div className="trade-ledger-view">
                <div className="pro-panel ledger-table-panel" style={{ flex: 3 }}>
                  <div className="pro-panel-body" style={{ padding: 0, overflowY: "auto", maxHeight: "calc(100vh - 280px)" }}>
                    <table className="ledger-table">
                      <thead>
                        <tr>
                          <th onClick={() => requestSort("ticket")}>Ticket</th>
                          <th onClick={() => requestSort("symbol")}>通貨</th>
                          <th onClick={() => requestSort("type")}>売買</th>
                          <th onClick={() => requestSort("lots")}>Lot</th>
                          <th onClick={() => requestSort("open_time_msc")}>エントリー日時 (JST)</th>
                          <th onClick={() => requestSort("open_price")}>Entry</th>
                          <th onClick={() => requestSort("close_time_msc")}>決済日時 (JST)</th>
                          <th onClick={() => requestSort("close_price")}>Exit</th>
                          <th onClick={() => requestSort("durationSec")}>保有時間</th>
                          <th onClick={() => requestSort("pips")}>獲得pips</th>
                          <th onClick={() => requestSort("profit")}>実現損益</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedTrades.map((t) => {
                          const isSelected = selectedTicket === t.ticket;
                          return (
                            <tr
                              key={t.id || t.ticket}
                              className={`ledger-tr ${isSelected ? "selected" : ""}`}
                              onClick={() => setSelectedTicket(t.ticket)}
                            >
                              <td className="font-data">#{t.ticket}</td>
                              <td><span className="ccy-badge">{t.symbol}</span></td>
                              <td>
                                <span className={`type-badge ${t.type.toLowerCase()}`}>
                                  {t.type}
                                </span>
                              </td>
                              <td className="font-data">{t.lots}</td>
                              <td className="font-data text-[11px]">{t.open_time}</td>
                              <td className="font-data">{formatRate(t.open_price, t.symbol)}</td>
                              <td className="font-data text-[11px]">{t.close_time}</td>
                              <td className="font-data">{formatRate(t.close_price, t.symbol)}</td>
                              <td className="font-data text-[11px]">{t.durationSec}s</td>
                              <td className={`font-data ${t.pips >= 0 ? "text-profit" : "text-loss"}`}>
                                {t.pips >= 0 ? `+${t.pips}` : t.pips}
                              </td>
                              <td className={`font-data font-bold ${t.profit >= 0 ? "text-profit" : "text-loss"}`}>
                                {t.profit >= 0 ? `+¥${t.profit.toLocaleString()}` : `-¥${Math.abs(t.profit).toLocaleString()}`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Selected Trade Inspector */}
                {selectedTrade && (
                  <div className="pro-panel ledger-inspector-panel glass-panel" style={{ flex: 1, minWidth: "260px" }}>
                    <div className="pro-panel-header">
                      <h3 className="pro-panel-title">
                        <span className="material-symbols-outlined icon-accent">info</span>
                        <span>Trade Inspector</span>
                      </h3>
                      <button className="pro-btn-square" onClick={() => setSelectedTicket(null)}>
                        <span className="material-symbols-outlined text-[14px]">close</span>
                      </button>
                    </div>
                    <div className="pro-panel-body" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      <div className="inspector-badge-row">
                        <span className={`type-badge ${selectedTrade.type.toLowerCase()}`}>
                          {selectedTrade.type}
                        </span>
                        <span className="ccy-badge">{selectedTrade.symbol}</span>
                        <span className="preview-stat-pill">Ticket #{selectedTrade.ticket}</span>
                      </div>

                      <div className="inspector-metric-box">
                        <span className="inspector-metric-label">実現損益</span>
                        <div className={`inspector-metric-val ${selectedTrade.profit >= 0 ? "text-profit" : "text-loss"}`}>
                          {selectedTrade.profit >= 0 ? `+¥${selectedTrade.profit.toLocaleString()}` : `-¥${Math.abs(selectedTrade.profit).toLocaleString()}`}
                          <span className="inspector-metric-sub">
                            ({selectedTrade.pips >= 0 ? `+${selectedTrade.pips}` : selectedTrade.pips} pips)
                          </span>
                        </div>
                      </div>

                      <div className="inspector-details-list">
                        <div className="inspector-detail-row">
                          <span>取引数量</span>
                          <span className="font-data">{selectedTrade.lots} Lots</span>
                        </div>
                        <div className="inspector-detail-row">
                          <span>新規日時</span>
                          <span className="font-data">{selectedTrade.open_time}</span>
                        </div>
                        <div className="inspector-detail-row">
                          <span>新規レート</span>
                          <span className="font-data">{formatRate(selectedTrade.open_price, selectedTrade.symbol)}</span>
                        </div>
                        <div className="inspector-detail-row">
                          <span>決済日時</span>
                          <span className="font-data">{selectedTrade.close_time}</span>
                        </div>
                        <div className="inspector-detail-row">
                          <span>決済レート</span>
                          <span className="font-data">{formatRate(selectedTrade.close_price, selectedTrade.symbol)}</span>
                        </div>
                        <div className="inspector-detail-row">
                          <span>保有時間</span>
                          <span className="font-data">{selectedTrade.durationSec} 秒 ({Math.floor(selectedTrade.durationSec / 60)}分)</span>
                        </div>
                        {selectedTrade.entryIntervalSec !== undefined && (
                          <div className="inspector-detail-row">
                            <span>前回決済からの間隔</span>
                            <span className="font-data">{selectedTrade.entryIntervalSec} 秒</span>
                          </div>
                        )}
                        {selectedTrade.source && (
                          <div className="inspector-detail-row">
                            <span>データソース</span>
                            <span className="preview-broker-badge">{selectedTrade.sourceName}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* CSVインポートモーダル */}
      <CsvImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportSuccess={handleImportSuccess}
      />
    </div>
  );
};
