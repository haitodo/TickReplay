import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { CustomSelect } from "../../CustomSelect";
import { SymbolItem } from "../SymbolCombobox";
import { SymbolTagInput } from "../SymbolTagInput";
import { HelpTooltip } from "../HelpTooltip";
import { parseSymbolName, findDefaultDualFeedPair } from "../../utils/symbolUtils";
import { TerminalInfo } from "../../types/terminal";
import { MaxBarsInfo } from "../../utils/hotkeyUtils";
import { formatJstTime, getNewsTimeForDisplay } from "../../utils/timeUtils";
import { getMonthRange, getYearRange, shiftDateRangeByMonth, parseDateTimeStr } from "../../utils/dateUtils";

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
  savedSessions: any[];
  expandedGroups: { [key: string]: boolean };
  setExpandedGroups: React.Dispatch<React.SetStateAction<{ [key: string]: boolean }>>;
  handleClearAllSessions: () => void;
  handleDeleteSessions: (ids: string[], msg: string) => void;
  handleResumeSession: (session: any) => void;
  loadSavedSessions: () => void;
  handleResetReplaySettings: () => void;
  handleResetTradingSettings: () => void;
  handleCheckConnection: () => void;
  handleInit: () => void;
}

export const SetupPanel: React.FC<SetupPanelProps> = ({
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

  // 1Lot証拠金・Pip価値・最大ロット計算
  const estRate = sourceSymbol.toUpperCase().includes("JPY") ? 150 : 1.0;
  const levSafe = leverage > 0 ? leverage : 25;
  const reqMarginPerLot = Math.round((estRate * contractSize) / levSafe);
  const pipValue = Math.round(0.01 * contractSize);
  const maxLots = reqMarginPerLot > 0 ? ((initialBalance / reqMarginPerLot) || 0).toFixed(1) : "0.0";

  // 日時解析および月別クイック選択用の表示年ステート
  const parsedStart = parseDateTimeStr(startTime);
  const [viewYear, setViewYear] = React.useState<number>(() => parsedStart.year || 2024);

  React.useEffect(() => {
    if (parsedStart.year && parsedStart.year !== viewYear) {
      setViewYear(parsedStart.year);
    }
  }, [parsedStart.year]);

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
          <span>リプレイ &amp; 取引設定ダッシュボード</span>
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
          /* ======================================================== */
          /* 2カラム ダッシュボードレイアウト                         */
          /* ======================================================== */
          <div className="setup-2col-layout">
            {/* ---------------- 左カラム (接続・銘柄・期間) ---------------- */}
            <div className="setup-column">
              {/* カード1: MT5接続 & プロファイル */}
              <div className="setup-card-dashboard">
                <div className="card-header-dashboard">
                  <div className="header-title-wrapper">
                    <span className="material-symbols-outlined header-icon">settings_ethernet</span>
                    <span className="header-title">MT5接続 &amp; チャート設定</span>
                  </div>
                  {maxBarsInfo && (
                    <div className="max-bars-badge-top">
                      {maxBarsInfo.is_unlimited ? (
                        <span className="max-bars-pill unlimited" title="チャート最大バー数は無制限に設定されています">
                          <span className="material-symbols-outlined icon">check_circle</span>
                          Unlimited
                        </span>
                      ) : (
                        <span className="max-bars-pill limited" title="チャート最大バー数に制限があります">
                          <span className="material-symbols-outlined icon">warning</span>
                          {maxBarsInfo.max_bars > 0 ? `${maxBarsInfo.max_bars.toLocaleString()}本` : "制限あり"}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="card-body-dashboard">
                  <div className="form-group-compact">
                    <div className="label-row">
                      <label className="form-label-compact">
                        MT5ターミナル
                        <HelpTooltip
                          title="MT5ターミナル"
                          content="リプレイ連携を行うMetaTrader 5の実行環境を選択します。EAが配置されているターミナルを指定してください。"
                        />
                      </label>
                      {selectedTerminal && (
                        <button
                          type="button"
                          className="btn-text-accent"
                          onClick={handleOpenTerminalNameModal}
                          title="選択中のMT5ターミナルに別名を設定"
                        >
                          <span className="material-symbols-outlined icon">edit_note</span>
                          名前を変更
                        </button>
                      )}
                    </div>
                    <CustomSelect
                      value={selectedTerminal}
                      onChange={setSelectedTerminal}
                      options={
                        terminals.length > 0
                          ? terminals.map((t) => {
                              const displayTitle = t.custom_name || t.name;
                              const subText = t.origin_path || (t.id ? `ID: ${t.id}` : "");
                              return {
                                value: t.path,
                                triggerLabel: displayTitle,
                                label: (
                                  <div style={{ display: "flex", flexDirection: "column", gap: "1px", width: "100%", overflow: "hidden" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                      <span style={{ fontWeight: 600 }}>{displayTitle}</span>
                                      {t.custom_name && t.default_name && (
                                        <span style={{ fontSize: "10px", color: "var(--on-surface-variant)", opacity: 0.8 }}>
                                          ({t.default_name})
                                        </span>
                                      )}
                                    </div>
                                    {subText && (
                                      <span style={{ fontSize: "9px", color: "var(--on-surface-variant)", opacity: 0.65, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {subText}
                                      </span>
                                    )}
                                  </div>
                                ),
                              };
                            })
                          : [{ value: "", label: "No Terminals Found" }]
                      }
                    />
                  </div>

                  <div className="form-group-compact">
                    <label className="form-label-compact">
                      チャートプロファイル (.chr)
                      <HelpTooltip
                        title="チャートプロファイル"
                        content="リプレイ開始時にMT5側で自動的に読み込まれるチャートの組表示テンプレートを選択します。"
                      />
                    </label>
                    <CustomSelect
                      value={selectedProfile}
                      onChange={setSelectedProfile}
                      options={profiles.map((p) => ({ value: p, label: p }))}
                    />
                  </div>
                </div>
              </div>

              {/* カード2: 検証銘柄 & デュアルフィード */}
              <div className="setup-card-dashboard">
                <div className="card-header-dashboard">
                  <div className="header-title-wrapper">
                    <span className="material-symbols-outlined header-icon">candlestick_chart</span>
                    <span className="header-title">検証銘柄 &amp; デュアルフィード</span>
                  </div>
                  <div className="header-actions-group">
                    <button
                      type="button"
                      className="btn-text-accent"
                      onClick={() => setIsCustomImportOpen(true)}
                      title="カスタムシンボル作成・インポート"
                    >
                      <span className="material-symbols-outlined icon">upload_file</span>
                      インポート
                    </button>
                    <button
                      type="button"
                      className="btn-text-accent"
                      onClick={handleOpenSelector}
                      title="シンボル選択セレクターウィンドウを開く"
                    >
                      <span className="material-symbols-outlined icon">tune</span>
                      セレクター
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
                            // デュアルフィード有効化時: Main=OANDA, Sub=DUCASCOPY を自動初期選択
                            const defaultPair = findDefaultDualFeedPair(availableSymbols, sourceSymbol);
                            if (defaultPair) {
                              setSourceSymbol(defaultPair.mainSymbol);
                              setSubSourceSymbol(defaultPair.subSymbol);
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
                      padding: "8px 10px",
                      borderRadius: "6px",
                      backgroundColor: "var(--surface-container)",
                      border: "1px solid var(--outline-variant)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px"
                    }}
                  >
                    {enableDualFeed ? (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "6px", alignItems: "center" }}>
                        <div style={{ padding: "5px 8px", backgroundColor: "var(--surface-variant)", borderRadius: "4px", border: "1px solid var(--primary-color)" }}>
                          <span style={{ fontSize: "9px", color: "var(--primary-color)", fontWeight: 700, display: "block" }}>MAIN</span>
                          <span style={{ fontSize: "12px", fontWeight: 700, fontFamily: "var(--font-data)" }}>{sourceSymbol || "(未選択)"}</span>
                        </div>
                        <button
                          type="button"
                          className="btn-swap"
                          onClick={() => {
                            const temp = sourceSymbol;
                            setSourceSymbol(subSourceSymbol);
                            setSubSourceSymbol(temp);
                          }}
                          title="MainとSubの銘柄を入れ替え"
                          style={{ padding: "2px 6px", height: "24px" }}
                        >
                          <span className="material-symbols-outlined icon">swap_horiz</span>
                        </button>
                        <div style={{ padding: "5px 8px", backgroundColor: "var(--surface-variant)", borderRadius: "4px", border: "1px solid var(--secondary-color)" }}>
                          <span style={{ fontSize: "9px", color: "var(--secondary-color)", fontWeight: 700, display: "block" }}>SUB</span>
                          <span style={{ fontSize: "12px", fontWeight: 700, fontFamily: "var(--font-data)" }}>{subSourceSymbol || "(未選択)"}</span>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <span style={{ fontSize: "9.5px", color: "var(--on-surface-variant)", display: "block" }}>リプレイ対象銘柄</span>
                          <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--on-surface)", fontFamily: "var(--font-data)" }}>
                            {sourceSymbol || "USDJPY"}
                          </span>
                        </div>
                        {sourceSymbol && (
                          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                            {parseSymbolName(sourceSymbol).year && (
                              <span style={{ fontSize: "10px", padding: "1px 5px", borderRadius: "3px", backgroundColor: "rgba(var(--primary-rgb), 0.15)", color: "var(--primary-color)", fontWeight: 700 }}>
                                {parseSymbolName(sourceSymbol).year}年
                              </span>
                            )}
                            {parseSymbolName(sourceSymbol).broker && (
                              <span style={{ fontSize: "10px", padding: "1px 5px", borderRadius: "3px", backgroundColor: "var(--surface-container-high)", color: "var(--on-surface-variant)" }}>
                                {parseSymbolName(sourceSymbol).broker}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* セレクター起動ボタン */}
                    <button
                      type="button"
                      className="pro-btn primary"
                      onClick={handleOpenSelector}
                      style={{
                        width: "100%",
                        padding: "6px 10px",
                        fontSize: "11.5px",
                        fontWeight: 700,
                        backgroundColor: "var(--primary-color)",
                        color: "var(--on-primary, #fff)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                        borderRadius: "4px"
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: "15px" }}>tune</span>
                      <span>シンボル・比較ペアを選択 (セレクター)</span>
                    </button>
                  </div>

                  {/* 同期他通貨 (マルチ通貨リプレイ) */}
                  <div className="form-group-compact" style={{ marginTop: "4px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <label className="form-label-compact" style={{ margin: 0 }}>
                        同期他通貨 (マルチ通貨リプレイ)
                        <HelpTooltip
                          title="同期他通貨"
                          content="メイン銘柄と同時にリプレイ進行させるサブ銘柄です（相関ペアやドルストレートの同時監視用）。"
                        />
                      </label>
                      {additionalSymbols && (
                        <button
                          type="button"
                          className="btn-text-accent"
                          style={{ fontSize: "10px" }}
                          onClick={() => setAdditionalSymbols("")}
                        >
                          クリア
                        </button>
                      )}
                    </div>
                    <SymbolTagInput
                      value={additionalSymbols}
                      onChange={setAdditionalSymbols}
                      placeholder="カンマ区切りで入力 (例: EURUSD, GBPUSD)"
                      availableSymbols={availableSymbols}
                    />
                    {companionSymbols.length > 0 && (
                      <div className="companion-chips-container">
                        <span className="chips-label">検出:</span>
                        {companionSymbols.map((sym) => (
                          <button
                            key={sym}
                            type="button"
                            className="chip-btn"
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

              {/* カード3: 日時・プリロード設定 */}
              <div className="setup-card-dashboard">
                <div className="card-header-dashboard">
                  <div className="header-title-wrapper">
                    <span className="material-symbols-outlined header-icon">calendar_month</span>
                    <span className="header-title">リプレイ期間 &amp; プリロード</span>
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
                          onClick={() => {
                            const newYear = viewYear - 1;
                            setViewYear(newYear);
                            const range = getMonthRange(newYear, parsedStart.month);
                            setStartTime?.(range.start);
                            setEndTime?.(range.end);
                          }}
                          title="前年へ"
                        >
                          <span className="material-symbols-outlined icon">chevron_left</span>
                        </button>
                        <span className="year-label font-data">{viewYear}年</span>
                        <button
                          type="button"
                          className="month-step-btn"
                          onClick={() => {
                            const newYear = viewYear + 1;
                            setViewYear(newYear);
                            const range = getMonthRange(newYear, parsedStart.month);
                            setStartTime?.(range.start);
                            setEndTime?.(range.end);
                          }}
                          title="翌年へ"
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
                            setViewYear(newParsed.year);
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
                            setViewYear(newParsed.year);
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

                  {/* プリロード方式 */}
                  <div className="preload-grid">
                    <div className="form-group-compact">
                      <label className="form-label-compact">
                        過去チャート プリロード方式
                        <HelpTooltip
                          title="プリロード方式"
                          content="リプレイ開始直前の過去ローソク足をどう読み込むかを指定します。"
                        />
                      </label>
                      <CustomSelect
                        value={preloadMode}
                        onChange={(val) => setPreloadMode(val as "BARS" | "DATE")}
                        options={[
                          { value: "BARS", label: "過去バー本数指定" },
                          { value: "DATE", label: "過去日付指定" },
                        ]}
                      />
                    </div>

                    {preloadMode === "BARS" ? (
                      <div className="form-group-compact">
                        <label className="form-label-compact">読込バー本数 ({preloadTimeframe})</label>
                        <div style={{ display: "flex", gap: "4px" }}>
                          <CustomSelect
                            value={preloadTimeframe}
                            onChange={setPreloadTimeframe}
                            options={[
                              { value: "AUTO", label: "自動" },
                              { value: "M1", label: "M1" },
                              { value: "M5", label: "M5" },
                              { value: "M15", label: "M15" },
                              { value: "H1", label: "H1" },
                              { value: "D1", label: "D1" },
                            ]}
                          />
                          <input
                            type="number"
                            className="input-compact font-data"
                            style={{ width: "80px" }}
                            value={preloadedBars}
                            onChange={(e) => setPreloadedBars(parseInt(e.target.value) || 0)}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="form-group-compact">
                        <label className="form-label-compact">プリロード開始日時</label>
                        <div className="input-with-icon-compact" onClick={() => setActivePickerField("preload")}>
                          <input
                            type="text"
                            readOnly
                            className="input-compact cursor-pointer font-data"
                            value={timezoneMode === "JST" ? preloadDate : getNewsTimeForDisplay(preloadDate, "SERVER")}
                          />
                          <span className="material-symbols-outlined icon">calendar_today</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 高速シーク（履歴制限） */}
                  <div className="fast-seek-box">
                    <label className="toggle-switch-label">
                      <input
                        type="checkbox"
                        checked={limitTickHistory}
                        onChange={(e) => setLimitTickHistory(e.target.checked)}
                      />
                      <span className="switch-text">直近ティック履歴制限（高速シーク・メモリ軽量化）</span>
                    </label>
                    {limitTickHistory && (
                      <div className="fast-seek-params">
                        <span className="params-label">保持範囲:</span>
                        <CustomSelect
                          value={tickHistoryTimeframe}
                          onChange={setTickHistoryTimeframe}
                          options={[
                            { value: "M1", label: "1分足" },
                            { value: "M5", label: "5分足" },
                            { value: "M15", label: "15分足" },
                            { value: "H1", label: "1時間足" },
                          ]}
                        />
                        <span className="params-label">×</span>
                        <input
                          type="number"
                          className="input-compact font-data"
                          style={{ width: "65px" }}
                          value={maxHistoryBars}
                          onChange={(e) => setMaxHistoryBars(parseInt(e.target.value) || 0)}
                        />
                        <span className="params-label">本</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* ---------------- 右カラム (仮想口座・スプレッド・オプション) ---------------- */}
            <div className="setup-column">
              {/* カード4: 仮想口座 & 証拠金パラメータ */}
              <div className="setup-card-dashboard">
                <div className="card-header-dashboard">
                  <div className="header-title-wrapper">
                    <span className="material-symbols-outlined header-icon">account_balance</span>
                    <span className="header-title">仮想口座 &amp; 証拠金パラメータ</span>
                  </div>
                </div>

                <div className="card-body-dashboard">
                  <div className="form-group-compact">
                    <label className="form-label-compact">
                      初期口座資金 (JPY)
                      <HelpTooltip
                        title="初期口座資金"
                        content="リプレイ開始時の仮想口座残高（日本円）を設定します。リプレイ中もポジション画面から追加入金や出金が可能です。"
                      />
                    </label>
                    <input
                      type="number"
                      className="input-compact font-data"
                      value={initialBalance}
                      onChange={(e) => setInitialBalance(parseInt(e.target.value) || 0)}
                    />
                  </div>

                  <div className="grid-2-col-compact">
                    <div className="form-group-compact">
                      <label className="form-label-compact">
                        レバレッジ (倍)
                        <HelpTooltip
                          title="レバレッジ"
                          content="口座の最大レバレッジ倍率です（国内FX標準は25倍、海外FX等は100〜500倍等）。"
                        />
                      </label>
                      <input
                        type="number"
                        className="input-compact font-data"
                        value={leverage}
                        onChange={(e) => setLeverage(parseInt(e.target.value) || 0)}
                      />
                    </div>
                    <div className="form-group-compact">
                      <label className="form-label-compact">
                        契約サイズ (通貨単位)
                        <HelpTooltip
                          title="契約サイズ (Contract Size)"
                          content="1.0ロットあたりの通貨単位です。国内業者や多くのミニ口座は10,000通貨、標準口座は100,000通貨です。"
                        />
                      </label>
                      <CustomSelect
                        value={contractSize.toString()}
                        onChange={(val) => setContractSize(parseInt(val) || 10000)}
                        options={[
                          { value: "1000", label: "1,000 (マイクロ)" },
                          { value: "10000", label: "10,000 (ミニ)" },
                          { value: "100000", label: "100,000 (スタンダード)" },
                        ]}
                      />
                    </div>
                  </div>

                  {/* 証拠金・Pip価値リアルタイム試算プレビュー */}
                  <div className="trading-calc-preview">
                    <div className="calc-row">
                      <span className="calc-label">1.0Lot 必要証拠金 ({sourceSymbol || "USDJPY"} 換算):</span>
                      <span className="calc-val font-data">{reqMarginPerLot.toLocaleString()} 円</span>
                    </div>
                    <div className="calc-row">
                      <span className="calc-label">1.0Lot 1Pip変動損益価値:</span>
                      <span className="calc-val font-data">{pipValue.toLocaleString()} 円 / Pip</span>
                    </div>
                    <div className="calc-row">
                      <span className="calc-label">最大発注可能ロット数 (余力全額):</span>
                      <span className="calc-val font-data text-accent">{maxLots} Lots</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* カード5: スプレッド方式 & コスト */}
              <div className="setup-card-dashboard">
                <div className="card-header-dashboard">
                  <div className="header-title-wrapper">
                    <span className="material-symbols-outlined header-icon">stacked_line_chart</span>
                    <span className="header-title">スプレッド方式 &amp; コスト設定</span>
                    <HelpTooltip
                      title="疑似スプレッドとは"
                      placement="auto"
                      iconSize={14}
                      content={
                        <div style={{ lineHeight: 1.7, fontSize: "12px" }}>
                          <p style={{ margin: "0 0 8px" }}>
                            MT5のヒストリカルデータはスプレッドが0や非常に小さい値になっていることがあります。
                            このオプションを有効にすると、国内ブローカーに近いリアルなスプレッドをシミュレートできます。
                          </p>
                          <p style={{ margin: "0 0 6px", fontWeight: 600 }}>📐 計算式</p>
                          <p style={{ margin: "0 0 4px" }}>
                            <strong>MT5スプレッド ≦ 拡大しきい値 の場合：</strong><br />
                            <code style={{ background: "rgba(255,255,255,0.1)", padding: "1px 4px", borderRadius: 3 }}>
                              適用スプレッド = 平常時スプレッド
                            </code>
                          </p>
                          <p style={{ margin: "0" }}>
                            <strong>MT5スプレッド ＞ 拡大しきい値 の場合：</strong><br />
                            <code style={{ background: "rgba(255,255,255,0.1)", padding: "1px 4px", borderRadius: 3 }}>
                              適用スプレッド = 平常時スプレッド + 感度係数 × (MT5スプレッド − しきい値)
                            </code>
                          </p>
                        </div>
                      }
                      tip="指標発表などでMT5のスプレッドが急拡大した場合も、感度係数で国内業者風に穏やかに反映できます。"
                    />
                  </div>
                </div>

                <div className="card-body-dashboard">
                  <label className="toggle-switch-label">
                    <input
                      type="checkbox"
                      checked={enablePseudoRate}
                      onChange={(e) => setEnablePseudoRate(e.target.checked)}
                    />
                    <span className="switch-text">国内ブローカー風 疑似スプレッド適用</span>
                  </label>

                  {enablePseudoRate ? (
                    <div className="pseudo-spread-grid">
                      <div className="form-group-compact">
                        <label className="form-label-compact" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          平常時スプレッド (Pips)
                          <HelpTooltip
                            title="平常時スプレッド"
                            placement="auto"
                            iconSize={12}
                            content={
                              <div style={{ lineHeight: 1.7, fontSize: "12px" }}>
                                <p style={{ margin: "0 0 6px" }}>
                                  MT5のスプレッドが「拡大しきい値」以下のとき（平常時）に適用される固定スプレッドです。
                                </p>
                                <p style={{ margin: "0 0 4px", fontWeight: 600 }}>推奨値の目安：</p>
                                <ul style={{ margin: "0", paddingLeft: 16 }}>
                                  <li>USDJPY：0.2〜0.3 pips</li>
                                  <li>EURUSD：0.3〜0.5 pips</li>
                                  <li>GBPJPY：0.8〜1.0 pips</li>
                                  <li>XAUUSD（Gold）：1.5〜2.0 pips</li>
                                </ul>
                              </div>
                            }
                          />
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          className="input-compact font-data"
                          value={pseudoBaseSpread}
                          onChange={(e) => setPseudoBaseSpread(parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div className="form-group-compact">
                        <label className="form-label-compact" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          拡大しきい値 (Pips)
                          <HelpTooltip
                            title="拡大しきい値"
                            placement="auto"
                            iconSize={12}
                            content={
                              <div style={{ lineHeight: 1.7, fontSize: "12px" }}>
                                <p style={{ margin: "0 0 6px" }}>
                                  MT5の生スプレッドがこの値を超えたとき、スプレッドの拡大計算が始まります。
                                  通常時のMT5スプレッドがこの値以下であれば、常に「平常時スプレッド」が適用されます。
                                </p>
                                <p style={{ margin: "0 0 4px", fontWeight: 600 }}>推奨値の目安：</p>
                                <ul style={{ margin: "0", paddingLeft: 16 }}>
                                  <li>USDJPY：1.5〜2.0 pips</li>
                                  <li>EURUSD：1.0〜1.5 pips</li>
                                  <li>GBPJPY：2.0〜3.0 pips</li>
                                  <li>XAUUSD（Gold）：4.0〜6.0 pips</li>
                                </ul>
                                <p style={{ margin: "6px 0 0", color: "var(--status-warning)" }}>
                                  ⚠️ 0に設定するとすべてのティックで拡大計算が適用されるため、スプレッドが常に広くなります。
                                </p>
                              </div>
                            }
                          />
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          className="input-compact font-data"
                          value={pseudoThreshold}
                          onChange={(e) => setPseudoThreshold(parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div className="form-group-compact" style={{ gridColumn: "span 2" }}>
                        <label className="form-label-compact" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          拡大感度係数 (0.0〜2.0)
                          <HelpTooltip
                            title="拡大感度係数"
                            placement="auto"
                            iconSize={12}
                            content={
                              <div style={{ lineHeight: 1.7, fontSize: "12px" }}>
                                <p style={{ margin: "0 0 6px" }}>
                                  MT5スプレッドが「拡大しきい値」を超えたとき、その超過分に掛ける倍率です。
                                </p>
                                <p style={{ margin: "0 0 4px" }}>
                                  <strong>例（USDJPY、しきい値=1.5pips、感度=1.025、MT5スプレッド=3.0pips）：</strong><br />
                                  <code style={{ background: "rgba(255,255,255,0.1)", padding: "1px 4px", borderRadius: 3 }}>
                                    0.2 + 1.025 × (3.0 − 1.5) ≈ 1.74 pips
                                  </code>
                                </p>
                                <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>
                                  <li><strong>1.0</strong>：MT5スプレッド急拡大をそのまま反映</li>
                                  <li><strong>1.025</strong>：推奨値。わずかに上乗せして穏やかに拡大</li>
                                  <li><strong>0.5未満</strong>：急拡大の影響を大幅に抑制</li>
                                  <li><strong>0.0</strong>：急拡大しても平常時スプレッドのまま</li>
                                </ul>
                              </div>
                            }
                          />
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="2"
                          className="input-compact font-data"
                          value={pseudoSensitivity}
                          onChange={(e) => setPseudoSensitivity(parseFloat(e.target.value) || 0)}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="spread-disabled-hint">
                      <span className="material-symbols-outlined icon">info</span>
                      <span>ヒストリカルデータに記録されている生のBid/Askスプレッドをそのまま適用します。</span>
                    </div>
                  )}
                </div>
              </div>

              {/* カード6: 表示 & 同期オプション */}
              <div className="setup-card-dashboard">
                <div className="card-header-dashboard">
                  <div className="header-title-wrapper">
                    <span className="material-symbols-outlined header-icon">settings_suggest</span>
                    <span className="header-title">表示 &amp; 同期オプション</span>
                  </div>
                </div>

                <div className="card-body-dashboard">
                  <div className="options-checkbox-grid">
                    <label className="checkbox-compact">
                      <input
                        type="checkbox"
                        checked={autoScrollSync}
                        onChange={(e) => setAutoScrollSync(e.target.checked)}
                      />
                      <div className="checkbox-text-group">
                        <span className="cb-title">チャート自動追従スクロール</span>
                        <span className="cb-desc">再生に合わせてMT5チャートを自動で右端へスクロール</span>
                      </div>
                    </label>
                    <label className="checkbox-compact">
                      <input
                        type="checkbox"
                        checked={autoSkipWeekend}
                        onChange={(e) => setAutoSkipWeekend(e.target.checked)}
                      />
                      <div className="checkbox-text-group">
                        <span className="cb-title">土日休場スキップ</span>
                        <span className="cb-desc">時間比率モード時にティックのない週末を自動スキップ</span>
                      </div>
                    </label>
                  </div>
                </div>
              </div>

              {/* カード7: 執行ルール情報 */}
              <div className="setup-card-dashboard">
                <div className="card-header-dashboard">
                  <div className="header-title-wrapper">
                    <span className="material-symbols-outlined header-icon">gavel</span>
                    <span className="header-title">リプレイ仮想取引ルール</span>
                  </div>
                </div>

                <div className="card-body-dashboard">
                  <div className="rules-mini-list">
                    <div className="rule-item">
                      <span className="material-symbols-outlined icon text-green">check_circle</span>
                      <span><strong>バー内ティック即時約定:</strong> MT5チャートと1ms単位で完全同期</span>
                    </div>
                    <div className="rule-item">
                      <span className="material-symbols-outlined icon text-cyan">check_circle</span>
                      <span><strong>指値/逆指値自動判定:</strong> TP/SLヒット時に瞬時に自動決済</span>
                    </div>
                    <div className="rule-item">
                      <span className="material-symbols-outlined icon text-indigo">check_circle</span>
                      <span><strong>スピード発注・ホットキー連携:</strong> 成行・ドテン・全決済に完全対応</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ======================================================== */
          /* 3. セッション再開タブ (広々カードグリッド)               */
          /* ======================================================== */
          (() => {
            const groupedSessions: { [key: string]: any[] } = {};
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
