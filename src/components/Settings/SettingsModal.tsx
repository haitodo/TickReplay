import React from "react";
import { COMMANDS } from "../../constants/commands";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_HOTKEYS, HOTKEY_METADATA, formatShortcutForDisplay } from "../../utils/hotkeyUtils";
import { THEME_LIST, ThemeType } from "../../constants/themePresets";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: "general" | "hotkeys" | "theme";
  setActiveTab: (tab: "general" | "hotkeys" | "theme") => void;
  recordingAction: string | null;
  setRecordingAction: (action: string | null) => void;
  hotkeys: Record<string, string>;
  handleResetAllHotkeys: () => void;
  handleClearHotkey: (actionKey: string) => void;
  autoScrollSync: boolean;
  setAutoScrollSync: (val: boolean) => void;
  autoSkipWeekend: boolean;
  handleAutoSkipWeekendToggle: (val: boolean) => void;
  alwaysOnTop: boolean;
  handleAlwaysOnTopToggle: () => void;
  isShortcutsActive: boolean;
  handleShortcutsToggle: () => void;
  economicDataDir?: string;
  setEconomicDataDir?: (val: string) => void;
  theme?: ThemeType;
  setTheme?: (theme: ThemeType) => void;
  themeId?: string;
  setThemeId?: (id: string) => void;
  themeMode?: "dark" | "light";
  plColorStyle: "red-blue" | "green-red";
  setPlColorStyle: (val: "red-blue" | "green-red") => void;
  saveAllSettings: (
    nextHotkeys?: Record<string, string>,
    nextTimePresets?: number[],
    nextTickPresets?: number[],
    nextTheme?: ThemeType
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
  autoScrollSync,
  setAutoScrollSync,
  autoSkipWeekend,
  handleAutoSkipWeekendToggle,
  alwaysOnTop,
  handleAlwaysOnTopToggle,
  isShortcutsActive,
  handleShortcutsToggle,
  economicDataDir,
  setEconomicDataDir,
  theme,
  setTheme,
  themeId,
  setThemeId,
  plColorStyle,
  setPlColorStyle,
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
                <h4 className="settings-group-title">
                  <span className="material-symbols-outlined" style={{ fontSize: "16px", verticalAlign: "middle", marginRight: "4px" }}>folder_open</span>
                  経済指標データフォルダ設定
                </h4>
                <p className="settings-hint" style={{ marginBottom: "8px" }}>
                  疑似DMMスプレッドモデルで使用する経済指標データ (Parquet) の格納フォルダを指定します。
                </p>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input
                    type="text"
                    className="pro-input font-data"
                    style={{ flex: 1, fontSize: "12px", padding: "6px 10px" }}
                    value={economicDataDir || ""}
                    onChange={(e) => setEconomicDataDir && setEconomicDataDir(e.target.value)}
                    placeholder="D:\Drehis\economic"
                  />
                  <button
                    className="btn-secondary-compact"
                    style={{ display: "flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}
                    onClick={async () => {
                      try {
                        const selected = await invoke<string | null>(COMMANDS.selectFolder);
                        if (selected && setEconomicDataDir) {
                          setEconomicDataDir(selected);
                        }
                      } catch (err) {
                        console.error("Failed to select folder", err);
                      }
                    }}
                    title="フォルダを選択"
                  >
                    <span className="material-symbols-outlined icon" style={{ fontSize: "16px" }}>folder</span>
                    <span>参照</span>
                  </button>
                  <button
                    className="btn-secondary-compact"
                    style={{ display: "flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}
                    onClick={async () => {
                      try {
                        const def = await invoke<string>(COMMANDS.getDefaultEconomicDataDir);
                        if (def && setEconomicDataDir) {
                          setEconomicDataDir(def);
                        }
                      } catch (err) {
                        console.error("Failed to reset economic data dir", err);
                      }
                    }}
                    title="デフォルト設定に戻す"
                  >
                    <span className="material-symbols-outlined icon" style={{ fontSize: "16px" }}>restart_alt</span>
                    <span>初期値</span>
                  </button>
                </div>
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
