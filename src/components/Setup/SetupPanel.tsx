import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { CustomSelect } from "../../CustomSelect";
import { SymbolItem } from "../SymbolCombobox";
import { SymbolTagInput } from "../SymbolTagInput";
import { HelpTooltip } from "../HelpTooltip";
import { parseSymbolName } from "../../utils/symbolUtils";
import { TerminalInfo } from "../../types/terminal";
import { MaxBarsInfo } from "../../utils/hotkeyUtils";
import { formatJstTime, getNewsTimeForDisplay } from "../../utils/timeUtils";

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
  endTime: string;
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
  endTime,
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
                        onChange={(e) => setEnableDualFeed(e.target.checked)}
                      />
                      <span className="switch-text">デュアルフィード比較 (Main vs Sub)</span>
                    </label>
                  </div>

                  {/* 選択中シンボルサマリー ＆ セレクター起動カード */}
                  <div
                    style={{
                      padding: "8px 10px",
                      borderRadius: "6px",
                      backgroundColor: "var(--surface-container, #1f1f26)",
                      border: "1px solid var(--outline-variant, #2d2d34)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px"
                    }}
                  >
                    {enableDualFeed ? (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "6px", alignItems: "center" }}>
                        <div style={{ padding: "5px 8px", backgroundColor: "rgba(0,0,0,0.25)", borderRadius: "4px", border: "1px solid var(--primary, #4f46e5)" }}>
                          <span style={{ fontSize: "9px", color: "var(--primary, #a5b4fc)", fontWeight: 700, display: "block" }}>MAIN</span>
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
                        <div style={{ padding: "5px 8px", backgroundColor: "rgba(0,0,0,0.25)", borderRadius: "4px", border: "1px solid var(--tertiary, #06b6d4)" }}>
                          <span style={{ fontSize: "9px", color: "var(--tertiary, #67e8f9)", fontWeight: 700, display: "block" }}>SUB</span>
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
                              <span style={{ fontSize: "10px", padding: "1px 5px", borderRadius: "3px", backgroundColor: "rgba(96, 165, 250, 0.15)", color: "#60a5fa" }}>
                                {parseSymbolName(sourceSymbol).year}年
                              </span>
                            )}
                            {parseSymbolName(sourceSymbol).broker && (
                              <span style={{ fontSize: "10px", padding: "1px 5px", borderRadius: "3px", backgroundColor: "rgba(255, 255, 255, 0.05)", color: "var(--on-surface-variant)" }}>
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
                        padding: "5px 10px",
                        fontSize: "11px",
                        fontWeight: 600,
                        backgroundColor: "var(--primary, #4f46e5)",
                        color: "#fff",
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
                        <label className="form-label-compact">平常時スプレッド (Pips)</label>
                        <input
                          type="number"
                          step="0.001"
                          className="input-compact font-data"
                          value={pseudoBaseSpread}
                          onChange={(e) => setPseudoBaseSpread(parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div className="form-group-compact">
                        <label className="form-label-compact">拡大しきい値</label>
                        <input
                          type="number"
                          step="0.001"
                          className="input-compact font-data"
                          value={pseudoThreshold}
                          onChange={(e) => setPseudoThreshold(parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div className="form-group-compact" style={{ gridColumn: "span 2" }}>
                        <label className="form-label-compact">拡大感度係数 (0.0〜2.0)</label>
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
              <span>トレード分析 (Tracely)</span>
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
                <span>EA接続を確認 (Click to Refresh)</span>
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
