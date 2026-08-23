import React from "react";
import { CustomSelect } from "../../CustomSelect";
import { DEFAULT_HOTKEYS, HOTKEY_METADATA, formatShortcutForDisplay } from "../../utils/hotkeyUtils";
import { THEME_LIST, ThemeType } from "../../constants/themePresets";
import { ApiTestResult } from "../../utils/apiKeyTester";

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: "general" | "hotkeys" | "theme" | "ai";
  setActiveTab: (tab: "general" | "hotkeys" | "theme" | "ai") => void;
  recordingAction: string | null;
  setRecordingAction: (action: string | null) => void;
  hotkeys: Record<string, string>;
  handleResetAllHotkeys: () => void;
  handleClearHotkey: (actionKey: string) => void;
  limitTickHistory: boolean;
  setLimitTickHistory: (val: boolean) => void;
  tickHistoryTimeframe: string;
  setTickHistoryTimeframe: (val: string) => void;
  maxHistoryBars: number;
  setMaxHistoryBars: (val: number) => void;
  autoScrollSync: boolean;
  setAutoScrollSync: (val: boolean) => void;
  autoSkipWeekend: boolean;
  handleAutoSkipWeekendToggle: (val: boolean) => void;
  alwaysOnTop: boolean;
  handleAlwaysOnTopToggle: () => void;
  isShortcutsActive: boolean;
  handleShortcutsToggle: () => void;
  theme?: ThemeType;
  setTheme?: (theme: ThemeType) => void;
  themeId?: string;
  setThemeId?: (id: string) => void;
  themeMode?: "dark" | "light";
  plColorStyle: "red-blue" | "green-red";
  setPlColorStyle: (val: "red-blue" | "green-red") => void;
  openRouterApiKey: string;
  setOpenRouterApiKey: (val: string) => void;
  openRouterModel: string;
  setOpenRouterModel: (val: string) => void;
  fredApiKey: string;
  setFredApiKey: (val: string) => void;
  finnhubApiKey: string;
  setFinnhubApiKey: (val: string) => void;
  openRouterTestResult: ApiTestResult;
  fredTestResult: ApiTestResult;
  finnhubTestResult: ApiTestResult;
  gdeltTestResult: ApiTestResult;
  isTestingAllApis: boolean;
  handleTestOpenRouter: () => void;
  handleTestFred: () => void;
  handleTestFinnhub: () => void;
  handleTestGdelt: () => void;
  handleTestAllApis: () => void;
  saveAllSettings: (
    nextHotkeys?: Record<string, string>,
    nextTimePresets?: number[],
    nextTickPresets?: number[],
    nextTheme?: any
  ) => void;
  timePresets: number[];
  tickPresets: number[];
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  activeTab,
  setActiveTab,
  recordingAction,
  setRecordingAction,
  hotkeys,
  handleResetAllHotkeys,
  handleClearHotkey,
  limitTickHistory,
  setLimitTickHistory,
  tickHistoryTimeframe,
  setTickHistoryTimeframe,
  maxHistoryBars,
  setMaxHistoryBars,
  autoScrollSync,
  setAutoScrollSync,
  autoSkipWeekend,
  handleAutoSkipWeekendToggle,
  alwaysOnTop,
  handleAlwaysOnTopToggle,
  isShortcutsActive,
  handleShortcutsToggle,
  theme,
  setTheme,
  themeId,
  setThemeId,
  plColorStyle,
  setPlColorStyle,
  openRouterApiKey,
  setOpenRouterApiKey,
  openRouterModel,
  setOpenRouterModel,
  fredApiKey,
  setFredApiKey,
  finnhubApiKey,
  setFinnhubApiKey,
  openRouterTestResult,
  fredTestResult,
  finnhubTestResult,
  gdeltTestResult,
  isTestingAllApis,
  handleTestOpenRouter,
  handleTestFred,
  handleTestFinnhub,
  handleTestGdelt,
  handleTestAllApis,
  saveAllSettings,
  timePresets,
  tickPresets,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      onClick={() => {
        if (!recordingAction) onClose();
      }}
    >
      <div className="modal-container settings-sheet" onClick={(e) => e.stopPropagation()}>
        {/* ヘッダー */}
        <div className="modal-header">
          <h3 className="modal-title">
            <span className="material-symbols-outlined icon-accent">settings</span>
            システム &amp; 操作設定
          </h3>
          <button
            className="modal-close-btn"
            onClick={() => {
              if (!recordingAction) onClose();
            }}
            disabled={!!recordingAction}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* タブナビゲーション */}
        <div className="modal-tabs">
          <button
            className={`modal-tab-btn ${activeTab === "general" ? "active" : ""}`}
            onClick={() => setActiveTab("general")}
          >
            <span className="material-symbols-outlined tab-icon">tune</span>
            一般設定
          </button>
          <button
            className={`modal-tab-btn ${activeTab === "hotkeys" ? "active" : ""}`}
            onClick={() => setActiveTab("hotkeys")}
          >
            <span className="material-symbols-outlined tab-icon">keyboard</span>
            ショートカット
          </button>
          <button
            className={`modal-tab-btn ${activeTab === "theme" ? "active" : ""}`}
            onClick={() => setActiveTab("theme")}
          >
            <span className="material-symbols-outlined tab-icon">palette</span>
            テーマ
          </button>
          <button
            className={`modal-tab-btn ${activeTab === "ai" ? "active" : ""}`}
            onClick={() => setActiveTab("ai")}
          >
            <span className="material-symbols-outlined tab-icon">auto_awesome</span>
            AI連携
          </button>
        </div>

        {/* タブボディ */}
        <div className="modal-body-scroll">
          {/* 1. 一般設定 */}
          {activeTab === "general" && (
            <div className="settings-section-stack">
              <div className="settings-group">
                <h4 className="settings-group-title">動作 &amp; 表示設定</h4>
                <div className="toggle-list">
                  <label className="toggle-switch-label">
                    <input
                      type="checkbox"
                      checked={autoScrollSync}
                      onChange={(e) => setAutoScrollSync(e.target.checked)}
                    />
                    <span className="switch-text">チャート自動スクロールを同期する</span>
                  </label>
                  <label className="toggle-switch-label">
                    <input
                      type="checkbox"
                      checked={autoSkipWeekend}
                      onChange={(e) => handleAutoSkipWeekendToggle(e.target.checked)}
                    />
                    <span className="switch-text">時間比率モード時に土日休場を自動スキップ</span>
                  </label>
                  <label className="toggle-switch-label">
                    <input
                      type="checkbox"
                      checked={alwaysOnTop}
                      onChange={handleAlwaysOnTopToggle}
                    />
                    <span className="switch-text">常に最前面に表示する (Pin)</span>
                  </label>
                  <label className="toggle-switch-label">
                    <input
                      type="checkbox"
                      checked={isShortcutsActive}
                      onChange={handleShortcutsToggle}
                    />
                    <span className="switch-text">グローバルショートカットキーを有効化</span>
                  </label>
                </div>
              </div>

              <div className="settings-group">
                <h4 className="settings-group-title">高速シーク・履歴制限デフォルト</h4>
                <label className="toggle-switch-label">
                  <input
                    type="checkbox"
                    checked={limitTickHistory}
                    onChange={(e) => setLimitTickHistory(e.target.checked)}
                  />
                  <span className="switch-text">直近ティック履歴の制限 (高速シーク)</span>
                </label>
                {limitTickHistory && (
                  <div className="fast-seek-params" style={{ marginTop: "8px" }}>
                    <span className="params-label">基準足:</span>
                    <CustomSelect
                      value={tickHistoryTimeframe}
                      onChange={setTickHistoryTimeframe}
                      options={[
                        { value: "M1", label: "1分足 (M1)" },
                        { value: "M5", label: "5分足 (M5)" },
                        { value: "M15", label: "15分足 (M15)" },
                        { value: "H1", label: "1時間足 (H1)" },
                      ]}
                    />
                    <span className="params-label">保持本数:</span>
                    <input
                      type="number"
                      className="input-compact font-data"
                      style={{ width: "70px" }}
                      value={maxHistoryBars}
                      onChange={(e) => setMaxHistoryBars(parseInt(e.target.value) || 0)}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 2. ショートカット設定 */}
          {activeTab === "hotkeys" && (
            <div className="settings-section-stack">
              <div className="hotkeys-header-row">
                <p className="settings-hint">
                  「録音」をクリック後、割り当てたいキーを押してください。
                </p>
                <button className="btn-danger-compact" onClick={handleResetAllHotkeys}>
                  <span className="material-symbols-outlined icon">restart_alt</span>
                  初期化
                </button>
              </div>

              <div className="hotkeys-list">
                {Object.keys(DEFAULT_HOTKEYS).map((actionKey) => {
                  const meta = HOTKEY_METADATA[actionKey] || { name: actionKey, desc: "" };
                  const currentKey = hotkeys[actionKey] || "";
                  const isRecording = recordingAction === actionKey;

                  return (
                    <div key={actionKey} className="hotkey-row">
                      <div className="hotkey-info">
                        <span className="hotkey-name">{meta.name}</span>
                        <span className="hotkey-desc">{meta.desc}</span>
                      </div>
                      <div className="hotkey-controls">
                        <button
                          className={`btn-record-key ${isRecording ? "recording" : ""}`}
                          onClick={() => {
                            if (isRecording) {
                              setRecordingAction(null);
                            } else {
                              setRecordingAction(actionKey);
                            }
                          }}
                        >
                          <span className="material-symbols-outlined icon">
                            {isRecording ? "keyboard_voice" : "keyboard"}
                          </span>
                          <span>{isRecording ? "入力待機中..." : formatShortcutForDisplay(currentKey)}</span>
                        </button>
                        <button
                          className="btn-clear-key"
                          onClick={() => handleClearHotkey(actionKey)}
                          disabled={!currentKey}
                          title="解除"
                        >
                          <span className="material-symbols-outlined icon">backspace</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 3. テーマ設定 */}
          {activeTab === "theme" && (
            <div className="settings-section-stack">
              <div className="theme-intro-header">
                <p className="theme-intro-text">
                  👀 <strong>眼精疲労軽減・視覚保護設計:</strong> 米国主要テック企業の最新デザインガイドラインに基づき、白文字の眩しさ（ハレーション）や過剰コントラストによる目の疲れ・チカチカを防止する最適な配色を採用しています。
                </p>
              </div>

              <div className="settings-group">
                <h4 className="settings-group-title">カラーテーマ選択 (5大プリセット)</h4>
                <div className="theme-cards-grid">
                  {THEME_LIST.map((themeItem) => {
                    const currentTheme = theme || themeId || "dark";
                    const isActive = currentTheme === themeItem.id;
                    return (
                      <div
                        key={themeItem.id}
                        className={`theme-card ${isActive ? "active" : ""}`}
                        onClick={() => {
                          if (setTheme) setTheme(themeItem.id);
                          else if (setThemeId) setThemeId(themeItem.id);
                          saveAllSettings(hotkeys, timePresets, tickPresets, themeItem.id);
                        }}
                      >
                        <div className="theme-card-header">
                          <div className="theme-card-title-group">
                            <span className="theme-icon">{themeItem.icon}</span>
                            <div>
                              <span className="theme-name">{themeItem.nameJa} ({themeItem.nameEn})</span>
                              <span className="theme-subname">{themeItem.subname}</span>
                            </div>
                          </div>
                          {isActive ? (
                            <span className="theme-badge active">✓ 適用中</span>
                          ) : (
                            <span className="theme-badge inactive">選択</span>
                          )}
                        </div>

                        {/* カラーパレットプレビュー */}
                        <div className="theme-swatch-bar">
                          <div className="swatch-item" title={`背景: ${themeItem.bgHex}`}>
                            <span className="swatch-circle" style={{ backgroundColor: themeItem.bgHex, border: "1px solid rgba(128,128,128,0.4)" }} />
                            <span className="swatch-label">BG</span>
                          </div>
                          <div className="swatch-item" title={`カード: ${themeItem.cardHex}`}>
                            <span className="swatch-circle" style={{ backgroundColor: themeItem.cardHex, border: "1px solid rgba(128,128,128,0.4)" }} />
                            <span className="swatch-label">Card</span>
                          </div>
                          <div className="swatch-item" title={`文字: ${themeItem.textHex}`}>
                            <span className="swatch-circle" style={{ backgroundColor: themeItem.textHex }} />
                            <span className="swatch-label">Text</span>
                          </div>
                          <div className="swatch-item" title={`アクセント: ${themeItem.accentHex}`}>
                            <span className="swatch-circle" style={{ backgroundColor: themeItem.accentHex }} />
                            <span className="swatch-label">Accent</span>
                          </div>
                        </div>

                        <p className="theme-desc">{themeItem.description}</p>

                        <div className="theme-env-badge">
                          <span className="env-icon">💡</span>
                          <span>{themeItem.environment}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="settings-group">
                <h4 className="settings-group-title">損益配色パターン</h4>
                <div className="pl-color-grid">
                  <div
                    className={`pl-card ${plColorStyle === "red-blue" ? "active" : ""}`}
                    onClick={() => setPlColorStyle("red-blue")}
                  >
                    <span className="material-symbols-outlined icon text-red">trending_up</span>
                    <span>利益: 赤 / 損失: 青 (国内標準)</span>
                  </div>
                  <div
                    className={`pl-card ${plColorStyle === "green-red" ? "active" : ""}`}
                    onClick={() => setPlColorStyle("green-red")}
                  >
                    <span className="material-symbols-outlined icon text-green">trending_up</span>
                    <span>利益: 緑 / 損失: 赤 (グローバル標準)</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 4. AI連携設定 */}
          {activeTab === "ai" && (
            <div className="settings-section-stack">
              <div className="api-test-banner">
                <div className="api-test-info">
                  <span className="api-test-title">API接続疎通テスト</span>
                  <span className="api-test-subtitle">設定された各APIキーの通信状態を確認します</span>
                </div>
                <button
                  type="button"
                  className="btn-test-all"
                  onClick={handleTestAllApis}
                  disabled={isTestingAllApis}
                >
                  <span className={`material-symbols-outlined icon ${isTestingAllApis ? "spin" : ""}`}>
                    {isTestingAllApis ? "sync" : "checklist"}
                  </span>
                  <span>{isTestingAllApis ? "テスト中..." : "一括テスト"}</span>
                </button>
              </div>

              {/* OpenRouter */}
              <div className="api-key-block">
                <div className="api-key-header">
                  <label className="api-key-label">OpenRouter API Key (LLM解析)</label>
                  <button
                    type="button"
                    className="btn-test-single"
                    onClick={handleTestOpenRouter}
                    disabled={openRouterTestResult.status === "testing" || isTestingAllApis}
                  >
                    確認
                  </button>
                </div>
                <input
                  type="password"
                  className="input-compact font-data"
                  value={openRouterApiKey}
                  onChange={(e) => setOpenRouterApiKey(e.target.value)}
                  placeholder="sk-or-v1-..."
                />
                {openRouterTestResult.status !== "idle" && (
                  <div className={`api-result-badge ${openRouterTestResult.status}`}>
                    {openRouterTestResult.message}
                  </div>
                )}

                <div style={{ marginTop: "6px" }}>
                  <label className="form-label-compact">モデル選択</label>
                  <CustomSelect
                    value={openRouterModel}
                    onChange={setOpenRouterModel}
                    options={[
                      { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash (推奨)" },
                      { value: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
                      { value: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
                      { value: "deepseek/deepseek-chat", label: "DeepSeek V3" },
                    ]}
                  />
                </div>
              </div>

              {/* FRED API */}
              <div className="api-key-block">
                <div className="api-key-header">
                  <label className="api-key-label">FRED API Key (FRB金利データ)</label>
                  <button
                    type="button"
                    className="btn-test-single"
                    onClick={handleTestFred}
                    disabled={fredTestResult.status === "testing" || isTestingAllApis}
                  >
                    確認
                  </button>
                </div>
                <input
                  type="text"
                  className="input-compact font-data"
                  value={fredApiKey}
                  onChange={(e) => setFredApiKey(e.target.value)}
                  placeholder="FRED API Key (任意)"
                />
              </div>

              {/* Finnhub API */}
              <div className="api-key-block">
                <div className="api-key-header">
                  <label className="api-key-label">Finnhub API Key (FX経済指標ニュース)</label>
                  <button
                    type="button"
                    className="btn-test-single"
                    onClick={handleTestFinnhub}
                    disabled={finnhubTestResult.status === "testing" || isTestingAllApis}
                  >
                    確認
                  </button>
                </div>
                <input
                  type="text"
                  className="input-compact font-data"
                  value={finnhubApiKey}
                  onChange={(e) => setFinnhubApiKey(e.target.value)}
                  placeholder="Finnhub API Key (任意)"
                />
              </div>

              {/* GDELT */}
              <div className="api-key-block">
                <div className="api-key-header">
                  <label className="api-key-label">GDELT ニュース API (キー不要・無料)</label>
                  <button
                    type="button"
                    className="btn-test-single"
                    onClick={handleTestGdelt}
                    disabled={gdeltTestResult.status === "testing" || isTestingAllApis}
                  >
                    確認
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="modal-footer">
          <button
            className="btn-modal-primary"
            onClick={() => {
              saveAllSettings();
              onClose();
            }}
            disabled={!!recordingAction}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
