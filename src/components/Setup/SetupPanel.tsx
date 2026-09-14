import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { AdvancedSettingsAccordion } from "./AdvancedSettingsAccordion";
import { SymbolItem } from "../SymbolCombobox";
import { SymbolTagInput } from "../SymbolTagInput";
import { HelpTooltip } from "../HelpTooltip";
import {
  parseSymbolName,
  findDefaultDualFeedPair,
  findMatchingSymbolForYear,
  checkSymbolYearMismatch,
  formatCompactDualSymbolName
} from "../../utils/symbolUtils";
import { TerminalInfo } from "../../types/terminal";
import { MaxBarsInfo } from "../../utils/hotkeyUtils";
import { formatJstTime, getNewsTimeForDisplay } from "../../utils/timeUtils";
import { SavedSession } from "../../types/session";
import {
  getMonthRange,
  getYearRange,
  shiftDateRangeByMonth,
  parseDateTimeStr,
  alignDateRangeToYear
} from "../../utils/dateUtils";

export interface SetupPanelProps {
  status: "DISCONNECTED" | "CONNECTED" | "READY" | "ACTIVE";
  setupTab: "replay" | "trading" | "resume";
  setSetupTab: (tab: "replay" | "trading" | "resume") => void;
  terminals: TerminalInfo[];
  selectedTerminal: string;
  setSelectedTerminal: (val: string) => void;
  handleOpenTerminalNameModal: () => void;
  profiles: string[];
  selectedProfile: string;
  setSelectedProfile: (val: string) => void;
  maxBarsInfo: MaxBarsInfo | null;
  enableDualFeed: boolean;
  setEnableDualFeed: (val: boolean) => void;
  setIsBatchSelectorOpen: (val: boolean) => void;
  handleOpenSymbolSelector?: () => void;
  sourceSymbol: string;
  setSourceSymbol: (val: string) => void;
  subSourceSymbol: string;
  setSubSourceSymbol: (val: string) => void;
  availableSymbols: SymbolItem[];
  additionalSymbols: string;
  setAdditionalSymbols: (val: string) => void;
  companionSymbols: string[];
  setIsCustomImportOpen: (val: boolean) => void;
  startTime: string;
  setStartTime?: (val: string) => void;
  endTime: string;
  setEndTime?: (val: string) => void;
  timezoneMode: "JST" | "SERVER";
  setActivePickerField: (val: "preload" | "start" | "end" | null) => void;
  preloadMode: "BARS" | "DATE";
  setPreloadMode: (val: "BARS" | "DATE") => void;
  preloadTimeframe: string;
  setPreloadTimeframe: (val: string) => void;
  preloadedBars: number;
  setPreloadedBars: (val: number) => void;
  preloadDate: string;
  limitTickHistory: boolean;
  setLimitTickHistory: (val: boolean) => void;
  tickHistoryTimeframe: string;
  setTickHistoryTimeframe: (val: string) => void;
  maxHistoryBars: number;
  setMaxHistoryBars: (val: number) => void;
  autoScrollSync: boolean;
  setAutoScrollSync: (val: boolean) => void;
  autoSkipWeekend: boolean;
  setAutoSkipWeekend: (val: boolean) => void;
  initialBalance: number;
  setInitialBalance: (val: number) => void;
  leverage: number;
  setLeverage: (val: number) => void;
  contractSize: number;
  setContractSize: (val: number) => void;
  enablePseudoRate: boolean;
  setEnablePseudoRate: (val: boolean) => void;
  pseudoBaseSpread: number;
  setPseudoBaseSpread: (val: number) => void;
  pseudoThreshold: number;
  setPseudoThreshold: (val: number) => void;
  pseudoSensitivity: number;
  setPseudoSensitivity: (val: number) => void;
  pseudoMode?: "dmm" | "fixed" | "aggressive" | "custom";
  setPseudoMode?: (val: "dmm" | "fixed" | "aggressive" | "custom") => void;
  pseudoRolloverEnabled?: boolean;
  setPseudoRolloverEnabled?: (val: boolean) => void;
  pseudoRolloverSpread?: number;
  setPseudoRolloverSpread?: (val: number) => void;
  pseudoRolloverRecoveryMin?: number;
  setPseudoRolloverRecoveryMin?: (val: number) => void;
  savedSessions: SavedSession[];
  expandedGroups: { [key: string]: boolean };
  setExpandedGroups: React.Dispatch<React.SetStateAction<{ [key: string]: boolean }>>;
  handleClearAllSessions: () => void;
  handleDeleteSessions: (ids: string[], msg: string) => void;
  handleResumeSession: (session: SavedSession) => void;
  loadSavedSessions: () => void;
  handleResetReplaySettings: () => void;
  handleResetTradingSettings: () => void;
  handleCheckConnection: () => void;
  handleInit: () => void;
}

const areSetupPanelPropsEqual = (prev: SetupPanelProps, next: SetupPanelProps): boolean => {
  return (
    prev.status === next.status &&
    prev.setupTab === next.setupTab &&
    prev.selectedTerminal === next.selectedTerminal &&
    prev.selectedProfile === next.selectedProfile &&
    prev.enableDualFeed === next.enableDualFeed &&
    prev.sourceSymbol === next.sourceSymbol &&
    prev.subSourceSymbol === next.subSourceSymbol &&
    prev.additionalSymbols === next.additionalSymbols &&
    prev.startTime === next.startTime &&
    prev.endTime === next.endTime &&
    prev.timezoneMode === next.timezoneMode &&
    prev.preloadMode === next.preloadMode &&
    prev.preloadTimeframe === next.preloadTimeframe &&
    prev.preloadedBars === next.preloadedBars &&
    prev.preloadDate === next.preloadDate &&
    prev.limitTickHistory === next.limitTickHistory &&
    prev.tickHistoryTimeframe === next.tickHistoryTimeframe &&
    prev.maxHistoryBars === next.maxHistoryBars &&
    prev.autoScrollSync === next.autoScrollSync &&
    prev.autoSkipWeekend === next.autoSkipWeekend &&
    prev.initialBalance === next.initialBalance &&
    prev.leverage === next.leverage &&
    prev.contractSize === next.contractSize &&
    prev.enablePseudoRate === next.enablePseudoRate &&
    prev.pseudoBaseSpread === next.pseudoBaseSpread &&
    prev.pseudoThreshold === next.pseudoThreshold &&
    prev.pseudoSensitivity === next.pseudoSensitivity &&
    prev.pseudoMode === next.pseudoMode &&
    prev.pseudoRolloverEnabled === next.pseudoRolloverEnabled &&
    prev.pseudoRolloverSpread === next.pseudoRolloverSpread &&
    prev.pseudoRolloverRecoveryMin === next.pseudoRolloverRecoveryMin &&
    prev.terminals === next.terminals &&
    prev.profiles === next.profiles &&
    prev.maxBarsInfo === next.maxBarsInfo &&
    prev.availableSymbols === next.availableSymbols &&
    prev.companionSymbols === next.companionSymbols &&
    prev.savedSessions === next.savedSessions &&
    prev.expandedGroups === next.expandedGroups
  );
};

const SetupPanelComponent: React.FC<SetupPanelProps> = ({
  status,
  setupTab,
  setSetupTab,
  terminals,
  selectedTerminal,
  setSelectedTerminal,
  handleOpenTerminalNameModal,
  profiles,
  selectedProfile,
  setSelectedProfile,
  maxBarsInfo,
  enableDualFeed,
  setEnableDualFeed,
  setIsBatchSelectorOpen,
  handleOpenSymbolSelector,
  sourceSymbol,
  setSourceSymbol,
  subSourceSymbol,
  setSubSourceSymbol,
  availableSymbols,
  additionalSymbols,
  setAdditionalSymbols,
  companionSymbols,
  setIsCustomImportOpen,
  startTime,
  setStartTime,
  endTime,
  setEndTime,
  timezoneMode,
  setActivePickerField,
  preloadMode,
  setPreloadMode,
  preloadTimeframe,
  setPreloadTimeframe,
  preloadedBars,
  setPreloadedBars,
  preloadDate,
  limitTickHistory,
  setLimitTickHistory,
  tickHistoryTimeframe,
  setTickHistoryTimeframe,
  maxHistoryBars,
  setMaxHistoryBars,
  autoScrollSync,
  setAutoScrollSync,
  autoSkipWeekend,
  setAutoSkipWeekend,
  initialBalance,
  setInitialBalance,
  leverage,
  setLeverage,
  contractSize,
  setContractSize,
  enablePseudoRate,
  setEnablePseudoRate,
  pseudoBaseSpread,
  setPseudoBaseSpread,
  pseudoThreshold,
  setPseudoThreshold,
  pseudoSensitivity,
  setPseudoSensitivity,
  pseudoMode = "dmm",
  setPseudoMode,
  pseudoRolloverEnabled = true,
  setPseudoRolloverEnabled,
  pseudoRolloverSpread = 3.8,
  setPseudoRolloverSpread,
  pseudoRolloverRecoveryMin = 15,
  setPseudoRolloverRecoveryMin,
  savedSessions,
  expandedGroups,
  setExpandedGroups,
  handleClearAllSessions,
  handleDeleteSessions,
  handleResumeSession,
  loadSavedSessions,
  handleResetReplaySettings,
  handleResetTradingSettings,
  handleCheckConnection,
  handleInit,
}) => {
  const handleOpenSelector = handleOpenSymbolSelector || (() => setIsBatchSelectorOpen(true));

  const handleSelectPreset = (mode: "dmm" | "fixed" | "aggressive") => {
    if (setPseudoMode) setPseudoMode(mode);
    const sym = (sourceSymbol || "USDJPY").toUpperCase();

    if (mode === "dmm") {
      // DMMリアル再現モード（242万ティック検証による実測最適値）
      if (sym.includes("USDJPY")) {
        setPseudoBaseSpread(0.2);
        setPseudoThreshold(1.5);  // 実測最適: 1.5 pips
        if (setPseudoRolloverSpread) setPseudoRolloverSpread(3.8);
      } else if (sym.includes("EURUSD")) {
        setPseudoBaseSpread(0.4);
        setPseudoThreshold(1.0);
        if (setPseudoRolloverSpread) setPseudoRolloverSpread(3.8);
      } else if (sym.includes("GBPJPY")) {
        setPseudoBaseSpread(0.9);
        setPseudoThreshold(2.0);
        if (setPseudoRolloverSpread) setPseudoRolloverSpread(4.5);
      } else {
        setPseudoBaseSpread(sym.includes("JPY") ? 0.3 : 0.5);
        setPseudoThreshold(1.2);
        if (setPseudoRolloverSpread) setPseudoRolloverSpread(3.8);
      }
      setPseudoSensitivity(sym.includes("USDJPY") ? 0.25 : 0.35);  // USDJPY実測最適 0.25
      if (setPseudoRolloverEnabled) setPseudoRolloverEnabled(true);
      if (setPseudoRolloverRecoveryMin) setPseudoRolloverRecoveryMin(15);
    } else if (mode === "fixed") {
      // 完全固定モード（急変動・早朝に関わらずスプレッド完全固定）
      if (sym.includes("USDJPY")) setPseudoBaseSpread(0.2);
      else if (sym.includes("EURUSD")) setPseudoBaseSpread(0.4);
      else if (sym.includes("GBPJPY")) setPseudoBaseSpread(0.9);
      else setPseudoBaseSpread(sym.includes("JPY") ? 0.3 : 0.5);
      setPseudoThreshold(99.0);
      setPseudoSensitivity(0.0);
      if (setPseudoRolloverEnabled) setPseudoRolloverEnabled(false);
      if (setPseudoRolloverSpread) setPseudoRolloverSpread(pseudoBaseSpread);
      if (setPseudoRolloverRecoveryMin) setPseudoRolloverRecoveryMin(0);
    } else if (mode === "aggressive") {
      // 厳格検証・高負荷モード（指標時や早朝に厳しめに拡大）
      if (sym.includes("USDJPY")) {
        setPseudoBaseSpread(0.2);
        setPseudoThreshold(0.8);
        if (setPseudoRolloverSpread) setPseudoRolloverSpread(4.5);
      } else if (sym.includes("EURUSD")) {
        setPseudoBaseSpread(0.4);
        setPseudoThreshold(0.8);
        if (setPseudoRolloverSpread) setPseudoRolloverSpread(4.5);
      } else if (sym.includes("GBPJPY")) {
        setPseudoBaseSpread(0.9);
        setPseudoThreshold(1.5);
        if (setPseudoRolloverSpread) setPseudoRolloverSpread(6.0);
      } else {
        setPseudoBaseSpread(sym.includes("JPY") ? 0.3 : 0.5);
        setPseudoThreshold(1.0);
        if (setPseudoRolloverSpread) setPseudoRolloverSpread(4.5);
      }
      setPseudoSensitivity(0.80);
      if (setPseudoRolloverEnabled) setPseudoRolloverEnabled(true);
      if (setPseudoRolloverRecoveryMin) setPseudoRolloverRecoveryMin(20);
    }
  };

  // 日時解析および月別クイック選択用の表示年ステート
  const parsedStart = parseDateTimeStr(startTime);
  const [viewYear, setViewYear] = React.useState<number>(() => parsedStart.year || 2024);

  React.useEffect(() => {
    if (parsedStart.year && parsedStart.year !== viewYear) {
      setViewYear(parsedStart.year);
    }
  }, [parsedStart.year]);

  // 現在のシンボル情報と年度不一致チェック
  const parsedSource = parseSymbolName(sourceSymbol);
  const parsedSubSource = parseSymbolName(subSourceSymbol);
  const mismatch = checkSymbolYearMismatch(sourceSymbol, startTime);

  // 円相関標準セット（USDJPY Main/Sub + EURJPY/GBPJPY Sync）をワンクリック適用
  const handleApplyStandardJpySet = () => {
    const yStr = viewYear.toString();

    // 1. デュアルフィードを有効化
    setEnableDualFeed(true);

    // 2. 現在年に一致するUSDJPYを検索（OANDA優先）
    let mainCandidate = findMatchingSymbolForYear(sourceSymbol || "USDJPY", yStr, availableSymbols);
    if (!mainCandidate) {
      const found = availableSymbols.find((s) => {
        const name = typeof s === "string" ? s : s.name;
        const p = parseSymbolName(name);
        return p.basePair === "USDJPY" && (!p.year || p.year === yStr);
      });
      if (found) mainCandidate = typeof found === "string" ? found : found.name;
    }
    const mainSym = mainCandidate || "USDJPY";
    setSourceSymbol(mainSym);

    // 3. Subシンボルを自動検出 (DUCASCOPY等)
    const dualPair = findDefaultDualFeedPair(availableSymbols, mainSym);
    if (dualPair && dualPair.subSymbol) {
      setSubSourceSymbol(dualPair.subSymbol);
    }

    // 4. 同期他通貨（EURJPYとGBPJPY）を該当年で検索・設定
    let eurSym = findMatchingSymbolForYear("EURJPY", yStr, availableSymbols);
    if (!eurSym) {
      const found = availableSymbols.find((s) => {
        const name = typeof s === "string" ? s : s.name;
        const p = parseSymbolName(name);
        return p.basePair === "EURJPY" && (!p.year || p.year === yStr);
      });
      if (found) eurSym = typeof found === "string" ? found : found.name;
    }
    const finalEur = eurSym || "EURJPY";

    let gbpSym = findMatchingSymbolForYear("GBPJPY", yStr, availableSymbols);
    if (!gbpSym) {
      const found = availableSymbols.find((s) => {
        const name = typeof s === "string" ? s : s.name;
        const p = parseSymbolName(name);
        return p.basePair === "GBPJPY" && (!p.year || p.year === yStr);
      });
      if (found) gbpSym = typeof found === "string" ? found : found.name;
    }
    const finalGbp = gbpSym || "GBPJPY";

    setAdditionalSymbols(`${finalEur},${finalGbp}`);
  };

  // 年度切り替えハンドラー（期間の年度変更 ＋ 全対応シンボルの自動一括切り替え）
  const handleSelectYear = (newYear: number) => {
    setViewYear(newYear);
    const range = getMonthRange(newYear, parsedStart.month);
    setStartTime?.(range.start);
    setEndTime?.(range.end);

    const yStr = newYear.toString();

    // 現在のMainシンボルに一致する該当年シンボルがあれば自動更新
    const matched = findMatchingSymbolForYear(sourceSymbol, yStr, availableSymbols);
    if (matched) {
      setSourceSymbol(matched);
    }

    // 現在のSubシンボルに一致する該当年シンボルがあれば自動更新
    if (enableDualFeed && subSourceSymbol) {
      const matchedSub = findMatchingSymbolForYear(subSourceSymbol, yStr, availableSymbols);
      if (matchedSub) {
        setSubSourceSymbol(matchedSub);
      }
    }

    // 同期他通貨 (EURJPY, GBPJPY 等) も一括で新年度へ自動置換
    if (additionalSymbols) {
      const currentSync = additionalSymbols
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const updatedSync = currentSync.map((sym) => {
        const m = findMatchingSymbolForYear(sym, yStr, availableSymbols);
        return m || sym;
      });
      setAdditionalSymbols(updatedSync.join(","));
    }
  };

  return (
    <div className="setup-dashboard-container">
      {/* 上部：セグメントナビゲーション */}
      <div className="setup-tab-bar">
        <button
          type="button"
          className={`setup-tab-btn ${setupTab !== "resume" ? "active" : ""}`}
          onClick={() => setSetupTab("replay")}
        >
          <span className="material-symbols-outlined icon">dashboard_customize</span>
          <span>新規リプレイ設定</span>
        </button>
        <button
          type="button"
          className={`setup-tab-btn ${setupTab === "resume" ? "active" : ""}`}
          onClick={() => {
            setSetupTab("resume");
            loadSavedSessions();
          }}
        >
          <span className="material-symbols-outlined icon">history</span>
          <span>セッション再開</span>
          {savedSessions.length > 0 && (
            <span className="tab-count-badge">{savedSessions.length}</span>
          )}
        </button>
      </div>

      {/* メインスクロールエリア */}
      <div className="setup-scroll-body">
        {setupTab !== "resume" ? (
          <div className="setup-workspace-layout">
            {/* ======================================================== */}
            {/* ZONE 1: 日常検証ワークスペース (Primary Verification Deck) */}
            {/* ======================================================== */}
            <div className="primary-verification-deck">
              {/* カードA: 検証銘柄 & 円相関デュアルフィード */}
              <div className="setup-card-dashboard">
                <div className="card-header-dashboard">
                  <div className="header-title-wrapper">
                    <span className="material-symbols-outlined header-icon">candlestick_chart</span>
                    <span className="header-title">検証銘柄 &amp; 相関</span>
                  </div>
                  <div className="header-actions-group">
                    <button
                      type="button"
                      className="btn-text-standard-jpy"
                      onClick={handleApplyStandardJpySet}
                      title="USDJPY(Main/Sub) + EURJPY/GBPJPY の円相関標準セットをワンクリック適用"
                    >
                      <span className="material-symbols-outlined icon">bolt</span>
                      <span>標準セット</span>
                    </button>
                    <button
                      type="button"
                      className="btn-text-accent"
                      onClick={handleOpenSelector}
                      title="シンボル選択セレクターウィンドウを開く"
                    >
                      <span className="material-symbols-outlined icon">tune</span>
                      <span>セレクター</span>
                    </button>
                    <button
                      type="button"
                      className="btn-text-accent"
                      onClick={() => setIsCustomImportOpen(true)}
                      title="カスタムシンボル作成・インポート"
                    >
                      <span className="material-symbols-outlined icon">upload_file</span>
                    </button>
                  </div>
                </div>

                <div className="card-body-dashboard">
                  {/* シングル / デュアル切り替えトグル */}
                  <div className="feed-toggle-row">
                    <label className="toggle-switch-label">
                      <input
                        type="checkbox"
                        checked={enableDualFeed}
                        onChange={(e) => {
                          const nextVal = e.target.checked;
                          setEnableDualFeed(nextVal);
                          if (nextVal) {
                            // デュアルフィード有効化時: 既存のサブ銘柄があれば維持し、未設定時のみ自動選択
                            const hasValidSub = subSourceSymbol && subSourceSymbol !== sourceSymbol && availableSymbols.some(s => (typeof s === "string" ? s : s.name) === subSourceSymbol);
                            if (!hasValidSub) {
                              const defaultPair = findDefaultDualFeedPair(availableSymbols, sourceSymbol);
                              if (defaultPair) {
                                setSourceSymbol(defaultPair.mainSymbol);
                                setSubSourceSymbol(defaultPair.subSymbol);
                              }
                            }
                          }
                        }}
                      />
                      <span className="switch-text">デュアルフィード比較 (Main vs Sub)</span>
                    </label>
                  </div>

                  {/* 選択中シンボルサマリー ＆ セレクター起動カード */}
                  <div
                    style={{
                      padding: "4px 6px",
                      borderRadius: "4px",
                      backgroundColor: "var(--surface-container)",
                      border: "1px solid var(--outline-variant)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "3px",
                    }}
                  >
                    {enableDualFeed ? (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
                          gap: "3px",
                          alignItems: "center",
                        }}
                      >
                        {/* MAIN BOX */}
                        <div
                          style={{
                            minWidth: 0,
                            padding: "3px 5px",
                            backgroundColor: "var(--surface-variant)",
                            borderRadius: "3px",
                            border: "1px solid var(--primary-color)",
                          }}
                          title={sourceSymbol ? `Main: ${sourceSymbol}` : "Mainシンボル未選択"}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1px" }}>
                            <span style={{ fontSize: "8.5px", color: "var(--primary-color)", fontWeight: 800, letterSpacing: "0.02em" }}>
                              MAIN
                            </span>
                            {parsedSource.year && (
                              <span
                                style={{
                                  fontSize: "8px",
                                  padding: "0 2px",
                                  borderRadius: "2px",
                                  backgroundColor: "rgba(var(--primary-rgb), 0.15)",
                                  color: "var(--primary-color)",
                                  fontWeight: 700,
                                  lineHeight: 1.2,
                                }}
                              >
                                {parsedSource.year}年
                              </span>
                            )}
                          </div>
                          <span
                            style={{
                              fontSize: "10.5px",
                              fontWeight: 700,
                              fontFamily: "var(--font-data)",
                              display: "block",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {formatCompactDualSymbolName(sourceSymbol, parsedSource)}
                          </span>
                        </div>

                        {/* SWAP BUTTON */}
                        <button
                          type="button"
                          className="btn-swap"
                          onClick={() => {
                            const temp = sourceSymbol;
                            setSourceSymbol(subSourceSymbol);
                            setSubSourceSymbol(temp);
                          }}
                          title="MainとSubの銘柄を入れ替え"
                          style={{
                            padding: "0",
                            width: "20px",
                            height: "20px",
                            minWidth: "20px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: "50%",
                            flexShrink: 0,
                          }}
                        >
                          <span className="material-symbols-outlined icon" style={{ fontSize: "13px" }}>swap_horiz</span>
                        </button>

                        {/* SUB BOX */}
                        <div
                          style={{
                            minWidth: 0,
                            padding: "3px 5px",
                            backgroundColor: "var(--surface-variant)",
                            borderRadius: "3px",
                            border: "1px solid var(--secondary-color)",
                          }}
                          title={subSourceSymbol ? `Sub: ${subSourceSymbol}` : "Subシンボル未選択"}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1px" }}>
                            <span style={{ fontSize: "8.5px", color: "var(--secondary-color)", fontWeight: 800, letterSpacing: "0.02em" }}>
                              SUB
                            </span>
                            {parsedSubSource.year && (
                              <span
                                style={{
                                  fontSize: "8px",
                                  padding: "0 2px",
                                  borderRadius: "2px",
                                  backgroundColor: "rgba(var(--secondary-rgb, var(--primary-rgb)), 0.15)",
                                  color: "var(--secondary-color)",
                                  fontWeight: 700,
                                  lineHeight: 1.2,
                                }}
                              >
                                {parsedSubSource.year}年
                              </span>
                            )}
                          </div>
                          <span
                            style={{
                              fontSize: "10.5px",
                              fontWeight: 700,
                              fontFamily: "var(--font-data)",
                              display: "block",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {formatCompactDualSymbolName(subSourceSymbol, parsedSubSource)}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <span style={{ fontSize: "9px", color: "var(--on-surface-variant)", display: "block" }}>リプレイ対象銘柄</span>
                          <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--on-surface)", fontFamily: "var(--font-data)" }}>
                            {sourceSymbol || "USDJPY"}
                          </span>
                        </div>
                        {sourceSymbol && (
                          <div style={{ display: "flex", gap: "3px", alignItems: "center" }}>
                            {parsedSource.year && (
                              <span style={{ fontSize: "9px", padding: "1px 4px", borderRadius: "2px", backgroundColor: "rgba(var(--primary-rgb), 0.15)", color: "var(--primary-color)", fontWeight: 700 }}>
                                📅 {parsedSource.year}年
                              </span>
                            )}
                            {parsedSource.broker && (
                              <span style={{ fontSize: "9px", padding: "1px 4px", borderRadius: "2px", backgroundColor: "var(--surface-container-high)", color: "var(--on-surface-variant)" }}>
                                🏛️ {parsedSource.broker}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 年度不一致警告バナー */}
                    {mismatch.hasMismatch && mismatch.symbolYear && (
                      <div
                        style={{
                          padding: "3px 6px",
                          borderRadius: "3px",
                          backgroundColor: "rgba(245, 158, 11, 0.12)",
                          border: "1px solid rgba(245, 158, 11, 0.35)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "4px",
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "9.5px", color: "var(--status-warning, #f59e0b)" }}>
                          <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>warning</span>
                          <span>
                            銘柄({mismatch.symbolYear}年) と 期間({mismatch.dateYear}年) 不一致
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: "3px" }}>
                          <button
                            type="button"
                            className="pro-btn"
                            onClick={() => {
                              if (mismatch.symbolYear) {
                                const targetY = parseInt(mismatch.symbolYear);
                                const aligned = alignDateRangeToYear(startTime, endTime, targetY);
                                setStartTime?.(aligned.start);
                                setEndTime?.(aligned.end);
                                setViewYear(targetY);
                              }
                            }}
                            style={{
                              padding: "1px 5px",
                              fontSize: "9px",
                              height: "18px",
                              whiteSpace: "nowrap",
                              backgroundColor: "rgba(245, 158, 11, 0.2)",
                              borderColor: "rgba(245, 158, 11, 0.5)",
                              color: "var(--status-warning, #f59e0b)",
                              fontWeight: 700,
                            }}
                            title={`期間を${mismatch.symbolYear}年に自動調整`}
                          >
                            期間を{mismatch.symbolYear}年に
                          </button>
                          <button
                            type="button"
                            className="pro-btn"
                            onClick={() => {
                              handleSelectYear(mismatch.dateYear);
                            }}
                            style={{
                              padding: "1px 5px",
                              fontSize: "9px",
                              height: "18px",
                              whiteSpace: "nowrap",
                              backgroundColor: "rgba(59, 130, 246, 0.2)",
                              borderColor: "rgba(59, 130, 246, 0.5)",
                              color: "#60a5fa",
                              fontWeight: 700,
                            }}
                            title={`全銘柄を期間の${mismatch.dateYear}年に同期`}
                          >
                            銘柄を{mismatch.dateYear}年に
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 同期他通貨 (クロス円相関監視) */}
                  <div className="form-group-compact">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1px" }}>
                      <label className="form-label-compact" style={{ margin: 0, display: "flex", alignItems: "center", gap: "3px", fontSize: "10px" }}>
                        <span>同期通貨 (円相関)</span>
                        <HelpTooltip
                          title="同期他通貨"
                          content="メイン銘柄（USDJPY）と同時にリプレイ進行させるサブ銘柄です。相関監視のため通常はEURJPYとGBPJPYを設定します。"
                        />
                      </label>
                      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        {!additionalSymbols.toUpperCase().includes("EURJPY") && (
                          <button
                            type="button"
                            className="chip-btn"
                            style={{ borderColor: "var(--primary-color)", color: "var(--primary-color)", fontSize: "9px", padding: "1px 4px" }}
                            onClick={() => {
                              const sym = findMatchingSymbolForYear("EURJPY", viewYear.toString(), availableSymbols) || "EURJPY";
                              const current = additionalSymbols ? additionalSymbols.split(",").map((s) => s.trim()).filter(Boolean) : [];
                              if (!current.includes(sym)) setAdditionalSymbols([...current, sym].join(","));
                            }}
                            title={`EURJPY (${viewYear}年) を追加`}
                          >
                            + EURJPY
                          </button>
                        )}
                        {!additionalSymbols.toUpperCase().includes("GBPJPY") && (
                          <button
                            type="button"
                            className="chip-btn"
                            style={{ borderColor: "var(--primary-color)", color: "var(--primary-color)", fontSize: "9px", padding: "1px 4px" }}
                            onClick={() => {
                              const sym = findMatchingSymbolForYear("GBPJPY", viewYear.toString(), availableSymbols) || "GBPJPY";
                              const current = additionalSymbols ? additionalSymbols.split(",").map((s) => s.trim()).filter(Boolean) : [];
                              if (!current.includes(sym)) setAdditionalSymbols([...current, sym].join(","));
                            }}
                            title={`GBPJPY (${viewYear}年) を追加`}
                          >
                            + GBPJPY
                          </button>
                        )}
                        {additionalSymbols && (
                          <button
                            type="button"
                            className="btn-text-accent"
                            style={{ fontSize: "9px", padding: "0 2px" }}
                            onClick={() => setAdditionalSymbols("")}
                          >
                            クリア
                          </button>
                        )}
                      </div>
                    </div>
                    <SymbolTagInput
                      value={additionalSymbols}
                      onChange={setAdditionalSymbols}
                      placeholder="カンマ区切りで入力 (例: EURJPY, GBPJPY)"
                      availableSymbols={availableSymbols}
                    />
                    {companionSymbols.length > 0 && (
                      <div className="companion-chips-container" style={{ marginTop: "2px", gap: "3px" }}>
                        <span className="chips-label" style={{ fontSize: "9px" }}>候補:</span>
                        {companionSymbols.map((sym) => (
                          <button
                            key={sym}
                            type="button"
                            className="chip-btn"
                            style={{ fontSize: "9px", padding: "0 4px" }}
                            onClick={() => {
                              const current = additionalSymbols
                                ? additionalSymbols.split(",").map((s) => s.trim()).filter(Boolean)
                                : [];
                              if (!current.includes(sym)) {
                                setAdditionalSymbols([...current, sym].join(","));
                              }
                            }}
                            title={`クリックで追加: ${sym}`}
                          >
                            +{sym}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* カードB: リプレイ期間 */}
              <div className="setup-card-dashboard">
                <div className="card-header-dashboard">
                  <div className="header-title-wrapper">
                    <span className="material-symbols-outlined header-icon">calendar_month</span>
                    <span className="header-title">リプレイ期間</span>
                  </div>
                </div>

                <div className="card-body-dashboard">
                  {/* 1ヶ月クイック選択 & 月送りナビゲーションバー */}
                  <div className="quick-month-selector-box">
                    {/* 上段: 年度セレクター & 月送り・プリセットボタン */}
                    <div className="quick-month-header">
                      <div className="year-stepper">
                        <button
                          type="button"
                          className="month-step-btn"
                          onClick={() => handleSelectYear(viewYear - 1)}
                          title="前年へ (対応シンボルも全自動同期)"
                        >
                          <span className="material-symbols-outlined icon">chevron_left</span>
                        </button>
                        <span className="year-label font-data">{viewYear}年</span>
                        <button
                          type="button"
                          className="month-step-btn"
                          onClick={() => handleSelectYear(viewYear + 1)}
                          title="翌年へ (対応シンボルも全自動同期)"
                        >
                          <span className="material-symbols-outlined icon">chevron_right</span>
                        </button>
                      </div>

                      {/* 前月 / 次月 ナビゲーション */}
                      <div className="month-nav-group">
                        <button
                          type="button"
                          className="month-nav-btn"
                          onClick={() => {
                            const shifted = shiftDateRangeByMonth(startTime, endTime, -1);
                            setStartTime?.(shifted.start);
                            setEndTime?.(shifted.end);
                            const newParsed = parseDateTimeStr(shifted.start);
                            if (newParsed.year !== viewYear) {
                              handleSelectYear(newParsed.year);
                            }
                          }}
                          title="期間を1ヶ月前にシフト (前月へ)"
                        >
                          <span className="material-symbols-outlined icon">arrow_back</span>
                          前月
                        </button>
                        <button
                          type="button"
                          className="month-nav-btn"
                          onClick={() => {
                            const shifted = shiftDateRangeByMonth(startTime, endTime, 1);
                            setStartTime?.(shifted.start);
                            setEndTime?.(shifted.end);
                            const newParsed = parseDateTimeStr(shifted.start);
                            if (newParsed.year !== viewYear) {
                              handleSelectYear(newParsed.year);
                            }
                          }}
                          title="期間を1ヶ月先にシフト (次月へ)"
                        >
                          次月
                          <span className="material-symbols-outlined icon">arrow_forward</span>
                        </button>
                      </div>

                      {/* クイックプリセット */}
                      <div className="month-presets-group">
                        <button
                          type="button"
                          className="month-preset-btn"
                          onClick={() => {
                            const range = getMonthRange(viewYear, parsedStart.month);
                            setStartTime?.(range.start);
                            setEndTime?.(range.end);
                          }}
                          title="選択中の月を1ヶ月全期間 (1日〜末日) にセット"
                        >
                          当月全期
                        </button>
                        <button
                          type="button"
                          className="month-preset-btn"
                          onClick={() => {
                            const range = getYearRange(viewYear);
                            setStartTime?.(range.start);
                            setEndTime?.(range.end);
                          }}
                          title="選択年の1年間全期間 (1/1〜12/31) をセット"
                        >
                          年間全期
                        </button>
                      </div>
                    </div>

                    {/* 下段: 1〜12月 月別ピルボタン */}
                    <div className="month-pills-grid">
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                        const isSelectedMonth = parsedStart.year === viewYear && parsedStart.month === m;
                        return (
                          <button
                            key={m}
                            type="button"
                            className={`month-pill-btn ${isSelectedMonth ? "active" : ""}`}
                            onClick={() => {
                              const range = getMonthRange(viewYear, m);
                              setStartTime?.(range.start);
                              setEndTime?.(range.end);
                            }}
                            title={`${viewYear}年${m}月 (1ヶ月間: 1日 00:00 〜 末日 23:59) をリプレイ期間にセット`}
                          >
                            {m}月
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="date-range-grid">
                    <div className="form-group-compact">
                      <label className="form-label-compact">開始日時 ({timezoneMode})</label>
                      <div className="input-with-icon-compact" onClick={() => setActivePickerField("start")}>
                        <input
                          type="text"
                          readOnly
                          className="input-compact cursor-pointer font-data"
                          value={timezoneMode === "JST" ? startTime : getNewsTimeForDisplay(startTime, "SERVER")}
                        />
                        <span className="material-symbols-outlined icon">calendar_today</span>
                      </div>
                    </div>
                    <div className="form-group-compact">
                      <label className="form-label-compact">終了日時 ({timezoneMode})</label>
                      <div className="input-with-icon-compact" onClick={() => setActivePickerField("end")}>
                        <input
                          type="text"
                          readOnly
                          className="input-compact cursor-pointer font-data"
                          value={timezoneMode === "JST" ? endTime : getNewsTimeForDisplay(endTime, "SERVER")}
                        />
                        <span className="material-symbols-outlined icon">event_available</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ======================================================== */}
            {/* ZONE 2: 高度な環境設定 (Advanced Settings Accordion)       */}
            {/* ======================================================== */}
            <AdvancedSettingsAccordion
              terminals={terminals}
              selectedTerminal={selectedTerminal}
              setSelectedTerminal={setSelectedTerminal}
              handleOpenTerminalNameModal={handleOpenTerminalNameModal}
              profiles={profiles}
              selectedProfile={selectedProfile}
              setSelectedProfile={setSelectedProfile}
              maxBarsInfo={maxBarsInfo}
              preloadMode={preloadMode}
              setPreloadMode={setPreloadMode}
              preloadTimeframe={preloadTimeframe}
              setPreloadTimeframe={setPreloadTimeframe}
              preloadedBars={preloadedBars}
              setPreloadedBars={setPreloadedBars}
              preloadDate={preloadDate}
              setActivePickerField={setActivePickerField}
              timezoneMode={timezoneMode}
              limitTickHistory={limitTickHistory}
              setLimitTickHistory={setLimitTickHistory}
              tickHistoryTimeframe={tickHistoryTimeframe}
              setTickHistoryTimeframe={setTickHistoryTimeframe}
              maxHistoryBars={maxHistoryBars}
              setMaxHistoryBars={setMaxHistoryBars}
              initialBalance={initialBalance}
              setInitialBalance={setInitialBalance}
              leverage={leverage}
              setLeverage={setLeverage}
              contractSize={contractSize}
              setContractSize={setContractSize}
              sourceSymbol={sourceSymbol}
              enablePseudoRate={enablePseudoRate}
              setEnablePseudoRate={setEnablePseudoRate}
              pseudoMode={pseudoMode}
              setPseudoMode={setPseudoMode}
              pseudoBaseSpread={pseudoBaseSpread}
              setPseudoBaseSpread={setPseudoBaseSpread}
              pseudoThreshold={pseudoThreshold}
              setPseudoThreshold={setPseudoThreshold}
              pseudoSensitivity={pseudoSensitivity}
              setPseudoSensitivity={setPseudoSensitivity}
              pseudoRolloverEnabled={pseudoRolloverEnabled}
              setPseudoRolloverEnabled={setPseudoRolloverEnabled}
              pseudoRolloverSpread={pseudoRolloverSpread}
              setPseudoRolloverSpread={setPseudoRolloverSpread}
              pseudoRolloverRecoveryMin={pseudoRolloverRecoveryMin}
              setPseudoRolloverRecoveryMin={setPseudoRolloverRecoveryMin}
              handleSelectPreset={handleSelectPreset}
              autoScrollSync={autoScrollSync}
              setAutoScrollSync={setAutoScrollSync}
              autoSkipWeekend={autoSkipWeekend}
              setAutoSkipWeekend={setAutoSkipWeekend}
            />
          </div>
        ) : (
          /* ======================================================== */
          /* 3. セッション再開タブ (広々カードグリッド)               */
          /* ======================================================== */
          (() => {
            const groupedSessions: Record<string, SavedSession[]> = {};
            savedSessions.forEach((session) => {
              const gid = session.group_session_id || session.id;
              if (!groupedSessions[gid]) {
                groupedSessions[gid] = [];
              }
              groupedSessions[gid].push(session);
            });

            Object.keys(groupedSessions).forEach((gid) => {
              groupedSessions[gid].sort((a, b) => new Date(b.saved_at).getTime() - new Date(a.saved_at).getTime());
            });

            const sortedGroupIds = Object.keys(groupedSessions).sort((a, b) => {
              const aLatest = groupedSessions[a][0];
              const bLatest = groupedSessions[b][0];
              return new Date(bLatest.saved_at).getTime() - new Date(aLatest.saved_at).getTime();
            });

            return (
              <div className="resume-sessions-container">
                <div className="resume-header-bar">
                  <div className="resume-info-left">
                    <span className="material-symbols-outlined icon">save_as</span>
                    <span className="session-count-text">保存済みセッション: {savedSessions.length} 件</span>
                  </div>
                  {savedSessions.length > 0 && (
                    <button className="btn-danger-compact" onClick={handleClearAllSessions}>
                      <span className="material-symbols-outlined icon">delete_sweep</span>
                      全セッション削除
                    </button>
                  )}
                </div>

                {savedSessions.length === 0 ? (
                  <div className="no-sessions-card-spacious">
                    <span className="material-symbols-outlined empty-icon">history_toggle_off</span>
                    <h4>保存されたセッションはありません</h4>
                    <p>
                      リプレイ実行中にヘッダーの「保存」ボタンを押すことで、チャート位置・保有ポジション・取引履歴をスナップショットとしていつでも保存・再開できます。
                    </p>
                  </div>
                ) : (
                  <div className="sessions-grid-spacious">
                    {sortedGroupIds.map((gid) => {
                      const groupList = groupedSessions[gid];
                      const latestSession = groupList[0];
                      const progressPercent =
                        latestSession.progress.total_ticks > 0
                          ? ((latestSession.progress.current_idx / latestSession.progress.total_ticks) * 100).toFixed(1)
                          : "0.0";
                      const balanceStr = latestSession.virtual_trade
                        ? `${latestSession.virtual_trade.balance.toLocaleString()} JPY`
                        : "データなし";
                      const jstTimeStr =
                        latestSession.progress.virtual_time_msc > 0
                          ? formatJstTime(latestSession.progress.virtual_time_msc)
                          : "時刻情報なし";
                      const isExpanded = !!expandedGroups[gid];

                      return (
                        <div key={gid} className="session-card-spacious">
                          <div className="session-top-row">
                            <div className="session-title-group">
                              <h4 className="session-title">{latestSession.name}</h4>
                              <span className="session-time-text">
                                {new Date(latestSession.saved_at).toLocaleDateString("ja-JP")}{" "}
                                {new Date(latestSession.saved_at).toLocaleTimeString("ja-JP", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </div>
                            <span className="session-symbol-badge">{latestSession.settings.source_symbol}</span>
                          </div>

                          {/* プログレスバー */}
                          <div className="session-progress-bar-bg">
                            <div className="session-progress-bar-fill" style={{ width: `${progressPercent}%` }} />
                          </div>

                          <div className="session-meta-grid">
                            <div className="meta-item">
                              <span className="meta-label">進行状況:</span>
                              <span className="meta-val font-data">{progressPercent}%</span>
                            </div>
                            <div className="meta-item">
                              <span className="meta-label">仮想時刻:</span>
                              <span className="meta-val font-data">{jstTimeStr.substring(5, 16)}</span>
                            </div>
                            <div className="meta-item">
                              <span className="meta-label">口座残高:</span>
                              <span className="meta-val font-data text-accent">{balanceStr}</span>
                            </div>
                          </div>

                          <div className="session-footer-row">
                            {groupList.length > 1 ? (
                              <button
                                className="btn-text-subtle"
                                onClick={() => setExpandedGroups((prev) => ({ ...prev, [gid]: !prev[gid] }))}
                              >
                                <span className="material-symbols-outlined icon">
                                  {isExpanded ? "expand_less" : "expand_more"}
                                </span>
                                {isExpanded ? "履歴を閉じる" : `履歴スナップショット (${groupList.length - 1}件)`}
                              </button>
                            ) : (
                              <div />
                            )}

                            <div className="session-btn-group">
                              <button
                                className="btn-danger-compact"
                                onClick={() =>
                                  handleDeleteSessions(
                                    groupList.map((s) => s.id),
                                    `このセッション（全 ${groupList.length} 件）を削除しますか？`
                                  )
                                }
                                title="セッションを削除"
                              >
                                <span className="material-symbols-outlined icon">delete</span>
                              </button>
                              <button
                                className="btn-resume-spacious"
                                onClick={() => handleResumeSession(latestSession)}
                              >
                                <span className="material-symbols-outlined icon">play_arrow</span>
                                このセッションを再開
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()
        )}
      </div>

      {/* 下部固定アクションバー */}
      {setupTab !== "resume" && (
        <div className="setup-bottom-action-bar-spacious">
          <div className="action-bar-left">
            <button
              type="button"
              className="btn-action-outline"
              onClick={handleResetReplaySettings}
              title="リプレイ期間・銘柄などのリプレイ設定を初期化"
            >
              <span className="material-symbols-outlined icon">restart_alt</span>
              <span>リプレイ初期化</span>
            </button>
            <button
              type="button"
              className="btn-action-outline"
              onClick={handleResetTradingSettings}
              title="仮想口座資金・レバレッジ・スプレッドなどの取引設定を初期化"
            >
              <span className="material-symbols-outlined icon">restart_alt</span>
              <span>取引初期化</span>
            </button>
            <button
              type="button"
              className="btn-action-outline"
              onClick={() => invoke("open_settings_window").catch(console.error)}
              title="システム環境設定を開く"
            >
              <span className="material-symbols-outlined icon">settings</span>
              <span>環境設定</span>
            </button>
            <button
              type="button"
              className="btn-action-outline"
              onClick={() => invoke("open_tracely_app").catch(console.error)}
              title="トレード分析アプリ Tracely を起動"
            >
              <span className="material-symbols-outlined icon text-indigo">analytics</span>
              <span>トレード分析</span>
            </button>
          </div>

          <div className="action-bar-right">
            {status === "DISCONNECTED" && (
              <button
                type="button"
                className="btn-start-replay-spacious waiting"
                onClick={handleCheckConnection}
              >
                <span className="material-symbols-outlined icon">sync</span>
                <span>EA接続を確認</span>
              </button>
            )}
            {status === "CONNECTED" && (
              <button
                type="button"
                className="btn-start-replay-spacious ready"
                onClick={handleInit}
              >
                <span className="material-symbols-outlined icon">rocket_launch</span>
                <span>リプレイ開始</span>
              </button>
            )}
            {(status === "READY" || status === "ACTIVE") && (
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  type="button"
                  className="btn-action-outline"
                  onClick={handleInit}
                  title="変更した設定でリプレイを再起動"
                >
                  <span className="material-symbols-outlined icon">restart_alt</span>
                  <span>設定適用・再開始</span>
                </button>
                <button
                  type="button"
                  className="btn-start-replay-spacious ready"
                  onClick={() => invoke("open_controller_window").catch(console.error)}
                  title="モニター2のリプレイ操作コントローラーを表示"
                >
                  <span className="material-symbols-outlined icon">open_in_new</span>
                  <span>操作コントローラーを表示 (モニター2)</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const SetupPanel = React.memo(SetupPanelComponent, areSetupPanelPropsEqual);

