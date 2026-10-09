import React, { useState, useRef, useEffect } from "react";
import { COMMANDS } from "../../constants/commands";
import { invoke } from "@tauri-apps/api/core";
import { formatJstTime, formatServerTime } from "../../utils/timeUtils";
import { THEME_LIST, ThemeType } from "../../constants/themePresets";
import { SessionBoundaryInfo } from "../../domain/sessionBoundaries";
import { getCachedEconomicAvailabilityMap, isEconomicSpreadActive } from "../../utils/economicDataUtils";

interface AppHeaderProps {
  status: "DISCONNECTED" | "CONNECTED" | "READY" | "ACTIVE";
  virtualTimeMsc: number;
  timezoneMode: "JST" | "SERVER";
  setTimezoneMode: (mode: "JST" | "SERVER") => void;
  currentSession: SessionBoundaryInfo | null;
  subFeedRate: { active: boolean; symbol: string; bid: number; ask: number; spread: number } | null;
  mainFeedRate: { bid: number; ask: number; spread: number };
  sourceSymbol: string;
  alwaysOnTop: boolean;
  isShortcutsActive: boolean;
  theme?: ThemeType;
  setTheme?: (theme: ThemeType) => void;
  cycleTheme?: () => void;
  themeMode?: "dark" | "light";
  setThemeMode?: (mode: "dark" | "light") => void;
  saveAllSettings: (
    nextHotkeys?: Record<string, string>,
    nextTimePresets?: number[],
    nextTickPresets?: number[],
    nextTheme?: ThemeType
  ) => void;
  hotkeys: Record<string, string>;
  timePresets: number[];
  tickPresets: number[];
  handleAlwaysOnTopToggle: () => void;
  handleShortcutsToggle: () => void;
  toggleRemoteMode: (val: boolean) => void;
  handleTerminate: () => void;
  setIsSettingsOpen: (val: boolean) => void;
  setIsSaveSessionOpen: (val: boolean) => void;
  setSaveSessionName: (val: string) => void;
  setSaveAsNewSnapshot: (val: boolean) => void;
  setSessionSaveType: (val: "manual" | "terminate") => void;
  currentSessionId: string | null;
  currentSessionName: string;
  getDayOfWeekStr: (msc: number, isJst: boolean) => string;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  status,
  virtualTimeMsc,
  timezoneMode,
  setTimezoneMode,
  currentSession,
  subFeedRate,
  mainFeedRate,
  sourceSymbol,
  alwaysOnTop,
  isShortcutsActive,
  theme = "dark",
  setTheme,
  cycleTheme,
  saveAllSettings,
  hotkeys,
  timePresets,
  tickPresets,
  handleAlwaysOnTopToggle,
  handleShortcutsToggle,
  toggleRemoteMode,
  handleTerminate,
  setIsSettingsOpen,
  setIsSaveSessionOpen,
  setSaveSessionName,
  setSaveAsNewSnapshot,
  setSessionSaveType,
  currentSessionId,
  currentSessionName,
  getDayOfWeekStr,
}) => {
  const [isSubmenuOpen, setIsSubmenuOpen] = useState(false);
  const submenuRef = useRef<HTMLDivElement | null>(null);

  // --- 経済指標データ充足状態 ---
  const [economicMap, setEconomicMap] = useState<Record<string, boolean>>(() => getCachedEconomicAvailabilityMap());

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "replay-economic-availability" && e.newValue) {
        try {
          setEconomicMap(JSON.parse(e.newValue));
        } catch (err) {
          console.error("Failed to parse economic availability in header", err);
        }
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const isEconomicMode = isEconomicSpreadActive(virtualTimeMsc, economicMap);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (submenuRef.current && !submenuRef.current.contains(event.target as Node)) {
        setIsSubmenuOpen(false);
      }
    };
    if (isSubmenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isSubmenuOpen]);

  const formattedDate =
    timezoneMode === "JST"
      ? `${formatJstTime(virtualTimeMsc).substring(0, 10).replace(/-/g, ".")} ${getDayOfWeekStr(virtualTimeMsc, true)}`
      : `${formatServerTime(virtualTimeMsc).substring(0, 10).replace(/-/g, ".")} ${getDayOfWeekStr(virtualTimeMsc, false)}`;

  const formattedTime =
    timezoneMode === "JST"
      ? formatJstTime(virtualTimeMsc).substring(11, 19)
      : formatServerTime(virtualTimeMsc).substring(11, 19);

  return (
    <>
      <header className="header-obsidian">
        {/* 左側：接続ステータス & 時刻・市場HUD */}
        <div className="header-left">
          <div
            className={`status-led ${status.toLowerCase()}`}
            title={`接続状態: ${
              status === "DISCONNECTED"
                ? "未接続 (EA待機中)"
                : status === "CONNECTED"
                ? "接続完了"
                : status === "READY"
                ? "準備完了"
                : "リプレイ動作中"
            }`}
          />

          {/* デジタル時計 & タイムゾーン切替 */}
          <button
            className="hud-clock-badge"
            onClick={() => setTimezoneMode(timezoneMode === "JST" ? "SERVER" : "JST")}
            title={`表示タイムゾーン切替 (現在: ${timezoneMode === "JST" ? "JST 日本時間" : "SERVER MT5サーバー時刻"})\nクリックで切替`}
          >
            <span className="hud-tz-tag">{timezoneMode}</span>
            <span className="hud-clock-time">{formattedTime || "00:00:00"}</span>
          </button>

          {/* アクティブ市場セッションバッジ */}
          {currentSession ? (
            <div
              className={`session-pill-compact ${currentSession.type.toLowerCase()}`}
              title={`現在の市場: ${
                currentSession.type === "TYO" ? "東京市場" : currentSession.type === "LDN" ? "ロンドン市場" : "NY市場"
              }`}
            >
              <span className="session-pill-dot" />
              <span>{currentSession.type}</span>
            </div>
          ) : (
            <span className="hud-date-compact">{formattedDate.substring(5)}</span>
          )}

          {/* 経済指標連動 / 通常モードバッジ */}
          {(status === "ACTIVE" || status === "READY") && (
            <div
              className={`hud-spread-mode-badge ${isEconomicMode ? "mode-indicator" : "mode-normal"}`}
              title={
                isEconomicMode
                  ? "【指標連動モード】現在の期間は経済指標データに基づいて、発表前後のスプレッドが強度に応じて先行拡大・動的変動します。"
                  : "【通常モード】現在の期間は経済指標データがないため、平時固定スプレッド（仲値・早朝流動性制御のみ）で動作しています。"
              }
            >
              <span className="spread-mode-dot" />
              <span className="spread-mode-label">{isEconomicMode ? "指標連動" : "通常"}</span>
            </div>
          )}
        </div>

        {/* 右側：クイックアクションボタングループ */}
        <div className="header-actions">
          {/* 1. スピード発注パネル (最重要：目立つアクセント) */}
          {(status === "ACTIVE" || status === "READY") && (
            <button
              className="header-btn action-speed-order"
              onClick={async () => {
                try {
                  await invoke(COMMANDS.openSpeedOrderWindow);
                } catch (err) {
                  console.error(err);
                }
              }}
              title="スピード発注パネルを起動 (別ウィンドウ)"
            >
              <span className="material-symbols-outlined icon">monetization_on</span>
              <span className="btn-label">発注</span>
            </button>
          )}

          {/* 2. 口座・ポジション管理 */}
          {(status === "ACTIVE" || status === "READY") && (
            <button
              className="header-btn"
              onClick={() => invoke(COMMANDS.openPositionsWindow).catch(console.error)}
              title="口座残高・保有ポジション管理ウィンドウを起動"
            >
              <span className="material-symbols-outlined icon">account_balance_wallet</span>
            </button>
          )}

          {/* 3. セッション保存 (検証時のみ) */}
          {(status === "READY" || status === "ACTIVE") && (
            <button
              className="header-btn"
              onClick={() => {
                const now = new Date();
                const pad = (n: number) => n.toString().padStart(2, "0");
                const defaultName = `${sourceSymbol}_Replay_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
                  now.getDate()
                )}_${pad(now.getHours())}${pad(now.getMinutes())}`;
                setSaveSessionName(currentSessionId ? currentSessionName : defaultName);
                setSaveAsNewSnapshot(false);
                setSessionSaveType("manual");
                setIsSaveSessionOpen(true);
              }}
              title="現在の検証状態をスナップショット保存"
            >
              <span className="material-symbols-outlined icon">save</span>
            </button>
          )}

          {/* 4. 統合サブメニュー (設定・補助ツール) */}
          <div className="header-submenu-anchor" ref={submenuRef}>
            <button
              className={`header-btn ${isSubmenuOpen ? "active" : ""}`}
              onClick={() => setIsSubmenuOpen(!isSubmenuOpen)}
              title="システム設定 & 補助ツール"
            >
              <span className="material-symbols-outlined icon">more_vert</span>
              {(alwaysOnTop || isShortcutsActive) && (
                <span className="submenu-active-dot" title="補助機能が有効です" />
              )}
            </button>

            {isSubmenuOpen && (
              <div className="header-submenu-popover">
                <div className="popover-header">システム &amp; 補助機能</div>

                {/* 環境設定 */}
                <button
                  className="popover-item"
                  onClick={async () => {
                    setIsSubmenuOpen(false);
                    try {
                      await invoke(COMMANDS.openSettingsWindow);
                    } catch (err) {
                      console.warn("Failed to open standalone settings window, falling back to modal:", err);
                      setIsSettingsOpen(true);
                    }
                  }}
                >
                  <span className="material-symbols-outlined popover-icon">settings</span>
                  <span className="popover-label">環境設定 (Hotkeys/Theme)</span>
                </button>

                {/* 口座・ポジション管理 */}
                <button
                  className="popover-item"
                  onClick={async () => {
                    setIsSubmenuOpen(false);
                    try {
                      await invoke(COMMANDS.openPositionsWindow);
                    } catch (err) {
                      console.error("Failed to open positions window:", err);
                    }
                  }}
                >
                  <span className="material-symbols-outlined popover-icon text-emerald">account_balance_wallet</span>
                  <span className="popover-label">口座・ポジション管理 (残高/建玉)</span>
                </button>

                {/* 独立トレード分析アプリ (Tracely) */}
                <button
                  className="popover-item"
                  onClick={async () => {
                    try {
                      await invoke(COMMANDS.openTracelyApp);
                      setIsSubmenuOpen(false);
                    } catch (err) {
                      console.error(err);
                    }
                  }}
                >
                  <span className="material-symbols-outlined popover-icon text-indigo">analytics</span>
                  <span className="popover-label">トレード分析</span>
                </button>

                <div className="popover-divider" />

                {/* 最前面固定トグル */}
                <button
                  className={`popover-item ${alwaysOnTop ? "active-toggle" : ""}`}
                  onClick={() => handleAlwaysOnTopToggle()}
                >
                  <span className="material-symbols-outlined popover-icon">push_pin</span>
                  <span className="popover-label">最前面に固定</span>
                  <span className={`popover-tag ${alwaysOnTop ? "on" : "off"}`}>
                    {alwaysOnTop ? "ON" : "OFF"}
                  </span>
                </button>

                {/* グローバルショートカットトグル */}
                <button
                  className={`popover-item ${isShortcutsActive ? "active-toggle" : ""}`}
                  onClick={() => handleShortcutsToggle()}
                >
                  <span className="material-symbols-outlined popover-icon">keyboard</span>
                  <span className="popover-label">ホットキー操作</span>
                  <span className={`popover-tag ${isShortcutsActive ? "on" : "off"}`}>
                    {isShortcutsActive ? "ON" : "OFF"}
                  </span>
                </button>

                {/* リモコンモード切替 */}
                <button
                  className="popover-item"
                  onClick={() => {
                    toggleRemoteMode(true);
                    setIsSubmenuOpen(false);
                  }}
                >
                  <span className="material-symbols-outlined popover-icon">settings_remote</span>
                  <span className="popover-label">リモコンモード (HUDバー)</span>
                </button>

                <div className="popover-divider" />

                {/* テーマ切替 */}
                {(() => {
                  const currentConfig = THEME_LIST.find((t) => t.id === theme) || THEME_LIST[0];
                  return (
                    <button
                      className="popover-item"
                      onClick={() => {
                        if (cycleTheme) {
                          cycleTheme();
                        } else if (setTheme) {
                          const themes: ThemeType[] = ["dark", "dim", "light", "sepia", "warm-sepia"];
                          const cur = theme || "dark";
                          const next = themes[(themes.indexOf(cur) + 1) % themes.length];
                          setTheme(next);
                          saveAllSettings(hotkeys, timePresets, tickPresets, next);
                        }
                      }}
                      title="クリックで5つのテーマを順次切り替えます"
                    >
                      <span className="popover-icon" style={{ fontSize: "16px", display: "inline-flex", alignItems: "center" }}>
                        {currentConfig.icon}
                      </span>
                      <span className="popover-label">
                        テーマ: {currentConfig.nameJa}
                      </span>
                      <span className="popover-tag" style={{ fontSize: "9px" }}>
                        {currentConfig.nameEn}
                      </span>
                    </button>
                  );
                })()}
              </div>
            )}
          </div>

          {/* 5. リプレイ終了ボタン (Dangerカラー) */}
          {(status === "READY" || status === "ACTIVE") && (
            <button
              className="header-btn btn-danger"
              onClick={handleTerminate}
              title="リプレイ検証を終了しMT5環境をクリア"
            >
              <span className="material-symbols-outlined icon">power_settings_new</span>
            </button>
          )}
        </div>
      </header>

      {/* デュアルフィード稼働時のインラインスプレッドバー */}
      {subFeedRate && subFeedRate.active && (
        <div className="dual-feed-ticker">
          <div className="feed-item main">
            <span className="feed-tag">MAIN</span>
            <span className="feed-rates">
              {mainFeedRate.bid.toFixed(3)} / {mainFeedRate.ask.toFixed(3)}
            </span>
            <span className="feed-spread">({mainFeedRate.spread.toFixed(1)}p)</span>
          </div>
          <div className="feed-divider" />
          <div className="feed-item sub">
            <span className="feed-tag">SUB</span>
            <span className="feed-rates">
              {subFeedRate.bid.toFixed(3)} / {subFeedRate.ask.toFixed(3)}
            </span>
            <span className="feed-spread">({subFeedRate.spread.toFixed(1)}p)</span>
          </div>
        </div>
      )}
    </>
  );
};
