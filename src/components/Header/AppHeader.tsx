import React, { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatJstTime, formatServerTime } from "../../utils/timeUtils";

export interface AppHeaderProps {
  status: "DISCONNECTED" | "CONNECTED" | "READY" | "ACTIVE";
  virtualTimeMsc: number;
  timezoneMode: "JST" | "SERVER";
  setTimezoneMode: (mode: "JST" | "SERVER") => void;
  currentSession: any;
  subFeedRate: { active: boolean; symbol: string; bid: number; ask: number; spread: number } | null;
  mainFeedRate: { bid: number; ask: number; spread: number };
  sourceSymbol: string;
  alwaysOnTop: boolean;
  isShortcutsActive: boolean;
  themeMode: "dark" | "light";
  setThemeMode: (mode: "dark" | "light") => void;
  saveAllSettings: (...args: any[]) => void;
  hotkeys: any;
  timePresets: number[];
  tickPresets: number[];
  glassEffect: boolean;
  handleAlwaysOnTopToggle: () => void;
  handleShortcutsToggle: () => void;
  toggleRemoteMode: (val: boolean) => void;
  handleTerminate: () => void;
  setIsSettingsOpen: (val: boolean) => void;
  setIsAIPanelOpen: (val: boolean) => void;
  setAiTargetTimeMsc: (val: number) => void;
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
  themeMode,
  setThemeMode,
  saveAllSettings,
  hotkeys,
  timePresets,
  tickPresets,
  glassEffect,
  handleAlwaysOnTopToggle,
  handleShortcutsToggle,
  toggleRemoteMode,
  handleTerminate,
  setIsSettingsOpen,
  setIsAIPanelOpen,
  setAiTargetTimeMsc,
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
        </div>

        {/* 右側：クイックアクションボタングループ */}
        <div className="header-actions">
          {/* 1. スピード発注パネル (最重要：目立つアクセント) */}
          {(status === "ACTIVE" || status === "READY") && (
            <button
              className="header-btn action-speed-order"
              onClick={async () => {
                try {
                  await invoke("open_speed_order_window");
                } catch (err) {
                  console.error(err);
                }
              }}
              title="スピード発注パネルを起動 (別ウィンドウ)"
            >
              <span className="material-symbols-outlined icon">flash_on</span>
              <span className="btn-label">発注</span>
            </button>
          )}

          {/* 2. 口座・ポジション管理 */}
          {(status === "ACTIVE" || status === "READY") && (
            <button
              className="header-btn"
              onClick={() => invoke("open_positions_window").catch(console.error)}
              title="口座残高・保有ポジション管理ウィンドウを起動"
            >
              <span className="material-symbols-outlined icon">account_balance_wallet</span>
            </button>
          )}

          {/* 3. AI急変動・ファンダメンタルズ解析 */}
          <button
            className="header-btn"
            onClick={() => {
              setAiTargetTimeMsc(virtualTimeMsc);
              setIsAIPanelOpen(true);
            }}
            title="急変動・トレンドAI解析を開く"
          >
            <span className="material-symbols-outlined icon ai-sparkle">auto_awesome</span>
          </button>

          {/* 4. セッション保存 (検証時のみ) */}
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

          {/* 5. 統合サブメニュー (設定・補助ツール) */}
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
                      await invoke("open_settings_window");
                    } catch (err) {
                      console.warn("Failed to open standalone settings window, falling back to modal:", err);
                      setIsSettingsOpen(true);
                    }
                  }}
                >
                  <span className="material-symbols-outlined popover-icon">settings</span>
                  <span className="popover-label">環境設定 (Hotkeys/AI/Theme)</span>
                </button>

                {/* 独立トレード分析アプリ (Tracely) */}
                <button
                  className="popover-item"
                  onClick={async () => {
                    try {
                      await invoke("open_tracely_app");
                      setIsSubmenuOpen(false);
                    } catch (err) {
                      console.error(err);
                    }
                  }}
                >
                  <span className="material-symbols-outlined popover-icon text-indigo">analytics</span>
                  <span className="popover-label">トレード分析 (Tracely)</span>
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
                <button
                  className="popover-item"
                  onClick={() => {
                    const nextMode = themeMode === "dark" ? "light" : "dark";
                    setThemeMode(nextMode);
                    saveAllSettings(hotkeys, timePresets, tickPresets, glassEffect, nextMode);
                  }}
                >
                  <span className="material-symbols-outlined popover-icon">
                    {themeMode === "dark" ? "light_mode" : "dark_mode"}
                  </span>
                  <span className="popover-label">
                    {themeMode === "dark" ? "ライトモードに切替" : "ダークモードに切替"}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* 6. リプレイ終了ボタン (Dangerカラー) */}
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
