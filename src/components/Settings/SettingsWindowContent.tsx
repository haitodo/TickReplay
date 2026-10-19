import React, { useState, useEffect, useCallback } from "react";
import { DEFAULT_SPEED_TIME_PRESETS, DEFAULT_SPEED_TICK_PRESETS } from "../../constants/speedPresets";
import { COMMANDS } from "../../constants/commands";
import { EVENTS } from "../../constants/events";
import { STORAGE_KEYS } from "../../constants/storageKeys";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import {
  DEFAULT_HOTKEYS,
  HOTKEY_METADATA,
  formatShortcutForDisplay,
  getTauriShortcutFromEvent,
} from "../../utils/hotkeyUtils";
import { useAppearance } from "../../hooks/useAppearance";
import { PersistedSettings } from "../../types/settings";

type SettingsSaveOverrides = {
  hotkeys?: Record<string, string>;
  timePresets?: number[];
  tickPresets?: number[];
  plColorStyle?: ReturnType<typeof useAppearance>["plColorStyle"];
  orderColorStyle?: ReturnType<typeof useAppearance>["orderColorStyle"];
  alwaysOnTop?: boolean;
  isShortcutsActive?: boolean;
  autoScrollSync?: boolean;
  autoSkipWeekend?: boolean;
  economicDataDir?: string;
  timelineActivityMaxCap?: number;
  timelineActivityMinFloor?: number;
  autoSkipThreshold?: number;
};

export const SettingsWindowContent: React.FC = () => {
  const {
    plColorStyle,
    setPlColorStyle,
    orderColorStyle,
    setOrderColorStyle,
  } = useAppearance();

  const [activeTab, setActiveTab] = useState<"general" | "hotkeys" | "display">("general");

  // 一般設定
  const [autoScrollSync, setAutoScrollSync] = useState(true);
  const [autoSkipWeekend, setAutoSkipWeekend] = useState(true);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [isShortcutsActive, setIsShortcutsActive] = useState(false);
  const [economicDataDir, setEconomicDataDir] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.replayEconomicDataDir) || "");
  const [timelineActivityMaxCap, setTimelineActivityMaxCap] = useState<number>(2800);
  const [timelineActivityMinFloor, setTimelineActivityMinFloor] = useState<number>(1500);
  const [autoSkipThreshold, setAutoSkipThreshold] = useState<number>(0.15);

  // ホットキー
  const [hotkeys, setHotkeys] = useState<Record<string, string>>(DEFAULT_HOTKEYS);
  const [recordingAction, setRecordingAction] = useState<string | null>(null);

  // プリセット
  const [timePresets, setTimePresets] = useState<number[]>(() => [...DEFAULT_SPEED_TIME_PRESETS]);
  const [tickPresets, setTickPresets] = useState<number[]>(() => [...DEFAULT_SPEED_TICK_PRESETS]);

  // 初期ロード
  useEffect(() => {
    const initLoad = async () => {
      try {
        const data = await invoke<PersistedSettings>(COMMANDS.loadSettings);
        if (data) {
          if (data.hotkeys) setHotkeys({ ...DEFAULT_HOTKEYS, ...data.hotkeys });
          if (data.time_presets) setTimePresets(data.time_presets);
          if (data.tick_presets) setTickPresets(data.tick_presets);
          if (data.always_on_top !== undefined) setAlwaysOnTop(data.always_on_top);
          if (data.shortcuts_active !== undefined) setIsShortcutsActive(data.shortcuts_active);
          if (data.auto_scroll_sync !== undefined) setAutoScrollSync(data.auto_scroll_sync);
          if (data.auto_skip_weekend !== undefined) setAutoSkipWeekend(data.auto_skip_weekend);
          if (data.timeline_activity_max_cap !== undefined) setTimelineActivityMaxCap(data.timeline_activity_max_cap);
          if (data.timeline_activity_min_floor !== undefined) setTimelineActivityMinFloor(data.timeline_activity_min_floor);
          if (data.auto_skip_threshold !== undefined) setAutoSkipThreshold(data.auto_skip_threshold);
          if (data.economic_data_dir) {
            setEconomicDataDir(data.economic_data_dir);
          } else if (!localStorage.getItem(STORAGE_KEYS.replayEconomicDataDir)) {
            invoke<string>(COMMANDS.getDefaultEconomicDataDir)
              .then((def) => {
                if (def) {
                  setEconomicDataDir(def);
                  localStorage.setItem(STORAGE_KEYS.replayEconomicDataDir, def);
                }
              })
              .catch(() => {});
          }
        }
      } catch (err) {
        console.error("Failed to load settings in SettingsWindow:", err);
      }
    };
    initLoad();
  }, []);

  // 設定保存関数
  const saveAll = useCallback(
    async (overrides: SettingsSaveOverrides = {}) => {
      const activeHotkeys = overrides.hotkeys ?? hotkeys;
      const activeTimePresets = overrides.timePresets ?? timePresets;
      const activeTickPresets = overrides.tickPresets ?? tickPresets;
      const activePlColorStyle = overrides.plColorStyle ?? plColorStyle;
      const activeOrderColorStyle = overrides.orderColorStyle ?? orderColorStyle;
      const activeAlwaysOnTop = overrides.alwaysOnTop ?? alwaysOnTop;
      const activeIsShortcutsActive = overrides.isShortcutsActive ?? isShortcutsActive;
      const activeAutoScrollSync = overrides.autoScrollSync ?? autoScrollSync;
      const activeAutoSkipWeekend = overrides.autoSkipWeekend ?? autoSkipWeekend;
      const activeEconomicDataDir = overrides.economicDataDir ?? economicDataDir;
      const activeTimelineActivityMaxCap = overrides.timelineActivityMaxCap ?? timelineActivityMaxCap;
      const activeTimelineActivityMinFloor = overrides.timelineActivityMinFloor ?? timelineActivityMinFloor;
      const activeAutoSkipThreshold = overrides.autoSkipThreshold ?? autoSkipThreshold;

      try {
        await invoke(COMMANDS.saveSettings, {
          settings: {
            hotkeys: activeHotkeys,
            time_presets: activeTimePresets,
            tick_presets: activeTickPresets,
            pl_color_style: activePlColorStyle,
            order_color_style: activeOrderColorStyle,
            always_on_top: activeAlwaysOnTop,
            is_shortcuts_active: activeIsShortcutsActive,
            auto_scroll_sync: activeAutoScrollSync,
            auto_skip_weekend: activeAutoSkipWeekend,
            economic_data_dir: activeEconomicDataDir,
            timeline_activity_max_cap: activeTimelineActivityMaxCap,
            timeline_activity_min_floor: activeTimelineActivityMinFloor,
            auto_skip_threshold: activeAutoSkipThreshold,
          },
        });
        localStorage.setItem(STORAGE_KEYS.plColorStyle, activePlColorStyle);
        localStorage.setItem(STORAGE_KEYS.speedOrderColorStyle, activeOrderColorStyle);
        localStorage.setItem(STORAGE_KEYS.replayEconomicDataDir, activeEconomicDataDir);

        emit(EVENTS.settingsUpdated, {
          plColorStyle: activePlColorStyle,
          orderColorStyle: activeOrderColorStyle,
          timelineActivityMaxCap: activeTimelineActivityMaxCap,
          timelineActivityMinFloor: activeTimelineActivityMinFloor,
          autoSkipThreshold: activeAutoSkipThreshold,
        }).catch(console.error);
      } catch (err) {
        console.error("Failed to save settings:", err);
      }
    },
    [
      hotkeys,
      timePresets,
      tickPresets,
      plColorStyle,
      orderColorStyle,
      alwaysOnTop,
      isShortcutsActive,
      autoScrollSync,
      autoSkipWeekend,
      economicDataDir,
      timelineActivityMaxCap,
      timelineActivityMinFloor,
      autoSkipThreshold,
    ]
  );

  // ホットキー録音リスナー
  useEffect(() => {
    if (!recordingAction) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setRecordingAction(null);
        return;
      }

      const shortcut = getTauriShortcutFromEvent(e);
      if (shortcut) {
        const nextHotkeys = { ...hotkeys, [recordingAction]: shortcut };
        setHotkeys(nextHotkeys);
        setRecordingAction(null);
        saveAll({ hotkeys: nextHotkeys });
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [recordingAction, hotkeys, saveAll]);

  const handleClearHotkey = (actionKey: string) => {
    const nextHotkeys = { ...hotkeys, [actionKey]: "" };
    setHotkeys(nextHotkeys);
    saveAll({ hotkeys: nextHotkeys });
  };

  const handleResetAllHotkeys = () => {
    setHotkeys(DEFAULT_HOTKEYS);
    saveAll({ hotkeys: DEFAULT_HOTKEYS });
  };

  const handleCloseWindow = async () => {
    try {
      await saveAll();
    } catch (err) {
      console.error("Save on close error:", err);
    } finally {
      try {
        await invoke(COMMANDS.closeSettingsWindow);
      } catch (err) {
        console.error("Hide window error via invoke:", err);
        try {
          const win = getCurrentWindow();
          await win.hide();
        } catch (e) {
          console.error("Hide window error via API:", e);
        }
      }
    }
  };


  return (
    <div className="settings-window-root">
      {/* ウィンドウヘッダー */}
      <header className="settings-window-header" data-tauri-drag-region>
        <div className="header-title-group" data-tauri-drag-region>
          <span className="material-symbols-outlined header-icon">settings</span>
          <h2 className="header-title">環境設定</h2>
          <span className="header-subtitle">System &amp; Controls</span>
        </div>
      </header>

      {/* メインエリア（左側タブ ＋ 右側コンテンツ） */}
      <div className="settings-window-body">
        {/* 左側タブナビゲーション */}
        <nav className="settings-sidebar">
          <button
            className={`settings-nav-btn ${activeTab === "general" ? "active" : ""}`}
            onClick={() => setActiveTab("general")}
          >
            <span className="material-symbols-outlined icon">tune</span>
            <span>一般設定</span>
          </button>
          <button
            className={`settings-nav-btn ${activeTab === "hotkeys" ? "active" : ""}`}
            onClick={() => setActiveTab("hotkeys")}
          >
            <span className="material-symbols-outlined icon">keyboard</span>
            <span>ショートカット</span>
          </button>
          <button
            className={`settings-nav-btn ${activeTab === "display" ? "active" : ""}`}
            onClick={() => setActiveTab("display")}
          >
            <span className="material-symbols-outlined icon">palette</span>
            <span>表示・配色</span>
          </button>
        </nav>

        {/* 右側スクロールコンテンツ */}
        <main className="settings-content-area">
          {/* 1. 一般設定 */}
          {activeTab === "general" && (
            <div className="settings-tab-pane">
              <div className="settings-section-card">
                <h3 className="section-title">
                  <span className="material-symbols-outlined icon">sync</span>
                  同期 &amp; 表示オプション
                </h3>
                <div className="settings-options-list">
                  <label className="settings-checkbox-row">
                    <input
                      type="checkbox"
                      checked={autoScrollSync}
                      onChange={(e) => {
                        const value = e.target.checked;
                        setAutoScrollSync(value);
                        saveAll({ autoScrollSync: value });
                      }}
                    />
                    <div className="option-text">
                      <span className="option-label">チャート自動追従スクロール</span>
                      <span className="option-desc">リプレイ進行に合わせてMT5チャートを自動で右端へスクロールします</span>
                    </div>
                  </label>

                  <label className="settings-checkbox-row">
                    <input
                      type="checkbox"
                      checked={autoSkipWeekend}
                      onChange={(e) => {
                        const value = e.target.checked;
                        setAutoSkipWeekend(value);
                        saveAll({ autoSkipWeekend: value });
                      }}
                    />
                    <div className="option-text">
                      <span className="option-label">土日休場スキップ</span>
                      <span className="option-desc">時間比率モード時にティックのない週末（土日）を自動的にスキップします</span>
                    </div>
                  </label>

                  <label className="settings-checkbox-row">
                    <input
                      type="checkbox"
                      checked={alwaysOnTop}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setAlwaysOnTop(val);
                        invoke(COMMANDS.setAlwaysOnTop, { always: val }).catch(console.error);
                        saveAll({ alwaysOnTop: val });
                      }}
                    />
                    <div className="option-text">
                      <span className="option-label">常に最前面に固定 (Pin)</span>
                      <span className="option-desc">メインウィンドウを他のウィンドウより前面に配置します</span>
                    </div>
                  </label>

                  <label className="settings-checkbox-row">
                    <input
                      type="checkbox"
                      checked={isShortcutsActive}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setIsShortcutsActive(val);
                        invoke(COMMANDS.setShortcutsActive, { active: val }).catch(console.error);
                        saveAll({ isShortcutsActive: val });
                      }}
                    />
                    <div className="option-text">
                      <span className="option-label">グローバルショートカットキーの有効化</span>
                      <span className="option-desc">MT5チャート操作中でもキーボードショートカットでリプレイ操作を可能にします</span>
                    </div>
                  </label>
                </div>
              </div>

              <div className="settings-section-card">
                <h3 className="section-title">
                  <span className="material-symbols-outlined icon">folder_open</span>
                  経済指標データフォルダ設定
                </h3>
                <div className="settings-options-list">
                  <p className="option-desc" style={{ marginBottom: "8px" }}>
                    疑似DMMスプレッドモデルで使用する経済指標データ (Parquet) の格納フォルダを指定します。
                  </p>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input
                      type="text"
                      className="input-compact font-data"
                      style={{ flex: 1, fontSize: "12px", padding: "6px 10px" }}
                      value={economicDataDir}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEconomicDataDir(val);
                        saveAll({ economicDataDir: val });
                      }}
                      placeholder="D:\Drehis\economic"
                    />
                    <button
                      className="btn-secondary-compact"
                      style={{ display: "flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}
                      onClick={async () => {
                        try {
                          const selected = await invoke<string | null>(COMMANDS.selectFolder);
                          if (selected) {
                            setEconomicDataDir(selected);
                            saveAll({ economicDataDir: selected });
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
                          if (def) {
                            setEconomicDataDir(def);
                            saveAll({ economicDataDir: def });
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

              <div className="settings-section-card">
                <h3 className="section-title">
                  <span className="material-symbols-outlined icon">speed</span>
                  タイムライン活動度 ＆ 無風自動早送り (Auto-Skip)
                </h3>
                <div className="settings-options-list">
                  <p className="option-desc" style={{ marginBottom: "12px" }}>
                    シークバーの波形・色彩および無風時間帯の自動早送り（150倍速）の判定基準を設定します。
                  </p>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                    <div>
                      <label className="option-label" style={{ display: "block", marginBottom: "4px" }}>
                        基準上限キャップ (15分ティック数)
                      </label>
                      <input
                        type="number"
                        className="input-compact font-data"
                        style={{ width: "100%", padding: "6px 10px" }}
                        min={500}
                        max={10000}
                        step={100}
                        value={timelineActivityMaxCap}
                        onChange={(e) => {
                          const val = Math.max(500, parseInt(e.target.value, 10) || 2800);
                          setTimelineActivityMaxCap(val);
                          saveAll({ timelineActivityMaxCap: val });
                        }}
                      />
                      <span className="option-desc" style={{ fontSize: "11px", display: "block", marginTop: "2px" }}>
                        大型指標時のスケール潰れを防ぐ上限天井 (初期値: 2800)
                      </span>
                    </div>

                    <div>
                      <label className="option-label" style={{ display: "block", marginBottom: "4px" }}>
                        基準下限フロア (15分ティック数)
                      </label>
                      <input
                        type="number"
                        className="input-compact font-data"
                        style={{ width: "100%", padding: "6px 10px" }}
                        min={200}
                        max={5000}
                        step={50}
                        value={timelineActivityMinFloor}
                        onChange={(e) => {
                          const val = Math.max(200, parseInt(e.target.value, 10) || 1500);
                          setTimelineActivityMinFloor(val);
                          saveAll({ timelineActivityMinFloor: val });
                        }}
                      />
                      <span className="option-desc" style={{ fontSize: "11px", display: "block", marginTop: "2px" }}>
                        祝日・薄商い日のスキップ不発を防ぐ最低基準 (初期値: 1500)
                      </span>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
                    <div style={{ flex: 1 }}>
                      <span className="option-label">無風スキップ発動閾値</span>
                      <span className="option-desc">
                        活動強度がこの割合を下回ると自動早送りします (復帰は +10%: {Math.round((autoSkipThreshold + 0.1) * 100)}%)
                      </span>
                    </div>
                    <select
                      className="input-compact font-data"
                      style={{ padding: "6px 10px", width: "110px" }}
                      value={autoSkipThreshold}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0.15;
                        setAutoSkipThreshold(val);
                        saveAll({ autoSkipThreshold: val });
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
            </div>
          )}

          {/* 2. ショートカット設定 */}
          {activeTab === "hotkeys" && (
            <div className="settings-tab-pane">
              <div className="hotkeys-banner">
                <div className="hotkeys-banner-text">
                  <span className="material-symbols-outlined icon">keyboard</span>
                  <span>
                    「録音」ボタンをクリック後、割り当てたいキーの組み合わせを押してください。
                  </span>
                </div>
                <button className="btn-danger-compact" onClick={handleResetAllHotkeys}>
                  <span className="material-symbols-outlined icon">restart_alt</span>
                  デフォルトに戻す
                </button>
              </div>

              <div className="hotkeys-grid-table">
                {Object.keys(DEFAULT_HOTKEYS).map((actionKey) => {
                  const meta = HOTKEY_METADATA[actionKey] || { name: actionKey, desc: "" };
                  const currentKey = hotkeys[actionKey] || "";
                  const isRecording = recordingAction === actionKey;

                  return (
                    <div key={actionKey} className="hotkey-item-row">
                      <div className="hotkey-meta">
                        <span className="hotkey-title">{meta.name}</span>
                        <span className="hotkey-sub">{meta.desc}</span>
                      </div>
                      <div className="hotkey-action-group">
                        <button
                          className={`btn-record ${isRecording ? "recording" : ""}`}
                          onClick={() => setRecordingAction(isRecording ? null : actionKey)}
                        >
                          <span className="material-symbols-outlined icon">
                            {isRecording ? "keyboard_voice" : "keyboard"}
                          </span>
                          <span className="font-data">
                            {isRecording ? "キーを押してください..." : formatShortcutForDisplay(currentKey)}
                          </span>
                        </button>
                        <button
                          className="btn-clear"
                          onClick={() => handleClearHotkey(actionKey)}
                          disabled={!currentKey}
                          title="割り当て解除"
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
            <div className="settings-tab-pane">
              <p className="settings-hint" style={{ marginBottom: "12px" }}>
                カラーテーマはダーク固定です。損益と発注ボタンの配色を選択できます。
              </p>

              <div className="settings-section-card">
                <h3 className="section-title">
                  <span className="material-symbols-outlined icon">payments</span>
                  損益配色パターン
                </h3>
                <div className="pl-grid-cluster">
                  <button
                    className={`pl-style-card ${plColorStyle === "red-blue" ? "active" : ""}`}
                    onClick={() => {
                      const value = "red-blue";
                      setPlColorStyle(value);
                      saveAll({ plColorStyle: value });
                    }}
                  >
                    <span className="material-symbols-outlined icon text-red">trending_up</span>
                    <div>
                      <div className="pl-label">国内標準 (利益: 赤 / 損失: 青)</div>
                      <div className="pl-sub">日本国内証券会社の一般的な表示スタイル</div>
                    </div>
                  </button>
                  <button
                    className={`pl-style-card ${plColorStyle === "green-red" ? "active" : ""}`}
                    onClick={() => {
                      const value = "green-red";
                      setPlColorStyle(value);
                      saveAll({ plColorStyle: value });
                    }}
                  >
                    <span className="material-symbols-outlined icon text-green">trending_up</span>
                    <div>
                      <div className="pl-label">グローバル標準 (利益: 緑 / 損失: 赤)</div>
                      <div className="pl-sub">MT5・海外ブローカー標準の表示スタイル</div>
                    </div>
                  </button>
                </div>
              </div>

              <div className="settings-section-card">
                <h3 className="section-title">
                  <span className="material-symbols-outlined icon">attach_money</span>
                  発注ボタン配色スタイル
                </h3>
                <div className="pl-grid-cluster">
                  <button
                    className={`pl-style-card ${orderColorStyle === "red-green" ? "active" : ""}`}
                    onClick={() => {
                      const value = "red-green";
                      setOrderColorStyle(value);
                      saveAll({ orderColorStyle: value });
                    }}
                  >
                    <span className="material-symbols-outlined icon text-red">attach_money</span>
                    <div>
                      <div className="pl-label">国内標準 (BUY: 赤 / SELL: 青・緑)</div>
                      <div className="pl-sub">日本国内証券会社の一般的な発注配色</div>
                    </div>
                  </button>
                  <button
                    className={`pl-style-card ${orderColorStyle === "blue-red" ? "active" : ""}`}
                    onClick={() => {
                      const value = "blue-red";
                      setOrderColorStyle(value);
                      saveAll({ orderColorStyle: value });
                    }}
                  >
                    <span className="material-symbols-outlined icon text-cyan">attach_money</span>
                    <div>
                      <div className="pl-label">グローバル標準 (BUY: 青 / SELL: 赤)</div>
                      <div className="pl-sub">MT5標準・海外ブローカーの発注配色</div>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* フッター */}
      <footer className="settings-window-footer">
        <span className="footer-status-text">設定はリアルタイムに自動保存されます</span>
        <button className="pro-btn primary-filled footer-close-btn" onClick={handleCloseWindow}>
          <span className="material-symbols-outlined icon">check</span>
          完了
        </button>
      </footer>
    </div>
  );
};
