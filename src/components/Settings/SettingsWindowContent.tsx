import React, { useState, useEffect, useCallback } from "react";
import { STORAGE_KEYS } from "../../constants/storageKeys";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { CustomSelect } from "../../CustomSelect";
import {
  DEFAULT_HOTKEYS,
  HOTKEY_METADATA,
  formatShortcutForDisplay,
  getTauriShortcutFromEvent,
} from "../../utils/hotkeyUtils";
import { THEME_LIST } from "../../constants/themePresets";
import {
  testOpenRouterKey,
  testFredKey,
  testFinnhubKey,
  testGdeltApi,
  ApiTestResult,
} from "../../utils/apiKeyTester";
import { useTheme } from "../../hooks/useTheme";
import { PersistedSettings } from "../../types/settings";

export const SettingsWindowContent: React.FC = () => {
  const {
    theme,
    setTheme,
    plColorStyle,
    setPlColorStyle,
    orderColorStyle,
    setOrderColorStyle,
  } = useTheme();

  const [activeTab, setActiveTab] = useState<"general" | "hotkeys" | "theme" | "ai">("general");

  // 一般設定
  const [autoScrollSync, setAutoScrollSync] = useState(true);
  const [autoSkipWeekend, setAutoSkipWeekend] = useState(true);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [isShortcutsActive, setIsShortcutsActive] = useState(false);
  const [limitTickHistory, setLimitTickHistory] = useState(true);
  const [tickHistoryTimeframe, setTickHistoryTimeframe] = useState("M5");
  const [maxHistoryBars, setMaxHistoryBars] = useState(300);
  const [economicDataDir, setEconomicDataDir] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.replayEconomicDataDir) || "");

  // ホットキー
  const [hotkeys, setHotkeys] = useState<Record<string, string>>(DEFAULT_HOTKEYS);
  const [recordingAction, setRecordingAction] = useState<string | null>(null);

  // プリセット
  const [timePresets, setTimePresets] = useState<number[]>([0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0]);
  const [tickPresets, setTickPresets] = useState<number[]>([1, 2, 5, 10, 30, 60]);

  // AI設定
  const [openRouterApiKey, setOpenRouterApiKey] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.openRouterApiKey) || "");
  const [openRouterModel, setOpenRouterModel] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.openRouterModel) || "google/gemini-2.5-flash");
  const [fredApiKey, setFredApiKey] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.fredApiKey) || "");
  const [finnhubApiKey, setFinnhubApiKey] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.finnhubApiKey) || "");

  // APIテスト
  const [openRouterTestResult, setOpenRouterTestResult] = useState<ApiTestResult>({ success: false, status: "idle", message: "" });
  const [fredTestResult, setFredTestResult] = useState<ApiTestResult>({ success: false, status: "idle", message: "" });
  const [finnhubTestResult, setFinnhubTestResult] = useState<ApiTestResult>({ success: false, status: "idle", message: "" });
  const [gdeltTestResult, setGdeltTestResult] = useState<ApiTestResult>({ success: false, status: "idle", message: "" });
  const [isTestingAllApis, setIsTestingAllApis] = useState(false);

  // 初期ロード
  useEffect(() => {
    const initLoad = async () => {
      try {
        const data = await invoke<PersistedSettings>("load_settings");
        if (data) {
          if (data.hotkeys) setHotkeys({ ...DEFAULT_HOTKEYS, ...data.hotkeys });
          if (data.time_presets) setTimePresets(data.time_presets);
          if (data.tick_presets) setTickPresets(data.tick_presets);
          if (data.always_on_top !== undefined) setAlwaysOnTop(data.always_on_top);
          if (data.shortcuts_active !== undefined) setIsShortcutsActive(data.shortcuts_active);
          if (data.auto_scroll_sync !== undefined) setAutoScrollSync(data.auto_scroll_sync);
          if (data.auto_skip_weekend !== undefined) setAutoSkipWeekend(data.auto_skip_weekend);
          if (data.limit_tick_history !== undefined) setLimitTickHistory(data.limit_tick_history);
          if (data.tick_history_timeframe) setTickHistoryTimeframe(data.tick_history_timeframe);
          if (data.max_history_bars !== undefined) setMaxHistoryBars(data.max_history_bars);
          if (data.economic_data_dir) {
            setEconomicDataDir(data.economic_data_dir);
          } else if (!localStorage.getItem(STORAGE_KEYS.replayEconomicDataDir)) {
            invoke<string>("get_default_economic_data_dir")
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
    async (
      overrideHotkeys?: Record<string, string>,
      overrideTimePresets?: number[],
      overrideTickPresets?: number[],
      overrideTheme?: string,
      overrideEconomicDataDir?: string
    ) => {
      const activeHotkeys = overrideHotkeys || hotkeys;
      const activeTimePresets = overrideTimePresets || timePresets;
      const activeTickPresets = overrideTickPresets || tickPresets;
      const activeTheme = overrideTheme || theme;
      const activeEconomicDataDir = overrideEconomicDataDir !== undefined ? overrideEconomicDataDir : economicDataDir;

      try {
        await invoke("save_settings", {
          settings: {
            hotkeys: activeHotkeys,
            time_presets: activeTimePresets,
            tick_presets: activeTickPresets,
            theme_mode: activeTheme,
            pl_color_style: plColorStyle,
            order_color_style: orderColorStyle,
            always_on_top: alwaysOnTop,
            is_shortcuts_active: isShortcutsActive,
            auto_scroll_sync: autoScrollSync,
            auto_skip_weekend: autoSkipWeekend,
            limit_tick_history: limitTickHistory,
            tick_history_timeframe: tickHistoryTimeframe,
            max_history_bars: maxHistoryBars,
            economic_data_dir: activeEconomicDataDir,
          },
        });
        localStorage.setItem(STORAGE_KEYS.tickreplayTheme, activeTheme);
        localStorage.setItem(STORAGE_KEYS.theme, activeTheme);
        localStorage.setItem(STORAGE_KEYS.themeMode, activeTheme);
        localStorage.setItem(STORAGE_KEYS.plColorStyle, plColorStyle);
        localStorage.setItem(STORAGE_KEYS.speedOrderColorStyle, orderColorStyle);
        localStorage.setItem(STORAGE_KEYS.openRouterApiKey, openRouterApiKey);
        localStorage.setItem(STORAGE_KEYS.openRouterModel, openRouterModel);
        localStorage.setItem(STORAGE_KEYS.fredApiKey, fredApiKey);
        localStorage.setItem(STORAGE_KEYS.finnhubApiKey, finnhubApiKey);
        localStorage.setItem(STORAGE_KEYS.replayEconomicDataDir, activeEconomicDataDir);

        emit("settings-updated", {
          theme: activeTheme,
          plColorStyle,
          orderColorStyle,
        }).catch(console.error);
      } catch (err) {
        console.error("Failed to save settings:", err);
      }
    },
    [
      hotkeys,
      timePresets,
      tickPresets,
      theme,
      plColorStyle,
      orderColorStyle,
      alwaysOnTop,
      isShortcutsActive,
      autoScrollSync,
      autoSkipWeekend,
      limitTickHistory,
      tickHistoryTimeframe,
      maxHistoryBars,
      economicDataDir,
      openRouterApiKey,
      openRouterModel,
      fredApiKey,
      finnhubApiKey,
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
        saveAll(nextHotkeys);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [recordingAction, hotkeys, saveAll]);

  const handleClearHotkey = (actionKey: string) => {
    const nextHotkeys = { ...hotkeys, [actionKey]: "" };
    setHotkeys(nextHotkeys);
    saveAll(nextHotkeys);
  };

  const handleResetAllHotkeys = () => {
    setHotkeys(DEFAULT_HOTKEYS);
    saveAll(DEFAULT_HOTKEYS);
  };

  const handleCloseWindow = async () => {
    try {
      await saveAll();
    } catch (err) {
      console.error("Save on close error:", err);
    } finally {
      try {
        await invoke("close_settings_window");
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

  // APIテスト
  const handleTestOpenRouter = async () => {
    setOpenRouterTestResult({ success: false, status: "testing", message: "接続確認中..." });
    const result = await testOpenRouterKey(openRouterApiKey, openRouterModel);
    setOpenRouterTestResult(result);
  };

  const handleTestFred = async () => {
    setFredTestResult({ success: false, status: "testing", message: "接続確認中..." });
    const result = await testFredKey(fredApiKey);
    setFredTestResult(result);
  };

  const handleTestFinnhub = async () => {
    setFinnhubTestResult({ success: false, status: "testing", message: "接続確認中..." });
    const result = await testFinnhubKey(finnhubApiKey);
    setFinnhubTestResult(result);
  };

  const handleTestGdelt = async () => {
    setGdeltTestResult({ success: false, status: "testing", message: "接続確認中..." });
    const result = await testGdeltApi();
    setGdeltTestResult(result);
  };

  const handleTestAllApis = async () => {
    setIsTestingAllApis(true);
    setOpenRouterTestResult({ success: false, status: "testing", message: "接続確認中..." });
    setFredTestResult({ success: false, status: "testing", message: "接続確認中..." });
    setFinnhubTestResult({ success: false, status: "testing", message: "接続確認中..." });
    setGdeltTestResult({ success: false, status: "testing", message: "接続確認中..." });

    const [openRouterRes, fredRes, finnhubRes, gdeltRes] = await Promise.all([
      testOpenRouterKey(openRouterApiKey, openRouterModel),
      testFredKey(fredApiKey),
      testFinnhubKey(finnhubApiKey),
      testGdeltApi(),
    ]);

    setOpenRouterTestResult(openRouterRes);
    setFredTestResult(fredRes);
    setFinnhubTestResult(finnhubRes);
    setGdeltTestResult(gdeltRes);
    setIsTestingAllApis(false);
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
            className={`settings-nav-btn ${activeTab === "theme" ? "active" : ""}`}
            onClick={() => setActiveTab("theme")}
          >
            <span className="material-symbols-outlined icon">palette</span>
            <span>テーマ・外観</span>
          </button>
          <button
            className={`settings-nav-btn ${activeTab === "ai" ? "active" : ""}`}
            onClick={() => setActiveTab("ai")}
          >
            <span className="material-symbols-outlined icon">auto_awesome</span>
            <span>AI連携設定</span>
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
                        setAutoScrollSync(e.target.checked);
                        saveAll();
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
                        setAutoSkipWeekend(e.target.checked);
                        saveAll();
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
                        invoke("set_always_on_top", { always: val }).catch(console.error);
                        saveAll();
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
                        invoke("set_shortcuts_active", { active: val }).catch(console.error);
                        saveAll();
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
                  <span className="material-symbols-outlined icon">speed</span>
                  高速シーク・履歴制限デフォルト
                </h3>
                <div className="settings-options-list">
                  <label className="settings-checkbox-row">
                    <input
                      type="checkbox"
                      checked={limitTickHistory}
                      onChange={(e) => {
                        setLimitTickHistory(e.target.checked);
                        saveAll();
                      }}
                    />
                    <div className="option-text">
                      <span className="option-label">直近ティック履歴の制限 (高速シーク・軽量化)</span>
                      <span className="option-desc">過去ティックの保持量を制限し、シーク速度を飛躍的に高速化します</span>
                    </div>
                  </label>

                  {limitTickHistory && (
                    <div className="fast-seek-setting-box">
                      <div className="form-item">
                        <label className="form-label">基準タイムフレーム</label>
                        <CustomSelect
                          value={tickHistoryTimeframe}
                          onChange={(val) => {
                            setTickHistoryTimeframe(val);
                            saveAll();
                          }}
                          options={[
                            { value: "M1", label: "1分足 (M1)" },
                            { value: "M5", label: "5分足 (M5)" },
                            { value: "M15", label: "15分足 (M15)" },
                            { value: "H1", label: "1時間足 (H1)" },
                          ]}
                        />
                      </div>
                      <div className="form-item">
                        <label className="form-label">保持バー本数</label>
                        <input
                          type="number"
                          className="input-compact font-data"
                          value={maxHistoryBars}
                          onChange={(e) => {
                            setMaxHistoryBars(parseInt(e.target.value) || 0);
                            saveAll();
                          }}
                        />
                      </div>
                    </div>
                  )}
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
                        saveAll(undefined, undefined, undefined, undefined, val);
                      }}
                      placeholder="D:\Drehis\economic"
                    />
                    <button
                      className="btn-secondary-compact"
                      style={{ display: "flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}
                      onClick={async () => {
                        try {
                          const selected = await invoke<string | null>("select_folder");
                          if (selected) {
                            setEconomicDataDir(selected);
                            saveAll(undefined, undefined, undefined, undefined, selected);
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
                          const def = await invoke<string>("get_default_economic_data_dir");
                          if (def) {
                            setEconomicDataDir(def);
                            saveAll(undefined, undefined, undefined, undefined, def);
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

          {/* 3. テーマ・外観設定 */}
          {activeTab === "theme" && (
            <div className="settings-tab-pane">
              <div className="theme-intro-header">
                <p className="theme-intro-text">
                  👀 <strong>眼精疲労軽減・視覚保護設計:</strong> 米国主要テック企業の最新デザインガイドラインに基づき、白文字の眩しさ（ハレーション）や過剰コントラストによる目の疲れ・チカチカを防止する最適な配色を採用しています。
                </p>
              </div>

              <div className="settings-section-card">
                <h3 className="section-title">
                  <span className="material-symbols-outlined icon">palette</span>
                  カラーテーマ選択 (5大プリセット)
                </h3>
                <div className="theme-cards-grid">
                  {THEME_LIST.map((themeItem) => {
                    const isActive = theme === themeItem.id;
                    return (
                      <div
                        key={themeItem.id}
                        className={`theme-card ${isActive ? "active" : ""}`}
                        onClick={() => {
                          setTheme(themeItem.id);
                          saveAll(undefined, undefined, undefined, themeItem.id);
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

              <div className="settings-section-card">
                <h3 className="section-title">
                  <span className="material-symbols-outlined icon">payments</span>
                  損益配色パターン
                </h3>
                <div className="pl-grid-cluster">
                  <button
                    className={`pl-style-card ${plColorStyle === "red-blue" ? "active" : ""}`}
                    onClick={() => {
                      setPlColorStyle("red-blue");
                      saveAll();
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
                      setPlColorStyle("green-red");
                      saveAll();
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
                      setOrderColorStyle("red-green");
                      saveAll();
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
                      setOrderColorStyle("blue-red");
                      saveAll();
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

          {/* 4. AI連携設定 */}
          {activeTab === "ai" && (
            <div className="settings-tab-pane">
              <div className="ai-status-card">
                <div className="ai-status-header">
                  <div>
                    <h3 className="section-title">
                      <span className="material-symbols-outlined icon ai-sparkle">auto_awesome</span>
                      API疎通確認 &amp; ステータス
                    </h3>
                    <p className="section-desc">急変動解析・経済指標連動に必要なAPIキーの通信状態をテストします</p>
                  </div>
                  <button
                    type="button"
                    className="btn-test-all-spacious"
                    onClick={handleTestAllApis}
                    disabled={isTestingAllApis}
                  >
                    <span className={`material-symbols-outlined icon ${isTestingAllApis ? "spin" : ""}`}>
                      {isTestingAllApis ? "sync" : "checklist"}
                    </span>
                    <span>{isTestingAllApis ? "接続テスト中..." : "全API一括テスト"}</span>
                  </button>
                </div>
              </div>

              {/* OpenRouter */}
              <div className="settings-section-card">
                <div className="api-card-header">
                  <div className="api-title-row">
                    <span className="api-name">OpenRouter API (LLM急変動解析)</span>
                    <span className="api-badge required">必須</span>
                  </div>
                  <button
                    type="button"
                    className="btn-test-single-card"
                    onClick={handleTestOpenRouter}
                    disabled={openRouterTestResult.status === "testing" || isTestingAllApis}
                  >
                    テスト実行
                  </button>
                </div>
                <input
                  type="password"
                  className="input-compact font-data"
                  value={openRouterApiKey}
                  onChange={(e) => {
                    setOpenRouterApiKey(e.target.value);
                    saveAll();
                  }}
                  placeholder="sk-or-v1-..."
                />
                {openRouterTestResult.status !== "idle" && (
                  <div className={`api-result-badge-spacious ${openRouterTestResult.status}`}>
                    <span className="material-symbols-outlined icon">
                      {openRouterTestResult.status === "testing"
                        ? "sync"
                        : openRouterTestResult.success
                        ? "check_circle"
                        : "error"}
                    </span>
                    <span>{openRouterTestResult.message}</span>
                  </div>
                )}

                <div className="model-select-row">
                  <label className="form-label">解析モデル選択</label>
                  <CustomSelect
                    value={openRouterModel}
                    onChange={(val) => {
                      setOpenRouterModel(val);
                      saveAll();
                    }}
                    options={[
                      { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash (推奨・超高速)" },
                      { value: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet (高精度)" },
                      { value: "openai/gpt-4o-mini", label: "GPT-4o Mini (軽量)" },
                      { value: "deepseek/deepseek-chat", label: "DeepSeek V3" },
                    ]}
                  />
                </div>
              </div>

              {/* FRED API */}
              <div className="settings-section-card">
                <div className="api-card-header">
                  <div className="api-title-row">
                    <span className="api-name">FRED API (米国連邦準備銀行 金利・経済データ)</span>
                    <span className="api-badge optional">任意</span>
                  </div>
                  <button
                    type="button"
                    className="btn-test-single-card"
                    onClick={handleTestFred}
                    disabled={fredTestResult.status === "testing" || isTestingAllApis}
                  >
                    テスト実行
                  </button>
                </div>
                <input
                  type="text"
                  className="input-compact font-data"
                  value={fredApiKey}
                  onChange={(e) => {
                    setFredApiKey(e.target.value);
                    saveAll();
                  }}
                  placeholder="FRED API Key"
                />
                {fredTestResult.status !== "idle" && (
                  <div className={`api-result-badge-spacious ${fredTestResult.status}`}>
                    <span className="material-symbols-outlined icon">
                      {fredTestResult.status === "testing"
                        ? "sync"
                        : fredTestResult.success
                        ? "check_circle"
                        : "error"}
                    </span>
                    <span>{fredTestResult.message}</span>
                  </div>
                )}
              </div>

              {/* Finnhub API */}
              <div className="settings-section-card">
                <div className="api-card-header">
                  <div className="api-title-row">
                    <span className="api-name">Finnhub API (FX経済指標・速報ニュース)</span>
                    <span className="api-badge optional">任意</span>
                  </div>
                  <button
                    type="button"
                    className="btn-test-single-card"
                    onClick={handleTestFinnhub}
                    disabled={finnhubTestResult.status === "testing" || isTestingAllApis}
                  >
                    テスト実行
                  </button>
                </div>
                <input
                  type="text"
                  className="input-compact font-data"
                  value={finnhubApiKey}
                  onChange={(e) => {
                    setFinnhubApiKey(e.target.value);
                    saveAll();
                  }}
                  placeholder="Finnhub API Key"
                />
                {finnhubTestResult.status !== "idle" && (
                  <div className={`api-result-badge-spacious ${finnhubTestResult.status}`}>
                    <span className="material-symbols-outlined icon">
                      {finnhubTestResult.status === "testing"
                        ? "sync"
                        : finnhubTestResult.success
                        ? "check_circle"
                        : "error"}
                    </span>
                    <span>{finnhubTestResult.message}</span>
                  </div>
                )}
              </div>

              {/* GDELT */}
              <div className="settings-section-card">
                <div className="api-card-header">
                  <div className="api-title-row">
                    <span className="api-name">GDELT Global News (キー不要・無料)</span>
                    <span className="api-badge free">無料</span>
                  </div>
                  <button
                    type="button"
                    className="btn-test-single-card"
                    onClick={handleTestGdelt}
                    disabled={gdeltTestResult.status === "testing" || isTestingAllApis}
                  >
                    接続確認
                  </button>
                </div>
                {gdeltTestResult.status !== "idle" && (
                  <div className={`api-result-badge-spacious ${gdeltTestResult.status}`}>
                    <span className="material-symbols-outlined icon">
                      {gdeltTestResult.status === "testing"
                        ? "sync"
                        : gdeltTestResult.success
                        ? "check_circle"
                        : "error"}
                    </span>
                    <span>{gdeltTestResult.message}</span>
                  </div>
                )}
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
