import React from "react";
import { CustomSelect } from "../../CustomSelect";
import { SymbolCombobox, SymbolItem } from "../SymbolCombobox";
import { SymbolTagInput } from "../SymbolTagInput";
import { HelpTooltip } from "../HelpTooltip";
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
  return (
    <div className="setup-container-compact">
      {/* 上部：セグメントタブバー */}
      <div className="setup-tab-bar">
        <button
          type="button"
          className={`setup-tab-btn ${setupTab === "replay" ? "active" : ""}`}
          onClick={() => setSetupTab("replay")}
        >
          <span className="material-symbols-outlined icon">tune</span>
          <span>リプレイ設定</span>
        </button>
        <button
          type="button"
          className={`setup-tab-btn ${setupTab === "trading" ? "active" : ""}`}
          onClick={() => setSetupTab("trading")}
        >
          <span className="material-symbols-outlined icon">payments</span>
          <span>取引設定</span>
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

      {/* スクロール可能なメイン設定ボディ */}
      <div className="setup-scroll-body">
        {/* ======================================================== */}
        {/* 1. リプレイ設定タブ                                    */}
        {/* ======================================================== */}
        {setupTab === "replay" && (
          <div className="setup-card-stack">
            {/* カードA: MT5接続 & プロファイル */}
            <div className="setup-card-compact">
              <div className="card-header-compact">
                <span className="material-symbols-outlined header-icon">settings_ethernet</span>
                <span className="header-title">MT5接続 &amp; チャート設定</span>
              </div>
              <div className="card-body-compact">
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

                <div className="form-group-compact max-bars-row">
                  <span className="form-label-compact">
                    チャートの最大バー数
                    <HelpTooltip
                      title="チャートの最大バー数 (MT5設定)"
                      content="MT5側で描画を許可する最大バー数です。過去検証時に長期インジケータ（200MA等）を正確に表示するため「Unlimited (無制限)」が推奨されます。"
                    />
                  </span>
                  {maxBarsInfo ? (
                    maxBarsInfo.is_unlimited ? (
                      <span className="max-bars-pill unlimited">
                        <span className="material-symbols-outlined icon">check_circle</span>
                        Unlimited (無制限)
                      </span>
                    ) : (
                      <span className="max-bars-pill limited">
                        <span className="material-symbols-outlined icon">warning</span>
                        {maxBarsInfo.max_bars > 0 ? `${maxBarsInfo.max_bars.toLocaleString()}本` : "制限あり"}
                      </span>
                    )
                  ) : (
                    <span className="max-bars-pill loading">確認中...</span>
                  )}
                </div>
              </div>
            </div>

            {/* カードB: 銘柄 & フィード設定 */}
            <div className="setup-card-compact">
              <div className="card-header-compact">
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span className="material-symbols-outlined header-icon">candlestick_chart</span>
                  <span className="header-title">検証銘柄 &amp; デュアルフィード</span>
                </div>
                <div style={{ display: "flex", gap: "6px" }}>
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
                    onClick={() => setIsBatchSelectorOpen(true)}
                    title="年・ブローカー別マトリクスダイアログを開く"
                  >
                    <span className="material-symbols-outlined icon">tune</span>
                    セレクター
                  </button>
                </div>
              </div>

              <div className="card-body-compact">
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

                {enableDualFeed ? (
                  <div className="dual-symbol-grid">
                    <div className="form-group-compact">
                      <label className="form-label-compact text-cyan">Main シンボル</label>
                      <SymbolCombobox
                        value={sourceSymbol}
                        onChange={setSourceSymbol}
                        availableSymbols={availableSymbols}
                        placeholder="メイン銘柄 (例: USDJPY_2026)"
                      />
                    </div>
                    <div style={{ display: "flex", justifyContent: "center", margin: "2px 0" }}>
                      <button
                        type="button"
                        className="btn-swap"
                        onClick={() => {
                          const temp = sourceSymbol;
                          setSourceSymbol(subSourceSymbol);
                          setSubSourceSymbol(temp);
                        }}
                        title="MainとSubの銘柄を入れ替え"
                      >
                        <span className="material-symbols-outlined icon">swap_vert</span>
                        <span>Main / Sub 入れ替え</span>
                      </button>
                    </div>
                    <div className="form-group-compact">
                      <label className="form-label-compact text-indigo">Sub シンボル</label>
                      <SymbolCombobox
                        value={subSourceSymbol}
                        onChange={setSubSourceSymbol}
                        availableSymbols={availableSymbols}
                        placeholder="比較銘柄 (例: USDJPY_ECN_2026)"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="form-group-compact">
                    <label className="form-label-compact">
                      リプレイ対象銘柄
                      <HelpTooltip
                        title="リプレイ銘柄"
                        content="検証対象となるリアル銘柄名（またはカスタムシンボル名）を選択・入力します。"
                      />
                    </label>
                    <SymbolCombobox
                      value={sourceSymbol}
                      onChange={setSourceSymbol}
                      availableSymbols={availableSymbols}
                      placeholder="銘柄名 (例: USDJPY, EURUSD)"
                    />
                  </div>
                )}

                {/* 同期他通貨ペア (コンパニオンシンボル) */}
                <div className="form-group-compact" style={{ marginTop: "4px" }}>
                  <label className="form-label-compact">
                    同期他通貨 (マルチ通貨リプレイ)
                    <HelpTooltip
                      title="同期他通貨"
                      content="メイン銘柄と同時にリプレイ進行させるサブ銘柄です（相関ペアやドルストレートの同時監視用）。"
                    />
                  </label>
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

            {/* カードC: 日時・プリロード設定 */}
            <div className="setup-card-compact">
              <div className="card-header-compact">
                <span className="material-symbols-outlined header-icon">calendar_month</span>
                <span className="header-title">リプレイ期間 &amp; プリロード</span>
              </div>
              <div className="card-body-compact">
                <div className="date-range-grid">
                  <div className="form-group-compact">
                    <label className="form-label-compact">開始日時 ({timezoneMode})</label>
                    <div className="input-with-icon-compact" onClick={() => setActivePickerField("start")}>
                      <input
                        type="text"
                        readOnly
                        className="input-compact cursor-pointer"
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
                        className="input-compact cursor-pointer"
                        value={timezoneMode === "JST" ? endTime : getNewsTimeForDisplay(endTime, "SERVER")}
                      />
                      <span className="material-symbols-outlined icon">event_available</span>
                    </div>
                  </div>
                </div>

                {/* プリロード詳細 */}
                <div className="preload-grid">
                  <div className="form-group-compact">
                    <label className="form-label-compact">
                      プリロード方式
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
                      <label className="form-label-compact">
                        読込バー本数 ({preloadTimeframe})
                      </label>
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
                          className="input-compact"
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
                          className="input-compact cursor-pointer"
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
                    <span className="switch-text">
                      直近ティック履歴制限（高速シーク・メモリ軽量化）
                    </span>
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
                        className="input-compact"
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

            {/* カードD: 表示・同期オプション */}
            <div className="setup-card-compact">
              <div className="card-header-compact">
                <span className="material-symbols-outlined header-icon">settings_suggest</span>
                <span className="header-title">表示 &amp; 同期オプション</span>
              </div>
              <div className="card-body-compact">
                <div className="options-checkbox-grid">
                  <label className="checkbox-compact">
                    <input
                      type="checkbox"
                      checked={autoScrollSync}
                      onChange={(e) => setAutoScrollSync(e.target.checked)}
                    />
                    <span>チャート自動追従スクロール</span>
                  </label>
                  <label className="checkbox-compact">
                    <input
                      type="checkbox"
                      checked={autoSkipWeekend}
                      onChange={(e) => setAutoSkipWeekend(e.target.checked)}
                    />
                    <span>土日休場スキップ</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* 2. 取引設定タブ                                        */}
        {/* ======================================================== */}
        {setupTab === "trading" && (
          <div className="setup-card-stack">
            <div className="setup-card-compact">
              <div className="card-header-compact">
                <span className="material-symbols-outlined header-icon">account_balance</span>
                <span className="header-title">仮想口座 &amp; 証拠金パラメータ</span>
              </div>
              <div className="card-body-compact">
                <div className="form-group-compact">
                  <label className="form-label-compact">初期資金 (JPY)</label>
                  <input
                    type="number"
                    className="input-compact font-data"
                    value={initialBalance}
                    onChange={(e) => setInitialBalance(parseInt(e.target.value) || 0)}
                  />
                </div>

                <div className="grid-2-col-compact">
                  <div className="form-group-compact">
                    <label className="form-label-compact">レバレッジ (倍)</label>
                    <input
                      type="number"
                      className="input-compact font-data"
                      value={leverage}
                      onChange={(e) => setLeverage(parseInt(e.target.value) || 0)}
                    />
                  </div>
                  <div className="form-group-compact">
                    <label className="form-label-compact">契約サイズ (通貨単位)</label>
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
              </div>
            </div>

            {/* スプレッド設定 */}
            <div className="setup-card-compact">
              <div className="card-header-compact">
                <span className="material-symbols-outlined header-icon">stacked_line_chart</span>
                <span className="header-title">スプレッド方式 &amp; コスト</span>
              </div>
              <div className="card-body-compact">
                <label className="toggle-switch-label">
                  <input
                    type="checkbox"
                    checked={enablePseudoRate}
                    onChange={(e) => setEnablePseudoRate(e.target.checked)}
                  />
                  <span className="switch-text">国内ブローカー風 疑似スプレッド適用</span>
                </label>

                {enablePseudoRate && (
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
                    <div className="form-group-compact">
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
                )}
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* 3. セッション再開タブ                                  */}
        {/* ======================================================== */}
        {setupTab === "resume" && (() => {
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
            <div className="resume-sessions-stack">
              {savedSessions.length > 0 && (
                <div className="resume-header-actions">
                  <span className="session-count-text">保存済み: {savedSessions.length}件</span>
                  <button
                    className="btn-danger-compact"
                    onClick={handleClearAllSessions}
                  >
                    <span className="material-symbols-outlined icon">delete_sweep</span>
                    全削除
                  </button>
                </div>
              )}

              {savedSessions.length === 0 ? (
                <div className="no-sessions-card">
                  <span className="material-symbols-outlined empty-icon">drafts</span>
                  <p>保存されたセッションはありません</p>
                </div>
              ) : (
                sortedGroupIds.map((gid) => {
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
                    <div key={gid} className="session-card-compact">
                      <div className="session-top-row">
                        <div className="session-title-group">
                          <h4 className="session-title">{latestSession.name}</h4>
                          <span className="session-time-text">
                            {new Date(latestSession.saved_at).toLocaleDateString("ja-JP")}{" "}
                            {new Date(latestSession.saved_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <span className="session-symbol-badge">
                          {latestSession.settings.source_symbol}
                        </span>
                      </div>

                      {/* プログレスバー */}
                      <div className="session-progress-bar-bg">
                        <div
                          className="session-progress-bar-fill"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>

                      <div className="session-meta-grid">
                        <div className="meta-item">
                          <span className="meta-label">進行:</span>
                          <span className="meta-val font-data">{progressPercent}%</span>
                        </div>
                        <div className="meta-item">
                          <span className="meta-label">仮想時刻:</span>
                          <span className="meta-val font-data">{jstTimeStr.substring(5, 16)}</span>
                        </div>
                        <div className="meta-item">
                          <span className="meta-label">残高:</span>
                          <span className="meta-val font-data">{balanceStr}</span>
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
                            {isExpanded ? "履歴を閉じる" : `履歴 (${groupList.length - 1}件)`}
                          </button>
                        ) : <div />}

                        <div className="session-btn-group">
                          <button
                            className="btn-danger-compact"
                            onClick={() =>
                              handleDeleteSessions(
                                groupList.map((s) => s.id),
                                `このセッション（全 ${groupList.length} 件）を削除しますか？`
                              )
                            }
                          >
                            <span className="material-symbols-outlined icon">delete</span>
                          </button>
                          <button
                            className="btn-resume-compact"
                            onClick={() => handleResumeSession(latestSession)}
                          >
                            <span className="material-symbols-outlined icon">play_arrow</span>
                            再開
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          );
        })()}
      </div>

      {/* 下部固定アクションバー */}
      {setupTab !== "resume" && (
        <div className="setup-bottom-action-bar">
          <button
            type="button"
            className="btn-reset-defaults"
            onClick={setupTab === "replay" ? handleResetReplaySettings : handleResetTradingSettings}
            title="設定をデフォルトに戻す"
          >
            <span className="material-symbols-outlined icon">restart_alt</span>
          </button>
          <button
            type="button"
            className={`btn-start-replay ${status === "DISCONNECTED" ? "waiting" : "ready"}`}
            onClick={status === "DISCONNECTED" ? handleCheckConnection : handleInit}
          >
            <span className="material-symbols-outlined icon">
              {status === "DISCONNECTED" ? "sync" : "rocket_launch"}
            </span>
            <span>{status === "DISCONNECTED" ? "EA接続を確認 (Click to Refresh)" : "リプレイ開始"}</span>
          </button>
        </div>
      )}
    </div>
  );
};
