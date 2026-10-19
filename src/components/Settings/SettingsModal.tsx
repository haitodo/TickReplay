import React from "react";
import { COMMANDS } from "../../constants/commands";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_HOTKEYS, HOTKEY_METADATA, formatShortcutForDisplay } from "../../utils/hotkeyUtils";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: "general" | "hotkeys" | "display";
  setActiveTab: (tab: "general" | "hotkeys" | "display") => void;
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
  timelineActivityMaxCap?: number;
  setTimelineActivityMaxCap?: (val: number) => void;
  timelineActivityMinFloor?: number;
  setTimelineActivityMinFloor?: (val: number) => void;
  autoSkipThreshold?: number;
  setAutoSkipThreshold?: (val: number) => void;
  plColorStyle: "red-blue" | "green-red";
  setPlColorStyle: (val: "red-blue" | "green-red") => void;
  saveAllSettings: () => void;
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
  timelineActivityMaxCap = 2800,
  setTimelineActivityMaxCap,
  timelineActivityMinFloor = 1500,
  setTimelineActivityMinFloor,
  autoSkipThreshold = 0.15,
  setAutoSkipThreshold,
  plColorStyle,
  setPlColorStyle,
  saveAllSettings,
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
            className={`modal-tab-btn ${activeTab === "display" ? "active" : ""}`}
            onClick={() => setActiveTab("display")}
          >
            <span className="material-symbols-outlined tab-icon">palette</span>
            表示・配色
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

              <div className="settings-group">
                <h4 className="settings-group-title">
                  <span className="material-symbols-outlined" style={{ fontSize: "16px", verticalAlign: "middle", marginRight: "4px" }}>speed</span>
                  タイムライン活動度 ＆ 無風自動早送り (Auto-Skip)
                </h4>
                <p className="settings-hint" style={{ marginBottom: "10px" }}>
                  シークバーの波形・色彩および無風時間帯の自動早送り（150倍速）の判定基準を設定します。
                </p>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                  <div>
                    <label className="toggle-switch-label" style={{ display: "block", marginBottom: "4px", fontSize: "12px", fontWeight: "bold" }}>
                      基準上限キャップ (15分)
                    </label>
                    <input
                      type="number"
                      className="pro-input font-data"
                      style={{ width: "100%", padding: "5px 8px", fontSize: "12px" }}
                      min={500}
                      max={10000}
                      step={100}
                      value={timelineActivityMaxCap}
                      onChange={(e) => {
                        const val = Math.max(500, parseInt(e.target.value, 10) || 2800);
                        if (setTimelineActivityMaxCap) setTimelineActivityMaxCap(val);
                      }}
                    />
                    <span className="settings-hint" style={{ fontSize: "10px", marginTop: "2px", display: "block" }}>
                      指標スパイクによる波形潰れを防止 (初期値: 2800)
                    </span>
                  </div>

                  <div>
                    <label className="toggle-switch-label" style={{ display: "block", marginBottom: "4px", fontSize: "12px", fontWeight: "bold" }}>
                      基準下限フロア (15分)
                    </label>
                    <input
                      type="number"
                      className="pro-input font-data"
                      style={{ width: "100%", padding: "5px 8px", fontSize: "12px" }}
                      min={200}
                      max={5000}
                      step={50}
                      value={timelineActivityMinFloor}
                      onChange={(e) => {
                        const val = Math.max(200, parseInt(e.target.value, 10) || 1500);
                        if (setTimelineActivityMinFloor) setTimelineActivityMinFloor(val);
                      }}
                    />
                    <span className="settings-hint" style={{ fontSize: "10px", marginTop: "2px", display: "block" }}>
                      閑散日のスキップ不発を防止 (初期値: 1500)
                    </span>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                  <div>
                    <span className="switch-text" style={{ fontSize: "12px", fontWeight: "bold", display: "block" }}>無風スキップ発動閾値</span>
                    <span className="settings-hint" style={{ fontSize: "11px" }}>
                      活動強度がこの割合未満で早送り (復帰: {Math.round((autoSkipThreshold + 0.1) * 100)}%)
                    </span>
                  </div>
                  <select
                    className="pro-input font-data"
                    style={{ padding: "4px 8px", fontSize: "12px", width: "110px" }}
                    value={autoSkipThreshold}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0.15;
                      if (setAutoSkipThreshold) setAutoSkipThreshold(val);
                    }}
                  >
                    <option value={0.10}>10% (厳格)</option>
                    <option value={0.15}>15% (標準)</option>
                    <option value={0.20}>20% (早め)</option>
                    <option value={0.25}>25% (積極的)</option>
                  </select>
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

          {/* 3. 表示・配色設定 */}
          {activeTab === "display" && (
            <div className="settings-section-stack">
              <div className="settings-group">
                <h4 className="settings-group-title">損益配色パターン</h4>
                <p className="settings-hint" style={{ marginBottom: "8px" }}>
                  評価損益の色分けを選択します。カラーテーマはダーク固定です。
                </p>
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
