import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { COMMANDS } from "./constants/commands";
import { EVENTS } from "./constants/events";
import { DEFAULT_SPEED_TIME_PRESETS, DEFAULT_SPEED_TICK_PRESETS } from "./constants/speedPresets";
import { STORAGE_KEYS } from "./constants/storageKeys";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import "./App.css";
import type { SymbolItem } from "./types/symbol";
import { CustomSymbolImportModal } from "./components/CustomSymbolImportModal";
import { SymbolBatchSelectorModal } from "./components/SymbolBatchSelectorModal";
import { SymbolSelectorWindowContent } from "./components/SymbolSelectorWindowContent";
import { DateTimePickerModal } from "./components/DateTimePickerModal";
import { SpeedOrderWindowContent } from "./components/SpeedOrderWindowContent";
import { PositionsWindowContent } from "./components/PositionsWindowContent";
import { SettingsWindowContent } from "./components/Settings/SettingsWindowContent";
import { DeleteSessionModal } from "./components/DeleteSessionModal";
import {
  EconomicDataMissingModal,
  TerminalNameModal,
  ClearAllSessionsConfirmModal,
  ResetReplayConfirmModal,
  ResetTradingConfirmModal,
  MaxBarsWarningModal,
  SaveSessionModal,
  TimeStepsModal,
  SpeedPresetsModal,
} from "./components/Modals";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppHeader } from "./components/Header/AppHeader";
import { SetupPanel } from "./components/Setup/SetupPanel";
import { RemoteHudBar } from "./components/Remote/RemoteHudBar";
import { SettingsModal } from "./components/Settings/SettingsModal";
import { parseSymbolName, getCompanionSymbols, switchSymbolSuffix, getAllYears, checkSymbolYearMismatch } from "./utils/symbolUtils";
import { parseDateTimeStr, alignDateRangeToYear } from "./utils/dateUtils";
import { checkEconomicDataAvailability } from "./utils/economicDataUtils";
import { useAppearance } from "./hooks/useAppearance";
import {
  DEFAULT_TIME_STEPS,
  MAX_TIME_STEPS,
} from "./domain/timeSteps";
import { formatTerminalNamesMap } from "./domain/settings";
import type { FeedRate, SubFeedRate, TimeStepItem } from "./types/replay";
import {
  getServerToJstOffsetHours,
  convertServerStrToJstStr as convertServerToJstStr,
  getNewsTimeForDisplay
} from "./utils/timeUtils";
import {
  DEFAULT_HOTKEYS,
  getTauriShortcutFromEvent,
  matchesHotkey,
  MaxBarsInfo
} from "./utils/hotkeyUtils";
import { TerminalInfo } from "./types/terminal";
import {
  ReplayProgressPayload,
  SessionBoundariesData,
} from "./types";
import { SavedSession } from "./types/session";
import { PersistedSettings } from "./types/settings";
import type { ExpandedGroupsMap } from "./types/uiState";
import { TradeHistoryItem, VirtualAccount, VirtualPosition } from "./types/trading";
import { translateErrorMessage } from "./utils/i18nUtils";
import { organizeSessions, getCurrentSession } from "./domain/sessionBoundaries";
import {
  nextAccount,
  nextMainFeedRate,
  nextSubFeedRate,
  nextPositions,
  shouldApplyHistory
} from "./domain/tradeStateUpdate";
import { ReplayCommand, sendReplayCommand } from "./utils/command";
import { resolveWindowVisibility } from "./domain/windowVisibility";



interface SymbolSelectionPayload {
  sourceSymbol?: string;
  subSourceSymbol?: string;
  enableDualFeed?: boolean;
  syncSymbols?: string[] | string;
  dateRange?: { start?: string; end?: string };
}

interface AppHandlers {
  handlePlayPause: () => void;
  handleStep: (delta: number) => void;
  handleSessionJump: (session: string, direction: "PREV" | "NEXT") => void;
  handleTimeJump: (seconds: number) => void;
  handleCoarseSpeed: (increment: boolean) => void;
  handleMediumSpeed: (increment: boolean) => void;
  handleFineSpeed: (increment: boolean) => void;
  updateSpeed: (mode: "TEMPORAL" | "COUNT", multiplier: number, tickStep: number) => void;
  speedMode: "TEMPORAL" | "COUNT";
  multiplier: number;
  tickStep: number;
  handleSetLoopA: () => void;
  handleSetLoopB: () => void;
  handleClearLoop: () => void;
  handleReset: () => void;
  hotkeys: Record<string, string>;
  recordingAction: string | null;
}

import { ControllerWindowContent } from "./components/Controls/ControllerWindowContent";
import { TimelineWindowContent } from "./components/Timeline/TimelineWindowContent";
/**
 * ウィンドウ種別ごとの入口。?window=... で子ウィンドウを出し分ける。
 * URL 分岐だけを担当し、フックを持たない。
 */
function WindowRouter() {
  const windowParam = new URLSearchParams(window.location.search).get("window");

  if (windowParam === "speed_order") {
    return (
      <ErrorBoundary fallbackTitle="スピード発注画面エラー">
        <SpeedOrderWindowContent />
      </ErrorBoundary>
    );
  }
  if (windowParam === "positions") {
    return (
      <ErrorBoundary fallbackTitle="口座・ポジション管理画面エラー">
        <PositionsWindowContent />
      </ErrorBoundary>
    );
  }
  if (windowParam === "settings") {
    return (
      <ErrorBoundary fallbackTitle="環境設定画面エラー">
        <SettingsWindowContent />
      </ErrorBoundary>
    );
  }
  if (windowParam === "controller") {
    return (
      <ErrorBoundary fallbackTitle="リプレイ操作コントローラーエラー">
        <ControllerWindowContent />
      </ErrorBoundary>
    );
  }
  if (windowParam === "symbol_selector") {
    return (
      <ErrorBoundary fallbackTitle="シンボル選択セレクターエラー">
        <SymbolSelectorWindowContent />
      </ErrorBoundary>
    );
  }
  if (windowParam === "timeline") {
    return (
      <ErrorBoundary fallbackTitle="タイムライン・ナビゲーターエラー">
        <TimelineWindowContent />
      </ErrorBoundary>
    );
  }

  return <MainWindow />;
}

/**
 * メイン画面。URL 分岐を含まないため、フックを無条件に呼べる。
 */
function MainWindow() {
  // --- 接続状態・EAからのステータス
  const [status, setStatus] = useState<"DISCONNECTED" | "CONNECTED" | "READY" | "ACTIVE">("DISCONNECTED");
  const [totalTicks, setTotalTicks] = useState(0);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [virtualTimeMsc, setVirtualTimeMsc] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const playStateGuardRef = useRef<{ expected: boolean; expireAt: number } | null>(null);
  const [speedMode, setSpeedMode] = useState<"TEMPORAL" | "COUNT">("TEMPORAL");
  const [multiplier, setMultiplier] = useState(1.0);
  const [tickStep, setTickStep] = useState(1);
  const [_loopActive, setLoopActive] = useState(false);
  const [_loopA, setLoopA] = useState(-1);
  const [_loopB, setLoopB] = useState(-1);
  const [_loopAIdx, setLoopAIdx] = useState(-1);
  const [_loopBIdx, setLoopBIdx] = useState(-1);
  const [sessionBoundaries, setSessionBoundaries] = useState<SessionBoundariesData>({ TYO: [], LDN: [], NY: [] });

  // --- ローディング状態 (リプレイ初期化中)
  const [isReplayInitializing, setIsReplayInitializingState] = useState(false);
  const isReplayInitializingRef = useRef(false);
  const initTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setIsReplayInitializing = (val: boolean) => {
    isReplayInitializingRef.current = val;
    setIsReplayInitializingState(val);
    if (initTimeoutRef.current) {
      clearTimeout(initTimeoutRef.current);
      initTimeoutRef.current = null;
    }
    if (val) {
      initTimeoutRef.current = setTimeout(() => {
        if (isReplayInitializingRef.current) {
          isReplayInitializingRef.current = false;
          setIsReplayInitializingState(false);
          setErrorMessage("初期化タイムアウト: MT5からの応答がないか、データロードに失敗した可能性があります。");
        }
      }, 30000);
    }
  };

  const [setupTab, setSetupTab] = useState<"replay" | "trading" | "resume">("replay");
  const [restoringSession, setRestoringSession] = useState<SavedSession | null>(null);
  const restoringSessionRef = useRef<SavedSession | null>(null);
  const isRestoringRef = useRef(false);
  const updateRestoringSession = (session: SavedSession | null) => {
    restoringSessionRef.current = session;
    setRestoringSession(session);
  };
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [isSaveSessionOpen, setIsSaveSessionOpen] = useState(false);
  const [isDeleteSessionConfirmOpen, setIsDeleteSessionConfirmOpen] = useState(false);
  const [sessionsToDelete, setSessionsToDelete] = useState<string[]>([]);
  const [deleteConfirmMessage, setDeleteConfirmMessage] = useState<string>("");
  const [isClearAllSessionsConfirmOpen, setIsClearAllSessionsConfirmOpen] = useState(false);
  const [saveSessionName, setSaveSessionName] = useState("");
  const [sessionSaveType, setSessionSaveType] = useState<"manual" | "terminate">("manual");

  // 固有セッション管理用の追加State
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentSessionName, setCurrentSessionName] = useState<string>("");
  const [currentGroupSessionId, setCurrentGroupSessionId] = useState<string | null>(null);
  const [saveAsNewSnapshot, setSaveAsNewSnapshot] = useState<boolean>(false);
  const [expandedGroups, setExpandedGroups] = useState<ExpandedGroupsMap>({});

  // 経済指標データの充足確認モーダル用 State
  const [isEconomicWarningOpen, setIsEconomicWarningOpen] = useState(false);
  const [economicMissingMonths, setEconomicMissingMonths] = useState<string[]>([]);
  const [economicAvailableMonths, setEconomicAvailableMonths] = useState<string[]>([]);
  const [_economicAvailabilityMap, setEconomicAvailabilityMap] = useState<Record<string, boolean>>({});
  const [economicDataDir, setEconomicDataDir] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.replayEconomicDataDir) || "");

  // 新規スナップショット保存チェックボックス切り替え時に保存名を動的に更新する
  useEffect(() => {
    if (isSaveSessionOpen && currentSessionId) {
      if (saveAsNewSnapshot) {
        const now = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}`;
        setSaveSessionName(`${currentSessionName}_Snapshot_${timeStr}`);
      } else {
        setSaveSessionName(currentSessionName);
      }
    }
  }, [saveAsNewSnapshot, isSaveSessionOpen, currentSessionId, currentSessionName]);

  const [enableVirtualTrading, setEnableVirtualTradingState] = useState(true);
  const enableVirtualTradingRef = useRef(true);
  const setEnableVirtualTrading = (val: boolean) => {
    enableVirtualTradingRef.current = val;
    setEnableVirtualTradingState(val);
  };

  const [initialBalance, setInitialBalanceState] = useState(1000000);
  const initialBalanceRef = useRef(1000000);
  const setInitialBalance = (val: number) => {
    initialBalanceRef.current = val;
    setInitialBalanceState(val);
  };

  const [leverage, setLeverageState] = useState(25);
  const leverageRef = useRef(25);
  const setLeverage = (val: number) => {
    leverageRef.current = val;
    setLeverageState(val);
  };

  const [contractSize, setContractSize] = useState(10000);

  // --- Pipsと価格差の相互変換ヘルパー
  const pipsToPriceDiff = (symbol: string, pips: number): number => {
    const sym = symbol.toUpperCase();
    if (sym.includes("JPY")) return Math.max(0, pips * 0.01);
    if (sym.includes("XAU") || sym.includes("GOLD")) return Math.max(0, pips * 0.1);
    if (sym.includes("BTC") || sym.includes("ETH") || sym.includes("225") || sym.includes("US30") || sym.includes("NAS")) return Math.max(0, pips * 1.0);
    return Math.max(0, pips * 0.0001);
  };



  const [enablePseudoRate, setEnablePseudoRate] = useState(true);
  const [pseudoBaseSpread, setPseudoBaseSpread] = useState(0.2);  // 0.2 pips
  const [pseudoThreshold, setPseudoThreshold] = useState(1.5);    // 1.5 pips（242万ティック実測最適）
  const [pseudoSensitivity, setPseudoSensitivity] = useState(0.25); // 0.25（USDJPY実測最適）
  const [pseudoMode, setPseudoMode] = useState<"dmm" | "fixed" | "aggressive" | "custom">("dmm");
  const [pseudoRolloverEnabled, setPseudoRolloverEnabled] = useState(true);
  const [pseudoRolloverSpread, setPseudoRolloverSpread] = useState(3.8); // 3.8 pips（実測早朝ワイド帯）
  const [pseudoRolloverRecoveryMin, setPseudoRolloverRecoveryMin] = useState(15); // 15分
  const isInitialLoadRef = useRef(true);
  const [isInitialized, setIsInitialized] = useState(false);

  // --- 仮想取引関連のステータス
  const [account, setAccount] = useState<VirtualAccount | null>(null);
  const [positions, setPositions] = useState<VirtualPosition[]>([]);
  const [history, setHistory] = useState<TradeHistoryItem[]>([]);
  const historyRevisionRef = useRef<number | undefined>(undefined);

  // --- 自動スキャン・設定用状態
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [selectedTerminal, setSelectedTerminal] = useState("");
  const [isTerminalNameModalOpen, setIsTerminalNameModalOpen] = useState(false);
  const [editingTerminal, setEditingTerminal] = useState<TerminalInfo | null>(null);

  const handleOpenTerminalNameModal = (terminal?: TerminalInfo | null) => {
    const target = terminal || terminals.find((t) => t.path === selectedTerminal) || null;
    if (target) {
      setEditingTerminal(target);
      setIsTerminalNameModalOpen(true);
    }
  };

  const handleSaveTerminalName = async (terminalPath: string, customName: string) => {
    try {
      await invoke(COMMANDS.saveTerminalName, { terminalPath, customName });
      setTerminals((prev) =>
        prev.map((t) => {
          if (t.path === terminalPath) {
            const newCustomName = customName.trim() ? customName.trim() : undefined;
            return {
              ...t,
              custom_name: newCustomName,
              name: newCustomName || t.default_name || t.id || t.name,
            };
          }
          return t;
        })
      );
    } catch (err) {
      console.error("Failed to save terminal name:", err);
    }
  };

  const handleResetTerminalName = async (terminalPath: string) => {
    try {
      await invoke(COMMANDS.saveTerminalName, { terminalPath, customName: "" });
      setTerminals((prev) =>
        prev.map((t) => {
          if (t.path === terminalPath) {
            return {
              ...t,
              custom_name: undefined,
              name: t.default_name || t.id || t.name,
            };
          }
          return t;
        })
      );
    } catch (err) {
      console.error("Failed to reset terminal name:", err);
    }
  };

  const [profiles, setProfiles] = useState<string[]>([]);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [maxBarsInfo, setMaxBarsInfo] = useState<MaxBarsInfo | null>(null);
  const [isMaxBarsWarningOpen, setIsMaxBarsWarningOpen] = useState(false);
  const [sourceSymbol, setSourceSymbol] = useState("USDJPY");
  const [enableDualFeed, setEnableDualFeed] = useState(false);
  const [subSourceSymbol, setSubSourceSymbol] = useState("");
  const [mainFeedRate, setMainFeedRate] = useState<FeedRate>({ bid: 0, ask: 0, spread: 0 });
  const [subFeedRate, setSubFeedRate] = useState<SubFeedRate | null>(null);
  const [, setChartSymbol] = useState("");
  const hasSavedSymbolRef = useRef(false);
  const [additionalSymbols, setAdditionalSymbols] = useState("");
  const [isCustomImportOpen, setIsCustomImportOpen] = useState(false);
  const [isBatchSelectorOpen, setIsBatchSelectorOpen] = useState(false);
  const [availableSymbols, setAvailableSymbols] = useState<SymbolItem[]>([]);

  // 同一サフィックス（同一年または同一タグ）の他通貨ペアを自動検出
  const companionSymbols = useMemo(() => {
    const syncList = additionalSymbols ? additionalSymbols.split(",").map(s => s.trim()).filter(Boolean) : [];
    return getCompanionSymbols(sourceSymbol, availableSymbols, syncList);
  }, [sourceSymbol, availableSymbols, additionalSymbols]);

  // 利用可能な全年度リスト
  const availableYears = useMemo(() => getAllYears(availableSymbols), [availableSymbols]);

  // ソースシンボルの年度・サフィックス変更時に同期他通貨のサフィックスを自動連動置換 & 期間年度連動
  const prevSourceRef = useRef(sourceSymbol);
  useEffect(() => {
    const prev = prevSourceRef.current;
    if (prev && prev !== sourceSymbol) {
      const prevParsed = parseSymbolName(prev);
      const nextParsed = parseSymbolName(sourceSymbol);
      if (prevParsed.suffix && nextParsed.suffix && prevParsed.suffix !== nextParsed.suffix) {
        const syncList = additionalSymbols ? additionalSymbols.split(",").map(s => s.trim()).filter(Boolean) : [];
        if (syncList.length > 0) {
          const updated = switchSymbolSuffix(syncList, prevParsed.suffix, nextParsed.suffix, availableSymbols);
          if (updated.join(",") !== syncList.join(",")) {
            setAdditionalSymbols(updated.join(","));
          }
        }
      }

      // シンボル年度に応じた検証期間の自動アライン
      if (nextParsed.year) {
        const targetYear = parseInt(nextParsed.year);
        if (!isNaN(targetYear)) {
          setStartTime((prevStart) => {
            const startParsed = parseDateTimeStr(prevStart);
            if (startParsed.year !== targetYear) {
              setEndTime((prevEnd) => {
                const aligned = alignDateRangeToYear(prevStart, prevEnd, targetYear);
                return aligned.end;
              });
              const aligned = alignDateRangeToYear(prevStart, prevStart, targetYear);
              return aligned.start;
            }
            return prevStart;
          });
        }
      }
    }
    prevSourceRef.current = sourceSymbol;
  }, [sourceSymbol, additionalSymbols, availableSymbols]);

  const loadAvailableSymbols = async (terminalPath: string) => {
    try {
      const list = await invoke<SymbolItem[]>(COMMANDS.getAvailableSymbols, { terminalPath });
      setAvailableSymbols(list);
    } catch (err) {
      console.error("Failed to load available symbols:", err);
    }
  };

  useEffect(() => {
    loadAvailableSymbols(selectedTerminal);
  }, [selectedTerminal]);

  // シンボル選択セレクターウィンドウを開く
  const handleOpenSymbolSelector = async () => {
    try {
      localStorage.setItem(STORAGE_KEYS.selectedTerminalPath, selectedTerminal);
      localStorage.setItem(
        STORAGE_KEYS.symbolSelectorCurrentState,
        JSON.stringify({
          sourceSymbol,
          subSourceSymbol,
          enableDualFeed,
          additionalSymbols,
          availableSymbols,
          startTime,
          endTime,
        })
      );
      await emit(EVENTS.symbolSelectorInit, {
        sourceSymbol,
        subSourceSymbol,
        enableDualFeed,
        additionalSymbols,
        availableSymbols,
        startTime,
        endTime,
      });
      await invoke(COMMANDS.openSymbolSelectorWindow);
    } catch (err) {
      console.warn("Failed to open symbol selector window via invoke, opening modal fallback:", err);
      setIsBatchSelectorOpen(true);
    }
  };

  // セレクターウィンドウからの選択結果適用イベントを受信
  useEffect(() => {
    const unlisten = listen<SymbolSelectionPayload>(EVENTS.applySymbolSelection, (event) => {
      const data = event.payload;
      if (data.sourceSymbol) setSourceSymbol(data.sourceSymbol);
      if (data.subSourceSymbol !== undefined) setSubSourceSymbol(data.subSourceSymbol);
      if (data.enableDualFeed !== undefined) setEnableDualFeed(data.enableDualFeed);
      if (data.syncSymbols !== undefined) {
        setAdditionalSymbols(Array.isArray(data.syncSymbols) ? data.syncSymbols.join(",") : data.syncSymbols);
      }
      if (data.dateRange) {
        if (data.dateRange.start) setStartTime(data.dateRange.start);
        if (data.dateRange.end) setEndTime(data.dateRange.end);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const [startTime, setStartTime] = useState("2026-05-01 00:00:00");
  const [endTime, setEndTime] = useState("2026-05-02 00:00:00");

  const [preloadedBars, setPreloadedBars] = useState(300);
  const [autoScrollSync, setAutoScrollSync] = useState(true);
  const [autoSkipWeekend, setAutoSkipWeekend] = useState(true);
  const [timelineActivityMaxCap, setTimelineActivityMaxCap] = useState(2800);
  const [timelineActivityMinFloor, setTimelineActivityMinFloor] = useState(1500);
  const [autoSkipThreshold, setAutoSkipThreshold] = useState(0.15);
  const [preloadMode, setPreloadMode] = useState<"BARS" | "DATE">("BARS");
  const [preloadDate, setPreloadDate] = useState("2026-01-01 00:00:00");
  const [preloadTimeframe, setPreloadTimeframe] = useState("AUTO");
  const [activePickerField, setActivePickerField] = useState<"preload" | "start" | "end" | null>(null);

  // 通貨ペア（SYM）の変更に合わせてタイトルバーのテキストを更新する
  useEffect(() => {
    const title = sourceSymbol ? `TickReplay - ${sourceSymbol}` : "TickReplay";
    document.title = title;
    getCurrentWindow().setTitle(title).catch(err => {
      console.error("Failed to set window title:", err);
    });
  }, [sourceSymbol]);

  // 通貨ペア（SYM）の変更に合わせて疑似レート設定の初期値を自動計算する
  useEffect(() => {
    if (!isInitialized) return;
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      return; // 初回ロード時は保存された値を優先するためスキップ
    }

    const sym = sourceSymbol.toUpperCase();
    if (sym.includes("USDJPY")) {
      setPseudoBaseSpread(0.2);
      setPseudoThreshold(1.8);  // 実測最適: 1.8 pips
      setPseudoRolloverSpread(3.5);
    } else if (sym.includes("EURUSD")) {
      setPseudoBaseSpread(0.4);
      setPseudoThreshold(1.0);
      setPseudoRolloverSpread(3.5);
    } else if (sym.includes("GBPJPY")) {
      setPseudoBaseSpread(0.9);
      setPseudoThreshold(2.0);
      setPseudoRolloverSpread(4.5);
    } else if (sym.includes("EURJPY")) {
      setPseudoBaseSpread(0.4);
      setPseudoThreshold(1.5);
      setPseudoRolloverSpread(3.5);
    } else if (sym.includes("GBPUSD")) {
      setPseudoBaseSpread(0.7);
      setPseudoThreshold(1.5);
      setPseudoRolloverSpread(4.0);
    } else if (sym.includes("AUDJPY")) {
      setPseudoBaseSpread(0.6);
      setPseudoThreshold(1.5);
      setPseudoRolloverSpread(3.5);
    } else if (sym.includes("XAU") || sym.includes("GOLD")) {
      setPseudoBaseSpread(1.5);
      setPseudoThreshold(4.0);
      setPseudoRolloverSpread(6.0);
    } else {
      setPseudoBaseSpread(sym.includes("JPY") ? 0.3 : 0.5);
      setPseudoThreshold(1.2);
      setPseudoRolloverSpread(3.5);
    }
    setPseudoSensitivity(sym.includes("USDJPY") ? 0.30 : 0.35); // USDJPYのみ実測最適 0.30
    setPseudoRolloverEnabled(true);
    setPseudoRolloverRecoveryMin(15);
    setPseudoMode("dmm");
  }, [sourceSymbol, isInitialized]);

  // --- UIオプション設定
  const [isRemoteMode, setIsRemoteMode] = useState(false);
  const [isShortcutsActive, setIsShortcutsActive] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);

  // リプレイ状態（READY / ACTIVE）に新しく遷移した際、モニター2の操作コントローラーウィンドウを起動
  const prevStatusRef = useRef<string | null>(null);
  useEffect(() => {
    if (isRemoteMode) return;
    if (
      prevStatusRef.current !== null &&
      (prevStatusRef.current === "CONNECTED" || prevStatusRef.current === "DISCONNECTED") &&
      (status === "READY" || status === "ACTIVE")
    ) {
      invoke(COMMANDS.openControllerWindow).catch((err) => {
        console.warn("Open controller window failed or not applicable in browser:", err);
      });
    }
    prevStatusRef.current = status;
  }, [status, isRemoteMode]);

  const [errorMessage, setErrorMessage] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isResetReplayConfirmOpen, setIsResetReplayConfirmOpen] = useState(false);
  const [isResetTradingConfirmOpen, setIsResetTradingConfirmOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"general" | "hotkeys" | "display">("general");

  // タイムステップカスタマイズ State
  const [timeSteps, setTimeSteps] = useState<TimeStepItem[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.customTimeSteps);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return (parsed as TimeStepItem[]).slice(0, MAX_TIME_STEPS).sort((a, b) => a.seconds - b.seconds);
        }
      } catch (e) {
        console.error("Failed to parse custom-time-steps", e);
      }
    }
    return [...DEFAULT_TIME_STEPS].sort((a, b) => a.seconds - b.seconds);
  });

  const [isTimeStepsModalOpen, setIsTimeStepsModalOpen] = useState<boolean>(false);
  const [isSpeedPresetsModalOpen, setIsSpeedPresetsModalOpen] = useState<boolean>(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.customTimeSteps, JSON.stringify(timeSteps));
  }, [timeSteps]);




  const {
    plColorStyle, setPlColorStyle,
    orderColorStyle, setOrderColorStyle
  } = useAppearance();
  const [recordingAction, setRecordingAction] = useState<string | null>(null);
  const [hotkeys, setHotkeys] = useState<Record<string, string>>(DEFAULT_HOTKEYS);
  const [timePresets, setTimePresets] = useState<number[]>(() => [...DEFAULT_SPEED_TIME_PRESETS]);
  const [tickPresets, setTickPresets] = useState<number[]>(() => [...DEFAULT_SPEED_TICK_PRESETS]);

  const [timezoneMode, setTimezoneMode] = useState<"JST" | "SERVER">("JST");
  
  const [hedging, setHedging] = useState<boolean>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.speedOrderHedging);
    return saved === "true";
  });
  const [showHoldingTime, setShowHoldingTime] = useState<boolean>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.speedOrderShowHoldingTime);
    return saved !== "false";
  });
  const [holdingTimeMode, setHoldingTimeMode] = useState<"pc" | "server">(
    () => (localStorage.getItem(STORAGE_KEYS.speedOrderHoldingTimeMode) as "pc" | "server") || "pc"
  );
  const isDraggingRef = useRef(false);
  const savedConfig = useRef<PersistedSettings | null>(null); // 保存された設定キャッシュ用のRef

  const handlersRef = useRef<AppHandlers | null>(null);

  const applyIncomingPlayingState = (playing: boolean) => {
    const guard = playStateGuardRef.current;
    if (guard && performance.now() < guard.expireAt) {
      if (playing === guard.expected) {
        playStateGuardRef.current = null;
        isPlayingRef.current = playing;
        setIsPlaying((prev) => prev !== playing ? playing : prev);
      }
    } else {
      playStateGuardRef.current = null;
      isPlayingRef.current = playing;
      setIsPlaying((prev) => prev !== playing ? playing : prev);
    }
  };

  const handleStatusString = (payload: string) => {
    try {
      const data = JSON.parse(payload) as ReplayProgressPayload;
      if (data.status === "READY") {
        const isReconnecting = status === "DISCONNECTED" || status === "CONNECTED";
        setStatus((prev) => prev !== "READY" ? "READY" : prev);
        if (data.total_ticks !== undefined) setTotalTicks((prev) => prev !== (data.total_ticks ?? prev) ? (data.total_ticks ?? prev) : prev);
        if (!isDraggingRef.current) {
          if (data.current_idx !== undefined) setCurrentIdx((prev) => prev !== (data.current_idx ?? prev) ? (data.current_idx ?? prev) : prev);
        }
        if (data.virtual_time_msc !== undefined) setVirtualTimeMsc((prev) => prev !== (data.virtual_time_msc ?? prev) ? (data.virtual_time_msc ?? prev) : prev);
        applyIncomingPlayingState(data.is_playing ?? false);
        if (data.session_boundaries) {
          setSessionBoundaries((prev) => {
            if (JSON.stringify(prev) === JSON.stringify(data.session_boundaries)) return prev;
            return data.session_boundaries ?? prev;
          });
        }
        if (isReconnecting) {
          if (data.speed_mode) setSpeedMode((prev) => prev !== data.speed_mode ? (data.speed_mode as "TEMPORAL" | "COUNT") : prev);
          if (data.multiplier !== undefined) {
            const m = typeof data.multiplier === "number" ? data.multiplier : parseFloat(data.multiplier) || 1.0;
            setMultiplier((prev) => prev !== m ? m : prev);
          }
          if (data.tick_step !== undefined) setTickStep((prev) => prev !== (data.tick_step ?? prev) ? (data.tick_step ?? prev) : prev);
        }
        if (data.loop) {
          const loop = data.loop;
          setLoopActive((prev) => prev !== loop.active ? loop.active : prev);
          setLoopA((prev) => prev !== loop.a_msc ? loop.a_msc : prev);
          setLoopB((prev) => prev !== loop.b_msc ? loop.b_msc : prev);
          setLoopAIdx((prev) => prev !== (loop.a_idx ?? -1) ? (loop.a_idx ?? -1) : prev);
          setLoopBIdx((prev) => prev !== (loop.b_idx ?? -1) ? (loop.b_idx ?? -1) : prev);
        }
        setErrorMessage((prev) => prev !== "" ? "" : prev);
        // 取引状態の反映。READY / ACTIVE で共通 (詳細は domain/tradeStateUpdate.ts)
        setAccount((prev) => nextAccount(prev, data.account));
        setMainFeedRate((prev) => nextMainFeedRate(prev, data));
        setSubFeedRate((prev) => nextSubFeedRate(prev, data));
        setPositions((prev) => nextPositions(prev, data.positions));
        if (shouldApplyHistory(data.history, data.history_revision, historyRevisionRef.current)) {
          historyRevisionRef.current = data.history_revision;
          setHistory(data.history);
        }
        if (restoringSessionRef.current) {
          const session = restoringSessionRef.current;
          restoringSessionRef.current = null;
          isRestoringRef.current = true;

          // Restore position & history real times to localStorage
          try {
            const restoredTimes: Record<string, number> = {};
            if (session.virtual_trade) {
              const vt = session.virtual_trade;
              if (vt.positions) {
                vt.positions.forEach((p) => {
                  if (p.accumulated_real_time !== undefined) {
                    const posKey = `${p.ticket}_${p.open_time_msc}`;
                    restoredTimes[posKey] = p.accumulated_real_time;
                    restoredTimes[p.ticket] = p.accumulated_real_time;
                  }
                });
              }
              if (vt.history) {
                vt.history.forEach((h) => {
                  if (h.accumulated_real_time !== undefined) {
                    const histKey = `${h.ticket}_${h.open_time_msc}`;
                    restoredTimes[histKey] = h.accumulated_real_time;
                    restoredTimes[h.ticket] = h.accumulated_real_time;
                  }
                });
              }
            }
            localStorage.setItem(STORAGE_KEYS.speedOrderPositionRealTimes, JSON.stringify(restoredTimes));
            window.dispatchEvent(new StorageEvent("storage", {
              key: STORAGE_KEYS.speedOrderPositionRealTimes,
              newValue: JSON.stringify(restoredTimes)
            }));
          } catch (e) {
            console.error("Failed to restore position real times to localStorage", e);
          }

          const restoreSeq = async () => {
            try {
              // 1. チャートの再生速度と一時停止を設定
              await sendCommand({
                command: "CONTROL",
                is_playing: false,
                speed_mode: session.progress.speed_mode || speedMode,
                multiplier: session.progress.multiplier || multiplier,
                tick_step: session.progress.tick_step || tickStep,
                auto_skip_weekend: autoSkipWeekend
              });

              // 2. 指定位置にシーク
              await sendCommand({
                command: "SEEK",
                target_index: session.progress.current_idx
              });

              if (session.virtual_trade) {
                const vt = session.virtual_trade;
                // 3. 口座残高を復元
                await sendCommand({
                  command: "RESTORE_ACCOUNT",
                  initial_balance: vt.initial_balance,
                  balance: vt.balance,
                  equity: vt.equity,
                  leverage: vt.leverage,
                  margin: vt.margin,
                  free_margin: vt.free_margin,
                  margin_level: vt.margin_level,
                  next_ticket: vt.next_ticket || 10001
                });

                // 4. 保有ポジションを復元
                if (vt.positions && vt.positions.length > 0) {
                  for (const pos of vt.positions) {
                    await sendCommand({
                      command: "RESTORE_POSITION",
                      ticket: pos.ticket,
                      type: pos.type,
                      volume: pos.volume,
                      open_price: pos.open_price,
                      open_time_msc: pos.open_time_msc,
                      sl: pos.sl,
                      tp: pos.tp,
                      current_price: pos.current_price,
                      profit: pos.profit,
                      mfe_pips: pos.mfe_pips,
                      mae_pips: pos.mae_pips,
                      spread_entry: pos.spread_entry,
                      accumulated_real_time: pos.accumulated_real_time,
                      volatility: pos.volatility,
                      volume_60s: pos.volume_60s
                    });
                  }
                }

                // 5. 履歴を復元
                if (vt.history && vt.history.length > 0) {
                  for (const hist of vt.history) {
                    await sendCommand({
                      command: "RESTORE_HISTORY",
                      ticket: hist.ticket,
                      type: hist.type,
                      volume: hist.volume,
                      open_price: hist.open_price,
                      open_time_msc: hist.open_time_msc,
                      close_price: hist.close_price,
                      close_time_msc: hist.close_time_msc,
                      sl: hist.sl,
                      tp: hist.tp,
                      profit: hist.profit,
                      close_reason: hist.close_reason,
                      accumulated_real_time: hist.accumulated_real_time,
                      mfe_pips: hist.mfe_pips,
                      mae_pips: hist.mae_pips,
                      spread_entry: hist.spread_entry,
                      volatility: hist.volatility,
                      volume_60s: hist.volume_60s
                    });
                  }
                }
              }
            } catch (err) {
              console.error("Failed to restore session state to EA", err);
              setErrorMessage("セッションデータの復元中にエラーが発生しました。");
            } finally {
              isRestoringRef.current = false;
              setIsReplayInitializing(false);
              setRestoringSession(null);
            }
          };

          restoreSeq().catch(console.error);
        } else if (isReplayInitializingRef.current && enableVirtualTradingRef.current) {
          localStorage.removeItem(STORAGE_KEYS.speedOrderPositionRealTimes);
          sendCommand({
            command: "ACCOUNT_RESET",
            initial_balance: initialBalanceRef.current,
            leverage: leverageRef.current
          }).catch(console.error);
        }
      } else if (data.status === "CONNECTED") {
        setStatus((prev) => prev !== "CONNECTED" ? "CONNECTED" : prev);
        if (data.symbol) {
          setChartSymbol((prev) => prev !== (data.symbol ?? prev) ? (data.symbol ?? prev) : prev);
          if (!hasSavedSymbolRef.current) {
            setSourceSymbol((prev) => prev !== (data.symbol ?? prev) ? (data.symbol ?? prev) : prev);
          }
        }
      } else if (data.status === "ACTIVE") {
        const isReconnecting = status === "DISCONNECTED" || status === "CONNECTED";
        setStatus((prev) => prev !== "ACTIVE" ? "ACTIVE" : prev);
        // ドラッグ中でなければ現在インデックスを更新する
        if (!isDraggingRef.current) {
          if (data.current_idx !== undefined) setCurrentIdx((prev) => prev !== (data.current_idx ?? prev) ? (data.current_idx ?? prev) : prev);
        }
        if (data.total_ticks !== undefined) setTotalTicks((prev) => prev !== (data.total_ticks ?? prev) ? (data.total_ticks ?? prev) : prev);
        if (data.virtual_time_msc !== undefined) setVirtualTimeMsc((prev) => prev !== (data.virtual_time_msc ?? prev) ? (data.virtual_time_msc ?? prev) : prev);
        if (data.is_playing !== undefined) applyIncomingPlayingState(data.is_playing);
        if (data.session_boundaries) {
          setSessionBoundaries((prev) => {
            if (JSON.stringify(prev) === JSON.stringify(data.session_boundaries)) return prev;
            return data.session_boundaries ?? prev;
          });
        }
        if (isReconnecting) {
          if (data.speed_mode) setSpeedMode((prev) => prev !== data.speed_mode ? (data.speed_mode as "TEMPORAL" | "COUNT") : prev);
          if (data.multiplier !== undefined) {
            const m = typeof data.multiplier === "number" ? data.multiplier : parseFloat(data.multiplier) || 1.0;
            setMultiplier((prev) => prev !== m ? m : prev);
          }
          if (data.tick_step !== undefined) setTickStep((prev) => prev !== (data.tick_step ?? prev) ? (data.tick_step ?? prev) : prev);
        }
        if (data.loop) {
          const loop = data.loop;
          setLoopActive((prev) => prev !== loop.active ? loop.active : prev);
          setLoopA((prev) => prev !== loop.a_msc ? loop.a_msc : prev);
          setLoopB((prev) => prev !== loop.b_msc ? loop.b_msc : prev);
          setLoopAIdx((prev) => prev !== (loop.a_idx ?? -1) ? (loop.a_idx ?? -1) : prev);
          setLoopBIdx((prev) => prev !== (loop.b_idx ?? -1) ? (loop.b_idx ?? -1) : prev);
        }
        // 取引状態の反映。READY / ACTIVE で共通 (詳細は domain/tradeStateUpdate.ts)
        setAccount((prev) => nextAccount(prev, data.account));
        setMainFeedRate((prev) => nextMainFeedRate(prev, data));
        setSubFeedRate((prev) => nextSubFeedRate(prev, data));
        setPositions((prev) => nextPositions(prev, data.positions));
        if (shouldApplyHistory(data.history, data.history_revision, historyRevisionRef.current)) {
          historyRevisionRef.current = data.history_revision;
          setHistory(data.history);
        }
      } else if (data.status === "ERROR") {
        const lowerMsg = (data.message || "").toLowerCase();
        const isOrderError =
          lowerMsg.includes("margin is insufficient") ||
          lowerMsg.includes("bid/ask prices") ||
          lowerMsg.includes("replay is not initialized");

        if (!isOrderError) {
          setErrorMessage(translateErrorMessage(data.message || ""));
          setIsReplayInitializing(false);
        }
      } else if (data.status === "DISCONNECTED") {
        setStatus((prev) => prev !== "DISCONNECTED" ? "DISCONNECTED" : prev);
        playStateGuardRef.current = null;
        isPlayingRef.current = false;
        setIsPlaying((prev) => prev !== false ? false : prev);
        setLoopActive((prev) => prev !== false ? false : prev);
        setLoopA((prev) => prev !== -1 ? -1 : prev);
        setLoopB((prev) => prev !== -1 ? -1 : prev);
        setLoopAIdx((prev) => prev !== -1 ? -1 : prev);
        setLoopBIdx((prev) => prev !== -1 ? -1 : prev);
        setAccount((prev) => prev !== null ? null : prev);
        setPositions((prev) => prev.length > 0 ? [] : prev);
        setHistory((prev) => prev.length > 0 ? [] : prev);
        historyRevisionRef.current = undefined;

        // スピード発注画面も自動で終了する
        WebviewWindow.getByLabel("speed_order")
          .then((win) => {
            if (win) {
              win.close().catch((e) => console.error("Failed to close speed_order window:", e));
            }
          })
          .catch((e) => console.error("Failed to get speed_order window:", e));
      }
    } catch (e) {
      console.error("Failed to parse status message", e);
    }
  };

  const handleStatusStringRef = useRef(handleStatusString);
  useEffect(() => {
    handleStatusStringRef.current = handleStatusString;
  });

  const pendingStatusPayloadRef = useRef<string | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const skippedCountRef = useRef<number>(0);
  const isWindowVisibleRef = useRef<boolean>(true);

  useEffect(() => {
    const currentLabel = getCurrentWindow().label;
    const unlistenVisible = listen<unknown>(EVENTS.windowVisible, (event) => {
      const nextVisible = resolveWindowVisibility(currentLabel, event.payload, true);
      if (nextVisible === null) {
        if (typeof event.payload === "boolean") {
          getCurrentWindow().isVisible().then((v) => {
            isWindowVisibleRef.current = v;
            if (v && pendingStatusPayloadRef.current !== null) {
              const latest = pendingStatusPayloadRef.current;
              pendingStatusPayloadRef.current = null;
              handleStatusStringRef.current(latest);
            }
          }).catch(() => {});
        }
        return;
      }
      isWindowVisibleRef.current = nextVisible;
      if (nextVisible && pendingStatusPayloadRef.current !== null) {
        const latest = pendingStatusPayloadRef.current;
        pendingStatusPayloadRef.current = null;
        handleStatusStringRef.current(latest);
      }
    });

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        getCurrentWindow().isVisible().then((v) => {
          isWindowVisibleRef.current = v;
          if (v && pendingStatusPayloadRef.current !== null) {
            const latest = pendingStatusPayloadRef.current;
            pendingStatusPayloadRef.current = null;
            handleStatusStringRef.current(latest);
          }
        }).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    let unlistenFocus: (() => void) | undefined;
    getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) {
        isWindowVisibleRef.current = true;
        if (pendingStatusPayloadRef.current !== null) {
          const latest = pendingStatusPayloadRef.current;
          pendingStatusPayloadRef.current = null;
          handleStatusStringRef.current(latest);
        }
      }
    }).then((fn) => {
      unlistenFocus = fn;
    }).catch(() => {});

    return () => {
      unlistenVisible.then((fn) => fn());
      if (unlistenFocus) unlistenFocus();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const scheduleStatusUpdate = useCallback((payload: string) => {
    if (pendingStatusPayloadRef.current !== null) {
      skippedCountRef.current++;
    }
    pendingStatusPayloadRef.current = payload;

    // メインウィンドウ非表示中（コントローラー操作中や最小化時）は rAF と React 再描画をスキップ
    if (!isWindowVisibleRef.current || document.hidden) {
      return;
    }

    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        if (pendingStatusPayloadRef.current !== null) {
          const latest = pendingStatusPayloadRef.current;
          pendingStatusPayloadRef.current = null;
          handleStatusStringRef.current(latest);

          if (import.meta.env.DEV && skippedCountRef.current > 0) {
            console.debug("[DEV-UI-THROTTLE] rAF UI throttle skipped render passes:", skippedCountRef.current);
            skippedCountRef.current = 0;
          }
        }
      });
    }
  }, []);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  const sendCommand = useCallback(async (cmd: ReplayCommand) => {
    try {
      await sendReplayCommand(cmd);
    } catch (e) {
      console.error("Failed to send command", e);
      setErrorMessage(translateErrorMessage("Command error: " + e));
      throw e;
    }
  }, []);

  const handleCheckConnection = async () => {
    setErrorMessage("");
    try {
      // 1. 直近のステータスを取得して反映
      const lastStatus = await invoke<string>(COMMANDS.getLastStatus);
      if (lastStatus && lastStatus.trim() !== "") {
        const parsed = JSON.parse(lastStatus);
        if (parsed.status === "CONNECTED" || parsed.status === "READY" || parsed.status === "ACTIVE") {
          handleStatusStringRef.current(lastStatus);
          return;
        }
      }

      // 2. まだ接続が検知されていない場合、PING 送信を試行
      try {
        await sendCommand({ command: "PING" });
      } catch (_) {
        // The PING is best-effort; the status check below determines connectivity.
      }

      const recheck = await invoke<string>(COMMANDS.getLastStatus);
      if (recheck && recheck.trim() !== "") {
        const parsed = JSON.parse(recheck);
        if (parsed.status === "CONNECTED" || parsed.status === "READY" || parsed.status === "ACTIVE") {
          handleStatusStringRef.current(recheck);
          return;
        }
      }

      setErrorMessage("EAが接続されていません。MT5チャート上に「TickReplayRendererEA」が配置されていることを確認してください。");
    } catch (e) {
      console.error(e);
      setErrorMessage("接続確認エラー: " + e);
    }
  };

  // EA未接続時の自動検知ポーリング（MT5チャートへEA配置時に自動で「リプレイ開始」ボタンに切り替わる）
  useEffect(() => {
    if (status !== "DISCONNECTED") return;

    const intervalId = setInterval(async () => {
      try {
        const lastStatus = await invoke<string>(COMMANDS.getLastStatus);
        if (lastStatus && lastStatus.trim() !== "") {
          const parsed = JSON.parse(lastStatus);
          if (parsed.status === "CONNECTED" || parsed.status === "READY" || parsed.status === "ACTIVE") {
            handleStatusStringRef.current(lastStatus);
          }
        }
      } catch (_) {
        // A failed poll is transient; the next interval retries.
      }
    }, 500);

    return () => clearInterval(intervalId);
  }, [status]);

  

  // --- 両建て設定適用エフェクト
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.speedOrderHedging, String(hedging));
  }, [hedging]);


  // --- 複数ウィンドウ間での設定同期用エフェクト
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.plColorStyle && e.newValue) {
        setPlColorStyle(e.newValue as "red-blue" | "green-red");
      } else if (e.key === STORAGE_KEYS.speedOrderColorStyle && e.newValue) {
        setOrderColorStyle(e.newValue as "blue-red" | "red-green");
      } else if (e.key === STORAGE_KEYS.speedOrderHedging && e.newValue) {
        setHedging(e.newValue === "true");
      } else if (e.key === STORAGE_KEYS.speedOrderShowHoldingTime && e.newValue) {
        setShowHoldingTime(e.newValue !== "false");
      } else if (e.key === STORAGE_KEYS.speedOrderHoldingTimeMode && e.newValue) {
        setHoldingTimeMode(e.newValue as "pc" | "server");
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [setOrderColorStyle, setPlColorStyle]);

  // リプレイ初期化完了または切断時にローディングを終了する
  useEffect(() => {
    if (status === "READY" || status === "ACTIVE" || status === "DISCONNECTED") {
      if (!isRestoringRef.current) {
        setIsReplayInitializing(false);
      }
    }
  }, [status]);

  // --- 1. バックエンドからのイベント監視
  useEffect(() => {
    // ステータスファイル経由のEAステータス受信
    const unlistenStatus = listen<string>(EVENTS.mt5Status, (event) => {
      scheduleStatusUpdate(event.payload);
    });

    // EA接続時
    const unlistenConnect = listen(EVENTS.mt5Connected, () => {
      setStatus((prev) => prev === "DISCONNECTED" ? "CONNECTED" : prev);
    });

    // EA切断時
    const unlistenDisconnect = listen(EVENTS.mt5Disconnected, async () => {
      setStatus("DISCONNECTED");
      playStateGuardRef.current = null;
      isPlayingRef.current = false;
      setIsPlaying(false);
      setLoopActive(false);
      setLoopA(-1);
      setLoopB(-1);
      setLoopAIdx(-1);
      setLoopBIdx(-1);

      // スピード発注画面も自動で終了する
      try {
        const win = await WebviewWindow.getByLabel("speed_order");
        if (win) {
          await win.close();
        }
      } catch (e) {
        console.error("Failed to close speed_order window:", e);
      }
    });

    // 設定をロードした後にMT5ターミナルリストをロードする非同期処理
    const initApp = async () => {
      let loadedHotkeys = DEFAULT_HOTKEYS;
      let loadedTimePresets = [1.0, 5.0, 10.0, 60.0, 300.0, 3600.0];
      let loadedTickPresets = [1, 5, 10, 50, 100, 500];
      let loadedShortcutsActive = false;
      let loadedAlwaysOnTop = false;
      try {
        const saved = await invoke<PersistedSettings>(COMMANDS.loadSettings);
        if (saved) {
          savedConfig.current = saved;
          if (saved.source_symbol) {
            setSourceSymbol(saved.source_symbol);
            hasSavedSymbolRef.current = true;
          }
          if (saved.enable_dual_feed !== undefined && saved.enable_dual_feed !== null) {
            setEnableDualFeed(saved.enable_dual_feed);
          }
          if (saved.sub_source_symbol) {
            setSubSourceSymbol(saved.sub_source_symbol);
          }
          if (saved.additional_symbols !== undefined && saved.additional_symbols !== null) {
            setAdditionalSymbols(saved.additional_symbols);
          }
          if (saved.start_time) setStartTime(saved.start_time);
          if (saved.end_time) setEndTime(saved.end_time);

          if (saved.preloaded_bars !== undefined) setPreloadedBars(saved.preloaded_bars);
          if (saved.auto_scroll_sync !== undefined) setAutoScrollSync(saved.auto_scroll_sync);
          if (saved.preload_mode) setPreloadMode(saved.preload_mode as "BARS" | "DATE");
          if (saved.preload_date) setPreloadDate(saved.preload_date);
          if (saved.preload_timeframe) setPreloadTimeframe(saved.preload_timeframe);
          if (saved.hotkeys) {
            const merged = { ...DEFAULT_HOTKEYS, ...saved.hotkeys };
            setHotkeys(merged);
            loadedHotkeys = merged;
          }
          if (saved.time_presets) {
            setTimePresets(saved.time_presets);
            loadedTimePresets = saved.time_presets;
          }
          if (saved.tick_presets) {
            setTickPresets(saved.tick_presets);
            loadedTickPresets = saved.tick_presets;
          }
          if (saved.always_on_top !== undefined && saved.always_on_top !== null) {
            setAlwaysOnTop(saved.always_on_top);
            loadedAlwaysOnTop = saved.always_on_top;
          }
          if (saved.is_shortcuts_active !== undefined && saved.is_shortcuts_active !== null) {
            setIsShortcutsActive(saved.is_shortcuts_active);
            loadedShortcutsActive = saved.is_shortcuts_active;
          }
          if (saved.timezone_mode) {
            setTimezoneMode(saved.timezone_mode as "JST" | "SERVER");
          }
          if (saved.auto_skip_weekend !== undefined && saved.auto_skip_weekend !== null) {
            setAutoSkipWeekend(saved.auto_skip_weekend);
          }
          if (saved.timeline_activity_max_cap !== undefined && saved.timeline_activity_max_cap !== null) {
            setTimelineActivityMaxCap(saved.timeline_activity_max_cap);
          }
          if (saved.timeline_activity_min_floor !== undefined && saved.timeline_activity_min_floor !== null) {
            setTimelineActivityMinFloor(saved.timeline_activity_min_floor);
          }
          if (saved.auto_skip_threshold !== undefined && saved.auto_skip_threshold !== null) {
            setAutoSkipThreshold(saved.auto_skip_threshold);
          }
          if (saved.pl_color_style) {
            setPlColorStyle(saved.pl_color_style as "red-blue" | "green-red");
          }
          if (saved.order_color_style) {
            setOrderColorStyle(saved.order_color_style as "blue-red" | "red-green");
          }
          if (saved.hedging !== undefined && saved.hedging !== null) {
            setHedging(saved.hedging);
          }
          if (saved.enable_virtual_trading !== undefined && saved.enable_virtual_trading !== null) {
            setEnableVirtualTrading(saved.enable_virtual_trading);
          }
          if (saved.initial_balance !== undefined && saved.initial_balance !== null) {
            setInitialBalance(saved.initial_balance);
          }
          if (saved.leverage !== undefined && saved.leverage !== null) {
            setLeverage(saved.leverage);
          }
          if (saved.enable_pseudo_rate !== undefined && saved.enable_pseudo_rate !== null) {
            setEnablePseudoRate(saved.enable_pseudo_rate);
          }
          if (saved.pseudo_base_spread !== undefined && saved.pseudo_base_spread !== null) {
            // 設定ファイルはpips単位で保存されているため変換不要。0の場合はデフォルト値を使用。
            setPseudoBaseSpread(saved.pseudo_base_spread > 0 ? saved.pseudo_base_spread : 0.2);
          }
          if (saved.pseudo_threshold !== undefined && saved.pseudo_threshold !== null) {
            // 設定ファイルはpips単位で保存されているため変換不要。0の場合はデフォルト値を使用。
            setPseudoThreshold(saved.pseudo_threshold > 0 ? saved.pseudo_threshold : 1.0);
          }
          if (saved.pseudo_sensitivity !== undefined && saved.pseudo_sensitivity !== null) {
            setPseudoSensitivity(saved.pseudo_sensitivity);
          }
          if (saved.pseudo_mode) {
            setPseudoMode(saved.pseudo_mode as "dmm" | "fixed" | "aggressive" | "custom");
          }
          if (saved.pseudo_rollover_enabled !== undefined && saved.pseudo_rollover_enabled !== null) {
            setPseudoRolloverEnabled(saved.pseudo_rollover_enabled);
          }
          if (saved.pseudo_rollover_spread !== undefined && saved.pseudo_rollover_spread !== null) {
            setPseudoRolloverSpread(saved.pseudo_rollover_spread > 0 ? saved.pseudo_rollover_spread : 3.5);
          }
          if (saved.pseudo_rollover_recovery_min !== undefined && saved.pseudo_rollover_recovery_min !== null) {
            setPseudoRolloverRecoveryMin(saved.pseudo_rollover_recovery_min);
          }
          if (saved.show_holding_time !== undefined && saved.show_holding_time !== null) {
            setShowHoldingTime(saved.show_holding_time);
            localStorage.setItem(STORAGE_KEYS.speedOrderShowHoldingTime, String(saved.show_holding_time));
          }
          if (saved.holding_time_mode) {
            setHoldingTimeMode(saved.holding_time_mode as "pc" | "server");
            localStorage.setItem(STORAGE_KEYS.speedOrderHoldingTimeMode, saved.holding_time_mode);
          }
          if (saved.contract_size !== undefined && saved.contract_size !== null) {
            setContractSize(saved.contract_size);
            localStorage.setItem(STORAGE_KEYS.speedOrderContractSize, String(saved.contract_size));
          } else {
            const savedContract = localStorage.getItem(STORAGE_KEYS.speedOrderContractSize);
            if (savedContract) {
              setContractSize(parseInt(savedContract, 10));
            }
          }
          if (saved.economic_data_dir) {
            setEconomicDataDir(saved.economic_data_dir);
            localStorage.setItem(STORAGE_KEYS.replayEconomicDataDir, saved.economic_data_dir);
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
      } catch (e) {
        console.error("Failed to load settings", e);
      }

      try {
        await invoke(COMMANDS.setAlwaysOnTop, { always: loadedAlwaysOnTop });
      } catch (e) {
        console.error("Failed to sync initial always_on_top", e);
      }

      try {
        await invoke(COMMANDS.setShortcutsActive, { active: loadedShortcutsActive, hotkeys: loadedHotkeys });
      } catch (e) {
        console.error("Failed to sync initial hotkeys", e);
      }
      localStorage.setItem(STORAGE_KEYS.speedOrderHotkeys, JSON.stringify(loadedHotkeys));

      try {
        await invoke(COMMANDS.syncPresets, { timePresets: loadedTimePresets, tickPresets: loadedTickPresets });
      } catch (e) {
        console.error("Failed to sync initial presets", e);
      }

      let terminalSuccess = false;
      try {
        const res = await invoke<TerminalInfo[]>(COMMANDS.getMt5Terminals);
        setTerminals(res);
        if (res.length > 0) {
          let targetPath = res[0].path;
          const savedTerminal = savedConfig.current?.selected_terminal;
          if (savedTerminal && res.some((t) => t.path === savedTerminal)) {
            targetPath = savedTerminal;
          } else {
            // 保存された設定のターミナルが存在しない場合、キャッシュをクリアして初回ロード完了とする
            savedConfig.current = null;
          }
          setSelectedTerminal(targetPath);
          await invoke(COMMANDS.selectTerminal, { terminalPath: targetPath });
          terminalSuccess = true;
        }
      } catch (e) {
        console.error("Failed to get MT5 terminals", e);
      }

      if (!terminalSuccess) {
        setIsInitialized(true);
      }

      // 初期接続状況の確認
      try {
        const lastStatus = await invoke<string>(COMMANDS.getLastStatus);
        if (lastStatus && lastStatus.trim() !== "") {
          handleStatusStringRef.current(lastStatus);
        }
      } catch (e) {
        console.error(e);
      }

      // 保存されたセッションをロード
      await loadSavedSessions();
    };

    initApp();

    return () => {
      unlistenStatus.then((fn) => fn());
      unlistenDisconnect.then((fn) => fn());
      unlistenConnect.then((fn) => fn());
    };
  }, [scheduleStatusUpdate, setOrderColorStyle, setPlColorStyle]);

  // Start Timeが変更されたら、デフォルトのプリロード開始日を年初に自動更新
  useEffect(() => {
    const match = startTime.match(/^(\d{4})-\d{2}-\d{2}/);
    if (match) {
      const year = match[1];
      setPreloadDate((prev) => {
        const prevMatch = prev.match(/^(\d{4})-01-01 00:00:00$/);
        if (prevMatch || prev === "2026-01-01 00:00:00") {
          return `${year}-01-01 00:00:00`;
        }
        return prev;
      });
    }
  }, [startTime]);


  // 端末が選択されたらプロファイルフォルダリストをスキャンし、Filesパスおよびチャート最大バー数を設定
  useEffect(() => {
    if (selectedTerminal) {
      // RustバックエンドにファイルベースIPCのパスを通知
      invoke(COMMANDS.selectTerminal, { terminalPath: selectedTerminal }).catch(console.error);

      // チャートの最大バー数設定を取得
      invoke<MaxBarsInfo>(COMMANDS.getTerminalMaxBars, { terminalPath: selectedTerminal })
        .then((info) => setMaxBarsInfo(info))
        .catch((err) => {
          console.error("Failed to get terminal max bars:", err);
          setMaxBarsInfo(null);
        });

      invoke<string[]>(COMMANDS.getProfiles, { terminalPath: selectedTerminal })
        .then((res) => {
          setProfiles(res);
          if (res.length > 0) {
            let targetProfile = res[0];
            const savedProfile = savedConfig.current?.selected_profile;
            if (savedConfig.current?.selected_terminal === selectedTerminal) {
              if (savedProfile === "") {
                targetProfile = res[0];
              } else if (savedProfile && res.includes(savedProfile)) {
                targetProfile = savedProfile;
              }
            }
            setSelectedProfile(targetProfile);
          } else {
            setSelectedProfile("");
          }
          // プロファイル適用後、初回ロードキャッシュをクリア
          if (savedConfig.current && savedConfig.current.selected_terminal === selectedTerminal) {
            savedConfig.current = null;
          }
          setIsInitialized(true);
        })
        .catch((e) => {
          console.error("Failed to get profiles", e);
          setIsInitialized(true);
        });
    }
  }, [selectedTerminal]);

  // すべての設定をまとめて保存・同期するヘルパー関数
  const saveAllSettings = async (
    options?: Partial<PersistedSettings>
  ) => {
    const opts = options || {};
    const effHotkeys = opts.hotkeys ?? hotkeys;
    const effTimePresets = opts.time_presets ?? timePresets;
    const effTickPresets = opts.tick_presets ?? tickPresets;
    const effAlwaysOnTop = opts.always_on_top ?? alwaysOnTop;
    const effIsShortcutsActive = opts.is_shortcuts_active ?? isShortcutsActive;
    const effAutoScrollSync = opts.auto_scroll_sync ?? autoScrollSync;
    const effTimezoneMode = opts.timezone_mode ?? timezoneMode;
    const effAutoSkipWeekend = opts.auto_skip_weekend ?? autoSkipWeekend;
    const effPlColorStyle = opts.pl_color_style ?? plColorStyle;
    const effOrderColorStyle = opts.order_color_style ?? orderColorStyle;
    const effHedging = opts.hedging ?? hedging;
    const effEnableVirtualTrading = opts.enable_virtual_trading ?? enableVirtualTrading;
    const effInitialBalance = opts.initial_balance ?? initialBalance;
    const effLeverage = opts.leverage ?? leverage;
    const effContractSize = opts.contract_size ?? contractSize;
    const effEnablePseudoRate = opts.enable_pseudo_rate ?? enablePseudoRate;
    const effPseudoBaseSpread = opts.pseudo_base_spread ?? pseudoBaseSpread;
    const effPseudoThreshold = opts.pseudo_threshold ?? pseudoThreshold;
    const effPseudoSensitivity = opts.pseudo_sensitivity ?? pseudoSensitivity;
    const effPseudoMode = opts.pseudo_mode ?? pseudoMode;
    const effPseudoRolloverEnabled = opts.pseudo_rollover_enabled ?? pseudoRolloverEnabled;
    const effPseudoRolloverSpread = opts.pseudo_rollover_spread ?? pseudoRolloverSpread;
    const effPseudoRolloverRecoveryMin = opts.pseudo_rollover_recovery_min ?? pseudoRolloverRecoveryMin;
    const effPreloadTimeframe = opts.preload_timeframe ?? preloadTimeframe;
    const effShowHoldingTime = opts.show_holding_time ?? showHoldingTime;
    const effHoldingTimeMode = opts.holding_time_mode ?? holdingTimeMode;
    const effAdditionalSymbols = opts.additional_symbols ?? additionalSymbols;
    const effEconomicDataDir = opts.economic_data_dir ?? economicDataDir;
    const effTimelineActivityMaxCap = opts.timeline_activity_max_cap ?? timelineActivityMaxCap;
    const effTimelineActivityMinFloor = opts.timeline_activity_min_floor ?? timelineActivityMinFloor;
    const effAutoSkipThreshold = opts.auto_skip_threshold ?? autoSkipThreshold;

    const settingsObj = {
      selected_terminal: selectedTerminal,
      selected_profile: selectedProfile,
      source_symbol: sourceSymbol,
      enable_dual_feed: enableDualFeed,
      sub_source_symbol: subSourceSymbol,
      start_time: startTime,
      end_time: endTime,
      preloaded_bars: preloadedBars,
      auto_scroll_sync: effAutoScrollSync,
      auto_skip_weekend: effAutoSkipWeekend,
      timeline_activity_max_cap: effTimelineActivityMaxCap,
      timeline_activity_min_floor: effTimelineActivityMinFloor,
      auto_skip_threshold: effAutoSkipThreshold,
      preload_mode: preloadMode,
      preload_date: preloadDate,
      preload_timeframe: effPreloadTimeframe,
      hotkeys: effHotkeys,
      time_presets: effTimePresets,
      tick_presets: effTickPresets,
      always_on_top: effAlwaysOnTop,
      is_shortcuts_active: effIsShortcutsActive,
      timezone_mode: effTimezoneMode,
      pl_color_style: effPlColorStyle,
      order_color_style: effOrderColorStyle,
      hedging: effHedging,
      enable_virtual_trading: effEnableVirtualTrading,
      initial_balance: effInitialBalance,
      leverage: effLeverage,
      contract_size: effContractSize,
      enable_pseudo_rate: effEnablePseudoRate,
      pseudo_base_spread: effPseudoBaseSpread,
      pseudo_threshold: effPseudoThreshold,
      pseudo_sensitivity: effPseudoSensitivity,
      pseudo_mode: effPseudoMode,
      pseudo_rollover_enabled: effPseudoRolloverEnabled,
      pseudo_rollover_spread: effPseudoRolloverSpread,
      pseudo_rollover_recovery_min: effPseudoRolloverRecoveryMin,
      show_holding_time: effShowHoldingTime,
      holding_time_mode: effHoldingTimeMode,
      additional_symbols: effAdditionalSymbols,
      economic_data_dir: effEconomicDataDir,
      terminal_names: formatTerminalNamesMap(terminals),
    };
    try {
      localStorage.setItem(STORAGE_KEYS.speedOrderHotkeys, JSON.stringify(effHotkeys));
      localStorage.setItem(STORAGE_KEYS.speedOrderContractSize, effContractSize.toString());
      localStorage.setItem(STORAGE_KEYS.replayEconomicDataDir, effEconomicDataDir);
      await invoke(COMMANDS.saveSettings, { settings: settingsObj });
      await invoke(COMMANDS.syncPresets, { timePresets: effTimePresets, tickPresets: effTickPresets });
    } catch (e) {
      console.error("Failed to save/sync settings", e);
    }
  };

  const saveAllSettingsRef = useRef(saveAllSettings);
  useEffect(() => {
    saveAllSettingsRef.current = saveAllSettings;
  });

  // 設定変更時の自動保存処理
  useEffect(() => {
    if (!isInitialized) return;

    const timer = setTimeout(() => {
      saveAllSettingsRef.current();
    }, 500); // 500msのデバウンスで頻繁なファイル書き込みを防止

    return () => clearTimeout(timer);
  }, [
    isInitialized,
    selectedTerminal,
    selectedProfile,
    sourceSymbol,
    enableDualFeed,
    subSourceSymbol,
    additionalSymbols,
    startTime,
    endTime,
    preloadedBars,
    autoScrollSync,
    autoSkipWeekend,
    preloadMode,
    preloadDate,
    preloadTimeframe,
    hotkeys,
    timePresets,
    tickPresets,
    alwaysOnTop,
    isShortcutsActive,
    timezoneMode,
    plColorStyle,
    orderColorStyle,
    hedging,
    enableVirtualTrading,
    initialBalance,
    leverage,
    contractSize,
    enablePseudoRate,
    pseudoBaseSpread,
    pseudoThreshold,
    pseudoSensitivity,
    pseudoMode,
    pseudoRolloverEnabled,
    pseudoRolloverSpread,
    pseudoRolloverRecoveryMin,
    showHoldingTime,
    holdingTimeMode
  ]);

  // --- 2. 各種制御関数



  // リプレイ初期化
  const handleInit = async () => {
    setErrorMessage("");
    updateRestoringSession(null);
    isRestoringRef.current = false;

    // 固有の新規セッショングループIDを生成し、関連Stateを初期化
    const newGroupId = "group_" + Date.now();
    setCurrentGroupSessionId(newGroupId);
    setCurrentSessionId(null);
    setCurrentSessionName("");

    if (!selectedProfile) {
      setErrorMessage("Chart Profileを選択してください。プロファイルが存在しない場合は、MT5側で作成してください。");
      return;
    }

    // 日付整合性チェック
    const startDate = new Date(startTime.replace(" ", "T"));
    const endDate = new Date(endTime.replace(" ", "T"));
    const startMsc = startDate.getTime();
    const endMsc = endDate.getTime();

    if (isNaN(startMsc) || isNaN(endMsc)) {
      setErrorMessage("開始日時または終了日時の形式が正しくありません。");
      return;
    }

    // 年を跨ぐ期間指定のチェック
    if (startDate.getFullYear() !== endDate.getFullYear()) {
      setErrorMessage("年を跨ぐ期間は指定できません。日付選択を誤っている可能性があります。");
      return;
    }

    // シンボル年度と検証期間年度の一致チェック
    const mismatch = checkSymbolYearMismatch(sourceSymbol, startTime);
    if (mismatch.hasMismatch && mismatch.symbolYear) {
      setErrorMessage(`選択中シンボルの年度 (${mismatch.symbolYear}年) と検証期間の年度 (${mismatch.dateYear}年) が一致していません。期間を${mismatch.symbolYear}年に設定してください。`);
      return;
    }

    if (preloadMode === "DATE") {
      const preloadMsc = new Date(preloadDate.replace(" ", "T")).getTime();
      if (isNaN(preloadMsc)) {
        setErrorMessage("プリロード開始日時の形式が正しくありません。");
        return;
      }
      if (!(preloadMsc <= startMsc && startMsc <= endMsc)) {
        setErrorMessage("日付の整合性が取れていません (過去プリロード開始日 <= 開始日時 <= 終了日時 となるように設定してください)。");
        return;
      }
    } else {
      if (!(startMsc <= endMsc)) {
        setErrorMessage("日付の整合性が取れていません (開始日時 <= 終了日時 となるように設定してください)。");
        return;
      }
    }

    // 経済指標データの充足確認＆一括メモリロード (単一パス/IO重複排除)
    try {
      const checkResult = await checkEconomicDataAvailability(
        sourceSymbol,
        startTime,
        endTime,
        preloadMode,
        preloadDate,
        economicDataDir
      );
      if (checkResult) {
        const map: Record<string, boolean> = {};
        checkResult.months.forEach((m) => {
          map[m.year_month] = m.exists;
        });
        setEconomicAvailabilityMap(map);

        if (!checkResult.is_all_available) {
          setEconomicMissingMonths(checkResult.missing_months);
          setEconomicAvailableMonths(checkResult.available_months);
          setIsEconomicWarningOpen(true);
          return;
        }
      }
    } catch (e) {
      console.warn("Economic data availability check error:", e);
    }

    // チャート最大バー数が Unlimited でない場合の確認警告
    if (maxBarsInfo && !maxBarsInfo.is_unlimited) {
      setIsMaxBarsWarningOpen(true);
      return;
    }

    await executeInitReplay();
  };

  const saveEconomicDataDir = async (newDir: string) => {
    setEconomicDataDir(newDir);
    localStorage.setItem(STORAGE_KEYS.replayEconomicDataDir, newDir);
    try {
      await invoke(COMMANDS.saveSettings, {
        settings: {
          economic_data_dir: newDir,
        },
      });
    } catch (e) {
      console.error("Failed to save economic_data_dir setting", e);
    }
  };

  // 経済指標データフォルダの変更ハンドラー (不足確認モーダルから呼び出し)
  const handleEconomicFolderSelected = async (newDir: string) => {
    await saveEconomicDataDir(newDir);

    try {
      const checkResult = await checkEconomicDataAvailability(
        sourceSymbol,
        startTime,
        endTime,
        preloadMode,
        preloadDate,
        newDir
      );
      if (checkResult) {
        const map: Record<string, boolean> = {};
        checkResult.months.forEach((m) => {
          map[m.year_month] = m.exists;
        });
        setEconomicAvailabilityMap(map);
        setEconomicMissingMonths(checkResult.missing_months);
        setEconomicAvailableMonths(checkResult.available_months);
        if (checkResult.is_all_available) {
          setIsEconomicWarningOpen(false);
        }
      }
    } catch (e) {
      console.warn("Re-check economic data availability error:", e);
    }
  };

  // 経済指標データ不足確認モーダルで「このまま開始する」が押された場合の処理
  const handleProceedWithMissingEconomicData = async () => {
    setIsEconomicWarningOpen(false);
    if (maxBarsInfo && !maxBarsInfo.is_unlimited) {
      setIsMaxBarsWarningOpen(true);
      return;
    }
    await executeInitReplay();
  };

  const executeInitReplay = async () => {
    setIsReplayInitializing(true);
    try {
      // プロファイル転送
      await invoke(COMMANDS.selectProfile, {
        terminalPath: selectedTerminal,
        profileName: selectedProfile,
      });

      // 現在の設定を保存
      await saveAllSettings();

      // 経済指標スケジュールCSVの事前取得（有効時）
      let economicEventsCsv = "";
      if (enablePseudoRate) {
        try {
          economicEventsCsv = await invoke<string>(COMMANDS.getEconomicScheduleCsv, {
            symbol: sourceSymbol,
            startTime: startTime,
            endTime: endTime,
            preloadMode: preloadMode,
            preloadDate: preloadDate,
            customDir: economicDataDir && economicDataDir.trim() ? economicDataDir.trim() : null,
          });
        } catch (e) {
          console.warn("経済指標スケジュール取得スキップ:", e);
        }
      }

      const initCmd = {
        command: "INIT",
        source_symbol: sourceSymbol,
        enable_dual_feed: enableDualFeed,
        sub_source_symbol: enableDualFeed ? subSourceSymbol : "",
        start_time: startTime,
        end_time: endTime,
        profile_name: selectedProfile,
        tokyo_core: "08:45",
        london_summer: "15:00",
        london_winter: "16:00",
        ny_summer: "21:00",
        ny_winter: "22:00",
        preloaded_bars: preloadedBars,
        auto_scroll_sync: autoScrollSync,
        preload_mode: preloadMode,
        preload_date: preloadDate,
        preload_timeframe: preloadTimeframe,
        auto_skip_weekend: autoSkipWeekend,
        enable_pseudo_rate: enablePseudoRate,
        pseudo_base_spread: pipsToPriceDiff(sourceSymbol, pseudoBaseSpread),
        pseudo_threshold: pipsToPriceDiff(sourceSymbol, pseudoThreshold),
        pseudo_sensitivity: pseudoSensitivity,
        pseudo_rollover_enabled: pseudoRolloverEnabled,
        pseudo_rollover_spread: pipsToPriceDiff(sourceSymbol, pseudoRolloverSpread),
        pseudo_rollover_recovery_min: pseudoRolloverRecoveryMin,
        economic_events_csv: economicEventsCsv,
        economic_data_dir: economicDataDir,
        additional_symbols: additionalSymbols,
        initial_balance: initialBalance,
        contract_size: contractSize,
        leverage: leverage,
        hedging: hedging,
      };

      await sendCommand(initCmd);
    } catch (e) {
      setErrorMessage(translateErrorMessage("Initialization error: " + e));
      setIsReplayInitializing(false);
    }
  };

  // リプレイ設定をデフォルト値にリセット
  const handleResetReplaySettings = () => {
    setIsResetReplayConfirmOpen(true);
  };

  const executeResetReplaySettings = () => {
    if (terminals.length > 0) {
      setSelectedTerminal(terminals[0].path);
    }
    if (profiles.length > 0) {
      setSelectedProfile(profiles[0]);
    }
    setSourceSymbol("USDJPY.cl");
    setPreloadMode("BARS");
    setTimezoneMode("JST");
    setPreloadedBars(300);
    setPreloadTimeframe("AUTO");
    setStartTime("2026-05-01 00:00:00");
    setEndTime("2026-05-02 00:00:00");
    setAutoScrollSync(true);
    setAutoSkipWeekend(true);
    setPreloadDate("2026-01-01 00:00:00");
  };

  // 取引設定をデフォルト値にリセット
  const handleResetTradingSettings = () => {
    setIsResetTradingConfirmOpen(true);
  };

  const executeResetTradingSettings = () => {
    setEnableVirtualTrading(true);
    setInitialBalance(1000000);
    setLeverage(25);
    setContractSize(10000);
    localStorage.setItem(STORAGE_KEYS.speedOrderContractSize, "10000");
    localStorage.removeItem(STORAGE_KEYS.speedOrderPositionRealTimes);
    setHedging(false);
    setEnablePseudoRate(true);

    setPseudoBaseSpread(0.2);
    setPseudoThreshold(1.5);
    setPseudoSensitivity(0.25);
    setPseudoRolloverSpread(3.8);
    setPseudoRolloverRecoveryMin(15);
  };

  // 再生/一時停止
  const handlePlayPause = () => {
    const nextPlaying = !isPlayingRef.current;
    isPlayingRef.current = nextPlaying;
    playStateGuardRef.current = {
      expected: nextPlaying,
      expireAt: performance.now() + 500,
    };
    setIsPlaying(nextPlaying);
    sendCommand({
      command: "CONTROL",
      is_playing: nextPlaying,
      speed_mode: speedMode,
      multiplier: multiplier,
      tick_step: tickStep,
      auto_skip_weekend: autoSkipWeekend,
    });
  };

  // 1ステップ進む/戻る
  const handleStep = (delta: number) => {
    sendCommand({
      command: "SEEK_RELATIVE",
      delta: delta,
    });
  };

  // セッションジャンプ
  const handleSessionJump = (session: string, direction: "PREV" | "NEXT") => {
    sendCommand({
      command: "SESSION_JUMP",
      session: session,
      direction: direction,
    });
  };

  // 時間シーク
  const handleTimeJump = (seconds: number) => {
    sendCommand({
      command: "TIME_JUMP",
      delta_seconds: seconds,
    });
  };

  // A-Bループ制御
  const handleSetLoopA = () => sendCommand({ command: "LOOP_SET_A" });
  const handleSetLoopB = () => sendCommand({ command: "LOOP_SET_B" });
  const handleClearLoop = () => sendCommand({ command: "LOOP_CLEAR" });

  // リセット
  const handleReset = () => {
    localStorage.removeItem(STORAGE_KEYS.speedOrderPositionRealTimes);
    sendCommand({ command: "RESET" });
  };

  // 初期化のキャンセル
  const handleCancelInit = async () => {
    try {
      await sendCommand({ command: "TERMINATE" });
    } catch (e) {
      console.error("Failed to cancel initialization", e);
    }
    isRestoringRef.current = false;
    restoringSessionRef.current = null;
    setRestoringSession(null);
    setIsReplayInitializing(false);
    setStatus("CONNECTED");
  };

  const loadSavedSessions = async () => {
    try {
      const res = await invoke<SavedSession[]>(COMMANDS.getSavedSessions);
      setSavedSessions(res);
    } catch (e) {
      console.error("Failed to load saved sessions", e);
    }
  };

  const handleDeleteSessions = (sessionIds: string[], message: string) => {
    setSessionsToDelete(sessionIds);
    setDeleteConfirmMessage(message);
    setIsDeleteSessionConfirmOpen(true);
  };

  const executeDeleteSession = async () => {
    if (sessionsToDelete.length === 0) return;
    try {
      for (const sid of sessionsToDelete) {
        await invoke(COMMANDS.deleteSession, { sessionId: sid });
      }
      await loadSavedSessions();
    } catch (e) {
      console.error("Failed to delete session(s)", e);
      setErrorMessage("セッションデータの削除に失敗しました。");
    } finally {
      setSessionsToDelete([]);
      setIsDeleteSessionConfirmOpen(false);
    }
  };

  const handleClearAllSessions = () => {
    setIsClearAllSessionsConfirmOpen(true);
  };

  const executeClearAllSessions = async () => {
    try {
      await invoke(COMMANDS.clearAllSessions);
      await loadSavedSessions();
    } catch (e) {
      console.error("Failed to clear all sessions", e);
      setErrorMessage("セッションデータの一括削除に失敗しました。");
    } finally {
      setIsClearAllSessionsConfirmOpen(false);
    }
  };

  const handleResumeSession = async (session: SavedSession) => {
    setErrorMessage("");

    // 保存された設定項目をフロントエンドの状態に反映
    setSelectedTerminal(session.settings.selected_terminal);
    setSelectedProfile(session.settings.selected_profile);
    setSourceSymbol(session.settings.source_symbol);
    if (session.settings.enable_dual_feed !== undefined) {
      setEnableDualFeed(session.settings.enable_dual_feed);
    }
    if (session.settings.sub_source_symbol) {
      setSubSourceSymbol(session.settings.sub_source_symbol);
    }
    if (session.settings.additional_symbols !== undefined) {
      setAdditionalSymbols(session.settings.additional_symbols);
    }
    if (session.settings.contract_size !== undefined) {
      setContractSize(session.settings.contract_size);
      localStorage.setItem(STORAGE_KEYS.speedOrderContractSize, String(session.settings.contract_size));
    }
    setStartTime(session.settings.start_time);
    setEndTime(session.settings.end_time);
    setPreloadedBars(session.settings.preloaded_bars);
    setAutoScrollSync(session.settings.auto_scroll_sync);
    setAutoSkipWeekend(session.settings.auto_skip_weekend ?? true);
    setPreloadMode(session.settings.preload_mode || "BARS");
    setPreloadDate(session.settings.preload_date || "2026-01-01 00:00:00");
    setPreloadTimeframe(session.settings.preload_timeframe || "AUTO");

    if (session.settings.timezone_mode) {
      setTimezoneMode(session.settings.timezone_mode as "JST" | "SERVER");
    }
    if (session.settings.enable_virtual_trading !== undefined) {
      setEnableVirtualTrading(session.settings.enable_virtual_trading);
    }
    if (session.settings.initial_balance !== undefined) {
      setInitialBalance(session.settings.initial_balance);
    }
    if (session.settings.leverage !== undefined) {
      setLeverage(session.settings.leverage);
    }
    if (session.settings.enable_pseudo_rate !== undefined) {
      setEnablePseudoRate(session.settings.enable_pseudo_rate);
    }
    if (session.settings.pseudo_base_spread !== undefined) {
      // セッションはpips単位で保存されているため変換不要。0の場合はデフォルト値を使用。
      setPseudoBaseSpread(session.settings.pseudo_base_spread > 0 ? session.settings.pseudo_base_spread : 0.2);
    }
    if (session.settings.pseudo_threshold !== undefined) {
      // セッションはpips単位で保存されているため変換不要。0の場合はデフォルト値を使用。
      setPseudoThreshold(session.settings.pseudo_threshold > 0 ? session.settings.pseudo_threshold : 1.0);
    }
    if (session.settings.pseudo_sensitivity !== undefined) {
      setPseudoSensitivity(session.settings.pseudo_sensitivity);
    }
    if (session.settings.pseudo_mode) {
      setPseudoMode(session.settings.pseudo_mode as "dmm" | "fixed" | "aggressive" | "custom");
    }
    if (session.settings.pseudo_rollover_enabled !== undefined) {
      setPseudoRolloverEnabled(session.settings.pseudo_rollover_enabled);
    }
    if (session.settings.pseudo_rollover_spread !== undefined) {
      setPseudoRolloverSpread(session.settings.pseudo_rollover_spread > 0 ? session.settings.pseudo_rollover_spread : 3.5);
    }
    if (session.settings.pseudo_rollover_recovery_min !== undefined) {
      setPseudoRolloverRecoveryMin(session.settings.pseudo_rollover_recovery_min);
    }

    // 復元対象のセッション管理状態を更新
    setCurrentGroupSessionId(session.group_session_id || session.id);
    setCurrentSessionId(session.id);
    setCurrentSessionName(session.name);

    // 復元対象のデータを保持
    updateRestoringSession(session);

    // リプレイの初期化実行
    setIsReplayInitializing(true);
    try {
      // プロファイル転送
      await invoke(COMMANDS.selectProfile, {
        terminalPath: session.settings.selected_terminal,
        profileName: session.settings.selected_profile,
      });

      const sym = session.settings.source_symbol || sourceSymbol;
      const isDual = session.settings.enable_dual_feed !== undefined ? session.settings.enable_dual_feed : enableDualFeed;
      const subSym = isDual ? (session.settings.sub_source_symbol || subSourceSymbol) : "";
      const syncSyms = session.settings.additional_symbols !== undefined ? session.settings.additional_symbols : additionalSymbols;

      const initCmd = {
        command: "INIT",
        source_symbol: session.settings.source_symbol,
        enable_dual_feed: isDual,
        sub_source_symbol: subSym,
        additional_symbols: syncSyms,
        start_time: session.settings.start_time,
        end_time: session.settings.end_time,
        profile_name: session.settings.selected_profile,
        tokyo_core: "08:45",
        london_summer: "15:00",
        london_winter: "16:00",
        ny_summer: "21:00",
        ny_winter: "22:00",
        preloaded_bars: session.settings.preloaded_bars,
        auto_scroll_sync: session.settings.auto_scroll_sync,
        preload_mode: session.settings.preload_mode || "BARS",
        preload_date: session.settings.preload_date || "2026-01-01 00:00:00",
        preload_timeframe: session.settings.preload_timeframe || "AUTO",
        auto_skip_weekend: session.settings.auto_skip_weekend !== undefined ? session.settings.auto_skip_weekend : true,
        enable_pseudo_rate: session.settings.enable_pseudo_rate !== undefined ? session.settings.enable_pseudo_rate : true,
        pseudo_base_spread: pipsToPriceDiff(
          sym,
          // セッションはpips単位で保存されているため、priceDiffToPipsは不要
          (session.settings.pseudo_base_spread !== undefined && session.settings.pseudo_base_spread > 0)
            ? session.settings.pseudo_base_spread : 0.2
        ),
        pseudo_threshold: pipsToPriceDiff(
          sym,
          // セッションはpips単位で保存されているため、priceDiffToPipsは不要
          (session.settings.pseudo_threshold !== undefined && session.settings.pseudo_threshold > 0)
            ? session.settings.pseudo_threshold : 1.0
        ),
        pseudo_sensitivity: session.settings.pseudo_sensitivity !== undefined ? session.settings.pseudo_sensitivity : 0.35,
        pseudo_rollover_enabled: session.settings.pseudo_rollover_enabled !== undefined ? session.settings.pseudo_rollover_enabled : true,
        pseudo_rollover_spread: pipsToPriceDiff(
          sym,
          (session.settings.pseudo_rollover_spread !== undefined && session.settings.pseudo_rollover_spread > 0)
            ? session.settings.pseudo_rollover_spread : 3.5
        ),
        pseudo_rollover_recovery_min: session.settings.pseudo_rollover_recovery_min !== undefined ? session.settings.pseudo_rollover_recovery_min : 15,
      };

      await sendCommand(initCmd);
    } catch (e) {
      setErrorMessage("セッションの初期化中にエラーが発生しました: " + e);
      setIsReplayInitializing(false);
      updateRestoringSession(null);
    }
  };

  const executeSaveSession = async () => {
    if (!saveSessionName.trim()) return;

    const isNew = !currentSessionId || saveAsNewSnapshot;
    const sessionId = isNew ? "session_" + Date.now() : currentSessionId;
    const groupSessionId = currentGroupSessionId || "group_" + Date.now();

    const sessionData = {
      id: sessionId,
      name: saveSessionName,
      saved_at: new Date().toISOString(),
      group_session_id: groupSessionId,
      settings: {
        selected_terminal: selectedTerminal,
        selected_profile: selectedProfile,
        source_symbol: sourceSymbol,
        enable_dual_feed: enableDualFeed,
        sub_source_symbol: subSourceSymbol,
        additional_symbols: additionalSymbols,
        contract_size: contractSize,
        start_time: startTime,
        end_time: endTime,
        preloaded_bars: preloadedBars,
        auto_scroll_sync: autoScrollSync,
        auto_skip_weekend: autoSkipWeekend,
        preload_mode: preloadMode,
        preload_date: preloadDate,
        preload_timeframe: preloadTimeframe,
        timezone_mode: timezoneMode,
        enable_virtual_trading: enableVirtualTrading,
        initial_balance: initialBalance,
        leverage: leverage,
        enable_pseudo_rate: enablePseudoRate,
        pseudo_base_spread: pseudoBaseSpread,
        pseudo_threshold: pseudoThreshold,
        pseudo_sensitivity: pseudoSensitivity,
        pseudo_mode: pseudoMode,
        pseudo_rollover_enabled: pseudoRolloverEnabled,
        pseudo_rollover_spread: pseudoRolloverSpread,
        pseudo_rollover_recovery_min: pseudoRolloverRecoveryMin,
      },
      progress: {
        current_idx: currentIdx,
        total_ticks: totalTicks,
        virtual_time_msc: virtualTimeMsc,
        speed_mode: speedMode,
        multiplier: multiplier,
        tick_step: tickStep
      },
      virtual_trade: enableVirtualTrading ? {
        initial_balance: initialBalance,
        balance: account?.balance || initialBalance,
        equity: account?.equity || initialBalance,
        leverage: leverage,
        margin: account?.margin || 0,
        free_margin: account?.free_margin || initialBalance,
        margin_level: account?.margin_level || 0,
        next_ticket: Math.max(10001, ...(positions.map(p => p.ticket)), ...(history.map(h => h.ticket))) + 1,
        positions: positions.map(p => {
          let pcAccumulated = 0;
          try {
            const storedTimesStr = localStorage.getItem(STORAGE_KEYS.speedOrderPositionRealTimes);
            if (storedTimesStr) {
              const storedTimes = JSON.parse(storedTimesStr);
              const posKey = `${p.ticket}_${p.open_time_msc}`;
              if (storedTimes[posKey] !== undefined) {
                pcAccumulated = storedTimes[posKey];
              } else if (storedTimes[p.ticket] !== undefined) {
                pcAccumulated = storedTimes[p.ticket];
              }
            }
          } catch (e) {
            console.error("Failed to parse storedTimes in session save", e);
          }
          return {
            ticket: p.ticket,
            type: p.type,
            volume: p.volume,
            open_price: p.open_price,
            open_time_msc: p.open_time_msc,
            sl: p.sl,
            tp: p.tp,
            current_price: p.current_price,
            profit: p.profit,
            accumulated_real_time: pcAccumulated,
            mfe_pips: p.mfe_pips,
            mae_pips: p.mae_pips,
            spread_entry: p.spread_entry,
            volatility: p.volatility,
            volume_60s: p.volume_60s
          };
        }),
        history: history.map(h => {
          let pcAccumulated = 0;
          try {
            const storedTimesStr = localStorage.getItem(STORAGE_KEYS.speedOrderPositionRealTimes);
            if (storedTimesStr) {
              const storedTimes = JSON.parse(storedTimesStr);
              const histKey = `${h.ticket}_${h.open_time_msc}`;
              if (storedTimes[histKey] !== undefined) {
                pcAccumulated = storedTimes[histKey];
              } else if (storedTimes[h.ticket] !== undefined) {
                pcAccumulated = storedTimes[h.ticket];
              }
            }
          } catch (e) {
            console.error("Failed to parse storedTimes in session save for history", e);
          }
          return {
            ticket: h.ticket,
            type: h.type,
            volume: h.volume,
            open_price: h.open_price,
            open_time_msc: h.open_time_msc,
            close_price: h.close_price,
            close_time_msc: h.close_time_msc,
            sl: h.sl,
            tp: h.tp,
            profit: h.profit,
            close_reason: h.close_reason,
            accumulated_real_time: pcAccumulated,
            mfe_pips: h.mfe_pips,
            mae_pips: h.mae_pips,
            spread_entry: h.spread_entry,
            volatility: h.volatility,
            volume_60s: h.volume_60s
          };
        })
      } : null
    };

    try {
      await invoke(COMMANDS.saveSession, { sessionId, sessionData });
      setCurrentSessionId(sessionId);
      setCurrentSessionName(saveSessionName);
      setCurrentGroupSessionId(groupSessionId);
      await loadSavedSessions();
    } catch (e) {
      console.error("Failed to save session", e);
      setErrorMessage("セッションデータの保存に失敗しました。");
    }
  };

  const executeTerminate = async () => {
    sendCommand({ command: "TERMINATE" });
    setStatus("CONNECTED");
    playStateGuardRef.current = null;
    isPlayingRef.current = false;
    setIsPlaying(false);
    setLoopActive(false);
    setLoopA(-1);
    setLoopB(-1);
    setLoopAIdx(-1);
    setLoopBIdx(-1);

    // スピード発注画面も自動で終了する
    try {
      const win = await WebviewWindow.getByLabel("speed_order");
      if (win) {
        await win.close();
      }
    } catch (e) {
      console.error("Failed to close speed_order window:", e);
    }
  };

  // リモコンモード切り替え（Tauriウィンドウサイズ・枠線・位置吸着制御）
  const toggleRemoteMode = useCallback(async (remote: boolean) => {
    try {
      await invoke(COMMANDS.setRemoteMode, { isRemote: remote, alwaysOnTop: alwaysOnTop });
      setIsRemoteMode(remote);
      if (remote) {
        setIsSettingsOpen(false);
        setActivePickerField(null);
        setRecordingAction(null);
      }
    } catch (e) {
      console.error("Failed to toggle remote mode", e);
    }
  }, [alwaysOnTop]);

  // ドラッグ開始ハンドラ（ボーダレスウィンドウの移動用）
  const handleDragStart = useCallback(async (e: React.MouseEvent) => {
    if (e.button === 0) { // 左クリックのみ
      try {
        await getCurrentWindow().startDragging();
      } catch (err) {
        console.error("Failed to start dragging window", err);
      }
    }
  }, []);

  // 終了
  const handleTerminate = useCallback(async () => {
    if (isRemoteMode) {
      await toggleRemoteMode(false);
    }
    // 保存確認モーダルを表示
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const defaultName = `${sourceSymbol}_Replay_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    setSaveSessionName(currentSessionId ? currentSessionName : defaultName);
    setSaveAsNewSnapshot(false);
    setSessionSaveType("terminate");
    setIsSaveSessionOpen(true);
  }, [isRemoteMode, toggleRemoteMode, sourceSymbol, currentSessionId, currentSessionName]);

  // リモートモード時のbody・html背景透過の制御
  useEffect(() => {
    if (isRemoteMode) {
      document.body.classList.add("remote-body");
      document.documentElement.classList.add("remote-html");
    } else {
      document.body.classList.remove("remote-body");
      document.documentElement.classList.remove("remote-html");
    }
    return () => {
      document.body.classList.remove("remote-body");
      document.documentElement.classList.remove("remote-html");
    };
  }, [isRemoteMode]);

  // 速度変更 (CONTROL)
  const updateSpeed = (mode: "TEMPORAL" | "COUNT", mult: number, step: number) => {
    setSpeedMode(mode);
    setMultiplier(mult);
    setTickStep(step);
    sendCommand({
      command: "CONTROL",
      speed_mode: mode,
      multiplier: mult,
      tick_step: step,
      auto_skip_weekend: autoSkipWeekend,
    });
  };

  // Coarse（粗調整）速度変更
  const handleCoarseSpeed = (increment: boolean) => {
    if (speedMode === "TEMPORAL") {
      const presets = [...timePresets].sort((a, b) => a - b);
      if (presets.length === 0) return;
      let idx = presets.findIndex((p) => Math.abs(p - multiplier) < 0.01);
      if (idx === -1) {
        idx = presets.reduce((closestIdx, curr, currIdx) => {
          return Math.abs(curr - multiplier) < Math.abs(presets[closestIdx] - multiplier) ? currIdx : closestIdx;
        }, 0);
      }
      const nextIdx = increment ? Math.min(presets.length - 1, idx + 1) : Math.max(0, idx - 1);
      updateSpeed("TEMPORAL", presets[nextIdx], tickStep);
    } else {
      const presets = [...tickPresets].sort((a, b) => a - b);
      if (presets.length === 0) return;
      let idx = presets.indexOf(tickStep);
      if (idx === -1) {
        idx = presets.reduce((closestIdx, curr, currIdx) => {
          return Math.abs(curr - tickStep) < Math.abs(presets[closestIdx] - tickStep) ? currIdx : closestIdx;
        }, 0);
      }
      const nextIdx = increment ? Math.min(presets.length - 1, idx + 1) : Math.max(0, idx - 1);
      updateSpeed("COUNT", multiplier, presets[nextIdx]);
    }
  };

  const adjustSpeedByStep = (temporalDelta: number, countDelta: number) => {
    if (speedMode === "TEMPORAL") {
      let nextVal = multiplier + temporalDelta;
      nextVal = Math.max(0.1, Math.min(1000.0, nextVal));
      updateSpeed("TEMPORAL", Math.round(nextVal * 10) / 10, tickStep);
    } else {
      let nextVal = tickStep + countDelta;
      nextVal = Math.max(1, Math.min(1000, nextVal));
      updateSpeed("COUNT", multiplier, nextVal);
    }
  };

  // Fine（0.1刻み微調整）速度変更
  const handleFineSpeed = (increment: boolean) => {
    adjustSpeedByStep(increment ? 0.1 : -0.1, increment ? 1 : -1);
  };

  // Medium（1.0刻み調整）速度変更
  const handleMediumSpeed = (increment: boolean) => {
    adjustSpeedByStep(increment ? 1.0 : -1.0, increment ? 10 : -10);
  };

  // --- 3. UIトグル動作

  // 常に最前面に表示トグル
  const handleAlwaysOnTopToggle = useCallback(async () => {
    const next = !alwaysOnTop;
    try {
      await invoke(COMMANDS.setAlwaysOnTop, { always: next });
      setAlwaysOnTop(next);
      await saveAllSettingsRef.current({ always_on_top: next });
    } catch (e) {
      console.error(e);
    }
  }, [alwaysOnTop]);

  // 時間比率モード時の週末自動スキップ有効化トグル
  const handleAutoSkipWeekendToggle = useCallback((val: boolean) => {
    setAutoSkipWeekend(val);
    saveAllSettingsRef.current({ auto_skip_weekend: val });
    if (status === "READY" || status === "ACTIVE") {
      sendCommand({
        command: "CONTROL",
        speed_mode: speedMode,
        multiplier: multiplier,
        tick_step: tickStep,
        auto_skip_weekend: val,
      });
    }
  }, [status, speedMode, multiplier, tickStep, sendCommand]);

  // キーボードショートカット有効化トグル
  const handleShortcutsToggle = useCallback(async () => {
    const next = !isShortcutsActive;
    try {
      await invoke(COMMANDS.setShortcutsActive, { active: next, hotkeys: hotkeys });
      setIsShortcutsActive(next);
      await saveAllSettingsRef.current({ is_shortcuts_active: next });
    } catch (e) {
      console.error(e);
    }
  }, [isShortcutsActive, hotkeys]);

  // Keep handlersRef updated with the latest closures
  useEffect(() => {
    handlersRef.current = {
      handlePlayPause,
      handleStep,
      handleSessionJump,
      handleTimeJump,
      handleCoarseSpeed,
      handleMediumSpeed,
      handleFineSpeed,
      updateSpeed,
      speedMode,
      multiplier,
      tickStep,
      handleSetLoopA,
      handleSetLoopB,
      handleClearLoop,
      handleReset,
      hotkeys,
      recordingAction,
    };
  });

  // --- 4. キーボードショートカット (フォーカスがある場合のローカルフォールバック)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const currentHandlers = handlersRef.current;
      if (!currentHandlers) return;

      const {
        handlePlayPause,
        handleStep,
        handleSessionJump,
        handleTimeJump,
        handleCoarseSpeed,
        handleMediumSpeed,
        handleFineSpeed,
        updateSpeed,
        speedMode,
        multiplier,
        tickStep,
        handleSetLoopA,
        handleSetLoopB,
        handleClearLoop,
        handleReset,
        hotkeys,
        recordingAction,
      } = currentHandlers;

      // 入力フィールドフォーカス時または録音中は除外
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable ||
        recordingAction
      ) {
        return;
      }

      if (matchesHotkey(e, hotkeys.play_pause)) {
        e.preventDefault();
        if (!e.repeat) {
          handlePlayPause();
        }
      } else if (matchesHotkey(e, hotkeys.step_forward)) {
        e.preventDefault();
        handleStep(1);
      } else if (matchesHotkey(e, hotkeys.step_backward)) {
        e.preventDefault();
        handleStep(-1);
      } else if (matchesHotkey(e, hotkeys.session_jump_next)) {
        e.preventDefault();
        handleSessionJump("ANY", "NEXT");
      } else if (matchesHotkey(e, hotkeys.session_jump_prev)) {
        e.preventDefault();
        handleSessionJump("ANY", "PREV");
      } else if (matchesHotkey(e, hotkeys.time_jump_forward)) {
        e.preventDefault();
        handleTimeJump(3600);
      } else if (matchesHotkey(e, hotkeys.time_jump_backward)) {
        e.preventDefault();
        handleTimeJump(-3600);
      } else if (matchesHotkey(e, hotkeys.time_jump_forward_1m)) {
        e.preventDefault();
        handleTimeJump(60);
      } else if (matchesHotkey(e, hotkeys.time_jump_backward_1m)) {
        e.preventDefault();
        handleTimeJump(-60);
      } else if (matchesHotkey(e, hotkeys.time_jump_forward_10m)) {
        e.preventDefault();
        handleTimeJump(600);
      } else if (matchesHotkey(e, hotkeys.time_jump_backward_10m)) {
        e.preventDefault();
        handleTimeJump(-600);
      } else if (matchesHotkey(e, hotkeys.coarse_speed_up)) {
        e.preventDefault();
        handleCoarseSpeed(true);
      } else if (matchesHotkey(e, hotkeys.coarse_speed_down)) {
        e.preventDefault();
        handleCoarseSpeed(false);
      } else if (matchesHotkey(e, hotkeys.medium_speed_up)) {
        e.preventDefault();
        handleMediumSpeed(true);
      } else if (matchesHotkey(e, hotkeys.medium_speed_down)) {
        e.preventDefault();
        handleMediumSpeed(false);
      } else if (matchesHotkey(e, hotkeys.fine_speed_up)) {
        e.preventDefault();
        handleFineSpeed(true);
      } else if (matchesHotkey(e, hotkeys.fine_speed_down)) {
        e.preventDefault();
        handleFineSpeed(false);
      } else if (matchesHotkey(e, hotkeys.speed_mode_toggle)) {
        e.preventDefault();
        updateSpeed(speedMode === "TEMPORAL" ? "COUNT" : "TEMPORAL", multiplier, tickStep);
      } else if (matchesHotkey(e, hotkeys.speed_reset_1x)) {
        e.preventDefault();
        updateSpeed(speedMode, 1.0, 1);
      } else if (matchesHotkey(e, hotkeys.loop_set_a)) {
        e.preventDefault();
        handleSetLoopA();
      } else if (matchesHotkey(e, hotkeys.loop_set_b)) {
        e.preventDefault();
        handleSetLoopB();
      } else if (matchesHotkey(e, hotkeys.loop_clear)) {
        e.preventDefault();
        handleClearLoop();
      } else if (matchesHotkey(e, hotkeys.reset)) {
        e.preventDefault();
        handleReset();
      } else if (matchesHotkey(e, hotkeys.order_buy)) {
        e.preventDefault();
        emit(EVENTS.triggerAction, { action: "order_buy" }).catch(console.error);
      } else if (matchesHotkey(e, hotkeys.order_sell)) {
        e.preventDefault();
        emit(EVENTS.triggerAction, { action: "order_sell" }).catch(console.error);
      } else if (matchesHotkey(e, hotkeys.order_close_buy)) {
        e.preventDefault();
        emit(EVENTS.triggerAction, { action: "order_close_buy" }).catch(console.error);
      } else if (matchesHotkey(e, hotkeys.order_close_sell)) {
        e.preventDefault();
        emit(EVENTS.triggerAction, { action: "order_close_sell" }).catch(console.error);
      } else if (matchesHotkey(e, hotkeys.order_close_all)) {
        e.preventDefault();
        emit(EVENTS.triggerAction, { action: "order_close_all" }).catch(console.error);
      } else if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.code === "Space") {
        // 直感キー: Space 単体で 再生 / 一時停止
        e.preventDefault();
        handlePlayPause();
      } else if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.code === "ArrowRight") {
        // 直感キー: 右矢印 単体で 1ティック進む (コマ送り)
        e.preventDefault();
        handleStep(1);
      } else if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.code === "ArrowLeft") {
        // 直感キー: 左矢印 単体で 1ティック戻る (コマ戻し)
        e.preventDefault();
        handleStep(-1);
      } else if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && e.code === "ArrowRight") {
        // 直感キー: Shift + 右矢印 で 10分進む (+10M)
        e.preventDefault();
        handleTimeJump(600);
      } else if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && e.code === "ArrowLeft") {
        // 直感キー: Shift + 左矢印 で 10分戻す (-10M)
        e.preventDefault();
        handleTimeJump(-600);
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === "ArrowRight") {
        // 直感キー: Ctrl + 右矢印 で 1時間進む (+1H)
        e.preventDefault();
        handleTimeJump(3600);
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === "ArrowLeft") {
        // 直感キー: Ctrl + 左矢印 で 1時間戻す (-1H)
        e.preventDefault();
        handleTimeJump(-3600);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // SpeedOrderウィンドウ等からのIPC経由のホットキーアクション呼び出しをリッスン
  useEffect(() => {
    const unlisten = listen<{ action: string }>(EVENTS.triggerAction, (event) => {
      const { action } = event.payload;
      const currentHandlers = handlersRef.current;
      if (!currentHandlers) return;

      const {
        handlePlayPause,
        handleStep,
        handleSessionJump,
        handleTimeJump,
        handleCoarseSpeed,
        handleMediumSpeed,
        handleFineSpeed,
        updateSpeed,
        speedMode,
        multiplier,
        tickStep,
        handleSetLoopA,
        handleSetLoopB,
        handleClearLoop,
        handleReset,
      } = currentHandlers;

      switch (action) {
        case "play_pause":
          handlePlayPause();
          break;
        case "step_forward":
          handleStep(1);
          break;
        case "step_backward":
          handleStep(-1);
          break;
        case "session_jump_next":
          handleSessionJump("ANY", "NEXT");
          break;
        case "session_jump_prev":
          handleSessionJump("ANY", "PREV");
          break;
        case "time_jump_forward":
          handleTimeJump(3600);
          break;
        case "time_jump_backward":
          handleTimeJump(-3600);
          break;
        case "time_jump_forward_1m":
          handleTimeJump(60);
          break;
        case "time_jump_backward_1m":
          handleTimeJump(-60);
          break;
        case "time_jump_forward_10m":
          handleTimeJump(600);
          break;
        case "time_jump_backward_10m":
          handleTimeJump(-600);
          break;
        case "coarse_speed_up":
          handleCoarseSpeed(true);
          break;
        case "coarse_speed_down":
          handleCoarseSpeed(false);
          break;
        case "medium_speed_up":
          handleMediumSpeed(true);
          break;
        case "medium_speed_down":
          handleMediumSpeed(false);
          break;
        case "fine_speed_up":
          handleFineSpeed(true);
          break;
        case "fine_speed_down":
          handleFineSpeed(false);
          break;
        case "speed_mode_toggle":
          updateSpeed(speedMode === "TEMPORAL" ? "COUNT" : "TEMPORAL", multiplier, tickStep);
          break;
        case "speed_reset_1x":
          updateSpeed(speedMode, 1.0, 1);
          break;
        case "loop_set_a":
          handleSetLoopA();
          break;
        case "loop_set_b":
          handleSetLoopB();
          break;
        case "loop_clear":
          handleClearLoop();
          break;
        case "reset":
          handleReset();
          break;
        default:
          break;
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // --- ホットキー録音（レコーディング）用エフェクト
  useEffect(() => {
    if (!recordingAction) return;

    const handleRecordKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Escキー単体押下時はキャンセル
      if (e.key === "Escape" && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
        setRecordingAction(null);
        return;
      }

      const mainKey = e.code;
      if (
        mainKey === "ControlLeft" ||
        mainKey === "ControlRight" ||
        mainKey === "ShiftLeft" ||
        mainKey === "ShiftRight" ||
        mainKey === "AltLeft" ||
        mainKey === "AltRight" ||
        mainKey === "MetaLeft" ||
        mainKey === "MetaRight"
      ) {
        return;
      }

      const shortcutStr = getTauriShortcutFromEvent(e);
      if (shortcutStr) {
        const newHotkeys = { ...hotkeys, [recordingAction]: shortcutStr };
        setHotkeys(newHotkeys);

        // 設定保存
        saveAllSettingsRef.current({ hotkeys: newHotkeys })
          .then(() => {
            invoke(COMMANDS.setShortcutsActive, { active: isShortcutsActive, hotkeys: newHotkeys }).catch(console.error);
          })
          .catch(console.error);

        setRecordingAction(null);
      }
    };

    window.addEventListener("keydown", handleRecordKeyDown, true);
    return () => window.removeEventListener("keydown", handleRecordKeyDown, true);
  }, [recordingAction, hotkeys, isShortcutsActive]);

  const handleClearHotkey = (actionKey: string) => {
    const newHotkeys = { ...hotkeys, [actionKey]: "" };
    setHotkeys(newHotkeys);

    saveAllSettings({ hotkeys: newHotkeys })
      .then(() => {
        invoke(COMMANDS.setShortcutsActive, { active: isShortcutsActive, hotkeys: newHotkeys }).catch(console.error);
      })
      .catch(console.error);
  };

  const handleResetAllHotkeys = () => {
    setHotkeys(DEFAULT_HOTKEYS);

    saveAllSettings({ hotkeys: DEFAULT_HOTKEYS })
      .then(() => {
        invoke(COMMANDS.setShortcutsActive, { active: isShortcutsActive, hotkeys: DEFAULT_HOTKEYS }).catch(console.error);
      })
      .catch(console.error);
  };

  // --- 5. タイムライン計算用 & シーク処理

  // タイムスタンプ -> JST時間文字列への変換 (US夏時間を加味)
  const getDayOfWeekStr = (msc: number, isJst: boolean) => {
    if (msc <= 0) return "";
    let targetMsc = msc;
    if (isJst) {
      const offsetHours = getServerToJstOffsetHours(msc);
      targetMsc = msc + offsetHours * 3600 * 1000;
    }
    const dayIndex = new Date(targetMsc).getUTCDay();
    const days = ["日", "月", "火", "水", "木", "金", "土"];
    return `(${days[dayIndex]})`;
  };

  // ドラッグ/クリックシーク (requestAnimationFrame によるスロットリングと即時確定)
  const pendingSeekTargetRef = useRef<number | null>(null);
  const seekRafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (seekRafRef.current !== null) {
        cancelAnimationFrame(seekRafRef.current);
      }
    };
  }, []);

  const sendSeekCommand = useCallback((targetIdx: number, immediate: boolean = false) => {
    pendingSeekTargetRef.current = targetIdx;
    if (immediate) {
      if (seekRafRef.current !== null) {
        cancelAnimationFrame(seekRafRef.current);
        seekRafRef.current = null;
      }
      const idx = pendingSeekTargetRef.current;
      pendingSeekTargetRef.current = null;
      sendCommand({
        command: "SEEK",
        target_index: idx,
      }).catch(console.error);
      return;
    }

    if (seekRafRef.current === null) {
      seekRafRef.current = requestAnimationFrame(() => {
        seekRafRef.current = null;
        if (pendingSeekTargetRef.current !== null) {
          const idx = pendingSeekTargetRef.current;
          pendingSeekTargetRef.current = null;
          sendCommand({
            command: "SEEK",
            target_index: idx,
          }).catch(console.error);
        }
      });
    }
  }, [sendCommand]);

  // セッション描画データの整理
  const sessions = useMemo(() => organizeSessions(sessionBoundaries), [sessionBoundaries]);
  const currentSession = useMemo(() => getCurrentSession(sessions, currentIdx), [sessions, currentIdx]);

  // ミニタイムライン用のセッション背景描画
  const renderMiniSessionTrack = useCallback(() => {
    if (totalTicks <= 0 || sessions.length === 0) return null;
    const blocks = [];
    for (let i = 0; i < sessions.length; i++) {
      const current = sessions[i];
      const next = sessions[i + 1];
      const startX = (current.idx / totalTicks) * 100;
      const endX = next ? (next.idx / totalTicks) * 100 : 100;
      const width = endX - startX;
      const color = current.type === "TYO" ? "var(--session-tyo)" : current.type === "LDN" ? "var(--session-ldn)" : "var(--session-ny)";

      blocks.push(
        <div
          key={i}
          style={{
            width: `${width}%`,
            height: "100%",
            backgroundColor: color,
            opacity: 0.35
          }}
        />
      );
    }
    return blocks;
  }, [sessions, totalTicks]);





  // --- 6. レンダリング

  if (isRemoteMode) {
    return (
      <RemoteHudBar
        handleDragStart={handleDragStart}
        timezoneMode={timezoneMode}
        virtualTimeMsc={virtualTimeMsc}
        getDayOfWeekStr={getDayOfWeekStr}
        handleSessionJump={handleSessionJump}
        handleTimeJump={handleTimeJump}
        handleStep={handleStep}
        handlePlayPause={handlePlayPause}
        isPlaying={isPlaying}
        updateSpeed={updateSpeed}
        speedMode={speedMode}
        multiplier={multiplier}
        tickStep={tickStep}
        renderMiniSessionTrack={renderMiniSessionTrack}
        totalTicks={totalTicks}
        currentIdx={currentIdx}
        setCurrentIdx={setCurrentIdx}
        sendSeekCommand={sendSeekCommand}
        startTime={startTime}
        endTime={endTime}
        isShortcutsActive={isShortcutsActive}
        handleShortcutsToggle={handleShortcutsToggle}
        alwaysOnTop={alwaysOnTop}
        handleAlwaysOnTopToggle={handleAlwaysOnTopToggle}
        handleTerminate={handleTerminate}
        toggleRemoteMode={toggleRemoteMode}
      />
    );
  }

  return (
    <div className="app-wrapper">
      {/* リプレイ初期化中のローディング表示 */}
      {isReplayInitializing && (
        <div className="replay-loading-overlay">
          <div className="replay-loading-card">
            <div className="replay-loading-spinner-container">
              <div className="loading-ring ring-outer"></div>
              <div className="loading-ring ring-inner"></div>
              <div className="loading-icon-center">
                <span className="material-symbols-outlined animated-pulse">
                  {restoringSession ? "sync_saved_locally" : "sync"}
                </span>
              </div>
            </div>
            <h3 className="replay-loading-title">
              {restoringSession ? "Resuming Session" : "Initializing Replay"}
            </h3>
            <p className="replay-loading-text">
              {restoringSession ? (
                <>
                  セッション「{restoringSession.name}」を復元しています...
                  <br />
                  チャート状態とポジション・履歴情報を同期しています。
                </>
              ) : (
                <>
                  MT5 Replay環境を初期化しています...
                  <br />
                  カスタムシンボルの構築および検証用チャートの起動を行っています。これには数十秒かかる場合があります。
                </>
              )}
            </p>
            <div className="replay-loading-progress-container">
              <div className="replay-loading-progress-bar"></div>
            </div>
            <button className="pro-btn danger loading-cancel-btn" onClick={handleCancelInit}>
              <span className="material-symbols-outlined text-[14px]">close</span>
              キャンセル
            </button>
          </div>
        </div>
      )}

      {/* Top Header */}
      <AppHeader
        status={status}
        virtualTimeMsc={virtualTimeMsc}
        timezoneMode={timezoneMode}
        setTimezoneMode={setTimezoneMode}
        currentSession={currentSession}
        subFeedRate={subFeedRate}
        mainFeedRate={mainFeedRate}
        sourceSymbol={sourceSymbol}
        alwaysOnTop={alwaysOnTop}
        isShortcutsActive={isShortcutsActive}
        handleAlwaysOnTopToggle={handleAlwaysOnTopToggle}
        handleShortcutsToggle={handleShortcutsToggle}
        toggleRemoteMode={toggleRemoteMode}
        handleTerminate={handleTerminate}
        setIsSettingsOpen={setIsSettingsOpen}
        setIsSaveSessionOpen={setIsSaveSessionOpen}
        setSaveSessionName={setSaveSessionName}
        setSaveAsNewSnapshot={setSaveAsNewSnapshot}
        setSessionSaveType={setSessionSaveType}
        currentSessionId={currentSessionId}
        currentSessionName={currentSessionName}
        getDayOfWeekStr={getDayOfWeekStr}
      />

      {/* Main Workspace Area */}
      <main className="main-workspace" style={{ position: "relative" }}>
        {errorMessage && (
          <div
            className="error-banner"
            style={{
              position: "absolute",
              top: "10px",
              left: 0,
              right: 0,
              marginLeft: "auto",
              marginRight: "auto",
              zIndex: 1000,
              width: "calc(100% - 20px)",
              maxWidth: "400px",
              boxShadow: "0 8px 24px rgba(0, 0, 0, 0.6)",
              backgroundColor: "rgba(30, 10, 10, 0.95)",
              border: "1px solid var(--status-danger)",
              margin: "0 auto",
            }}
          >
            <span className="material-symbols-outlined">error</span>
            <span style={{ flex: 1, fontSize: "11px" }}>{errorMessage}</span>
            <button
              className="error-banner-close-btn"
              onClick={() => setErrorMessage("")}
              title="閉じる"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        )}

        <SetupPanel
          status={status}
          setupTab={setupTab}
          setSetupTab={setSetupTab}
          terminals={terminals}
          selectedTerminal={selectedTerminal}
          setSelectedTerminal={setSelectedTerminal}
          handleOpenTerminalNameModal={handleOpenTerminalNameModal}
          profiles={profiles}
          selectedProfile={selectedProfile}
          setSelectedProfile={setSelectedProfile}
          maxBarsInfo={maxBarsInfo}
          enableDualFeed={enableDualFeed}
          setEnableDualFeed={setEnableDualFeed}
          setIsBatchSelectorOpen={setIsBatchSelectorOpen}
          handleOpenSymbolSelector={handleOpenSymbolSelector}
          sourceSymbol={sourceSymbol}
          setSourceSymbol={setSourceSymbol}
          subSourceSymbol={subSourceSymbol}
          setSubSourceSymbol={setSubSourceSymbol}
          availableSymbols={availableSymbols}
          additionalSymbols={additionalSymbols}
          setAdditionalSymbols={setAdditionalSymbols}
          companionSymbols={companionSymbols}
          setIsCustomImportOpen={setIsCustomImportOpen}
          startTime={startTime}
          setStartTime={setStartTime}
          endTime={endTime}
          setEndTime={setEndTime}
          timezoneMode={timezoneMode}
          setActivePickerField={setActivePickerField}
          preloadMode={preloadMode}
          setPreloadMode={setPreloadMode}
          preloadTimeframe={preloadTimeframe}
          setPreloadTimeframe={setPreloadTimeframe}
          preloadedBars={preloadedBars}
          setPreloadedBars={setPreloadedBars}
          preloadDate={preloadDate}
          autoScrollSync={autoScrollSync}
          setAutoScrollSync={setAutoScrollSync}
          autoSkipWeekend={autoSkipWeekend}
          setAutoSkipWeekend={setAutoSkipWeekend}
          initialBalance={initialBalance}
          setInitialBalance={setInitialBalance}
          leverage={leverage}
          setLeverage={setLeverage}
          contractSize={contractSize}
          setContractSize={setContractSize}
          enablePseudoRate={enablePseudoRate}
          setEnablePseudoRate={setEnablePseudoRate}
          pseudoBaseSpread={pseudoBaseSpread}
          setPseudoBaseSpread={setPseudoBaseSpread}
          pseudoThreshold={pseudoThreshold}
          setPseudoThreshold={setPseudoThreshold}
          pseudoSensitivity={pseudoSensitivity}
          setPseudoSensitivity={setPseudoSensitivity}
          pseudoMode={pseudoMode}
          setPseudoMode={setPseudoMode}
          pseudoRolloverEnabled={pseudoRolloverEnabled}
          setPseudoRolloverEnabled={setPseudoRolloverEnabled}
          pseudoRolloverSpread={pseudoRolloverSpread}
          setPseudoRolloverSpread={setPseudoRolloverSpread}
          pseudoRolloverRecoveryMin={pseudoRolloverRecoveryMin}
          setPseudoRolloverRecoveryMin={setPseudoRolloverRecoveryMin}
          savedSessions={savedSessions}
          expandedGroups={expandedGroups}
          setExpandedGroups={setExpandedGroups}
          handleClearAllSessions={handleClearAllSessions}
          handleDeleteSessions={handleDeleteSessions}
          handleResumeSession={handleResumeSession}
          loadSavedSessions={loadSavedSessions}
          handleResetReplaySettings={handleResetReplaySettings}
          handleResetTradingSettings={handleResetTradingSettings}
          handleCheckConnection={handleCheckConnection}
          handleInit={handleInit}
        />
      </main>

      {/* Modals & Dialogs */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        recordingAction={recordingAction}
        setRecordingAction={setRecordingAction}
        hotkeys={hotkeys}
        handleResetAllHotkeys={handleResetAllHotkeys}
        handleClearHotkey={handleClearHotkey}
        autoScrollSync={autoScrollSync}
        setAutoScrollSync={setAutoScrollSync}
        autoSkipWeekend={autoSkipWeekend}
        handleAutoSkipWeekendToggle={handleAutoSkipWeekendToggle}
        alwaysOnTop={alwaysOnTop}
        handleAlwaysOnTopToggle={handleAlwaysOnTopToggle}
        isShortcutsActive={isShortcutsActive}
        handleShortcutsToggle={handleShortcutsToggle}
        plColorStyle={plColorStyle}
        setPlColorStyle={setPlColorStyle}
        saveAllSettings={saveAllSettings}
        economicDataDir={economicDataDir}
        setEconomicDataDir={saveEconomicDataDir}
        timelineActivityMaxCap={timelineActivityMaxCap}
        setTimelineActivityMaxCap={(val) => {
          setTimelineActivityMaxCap(val);
          saveAllSettings({ timeline_activity_max_cap: val });
        }}
        timelineActivityMinFloor={timelineActivityMinFloor}
        setTimelineActivityMinFloor={(val) => {
          setTimelineActivityMinFloor(val);
          saveAllSettings({ timeline_activity_min_floor: val });
        }}
        autoSkipThreshold={autoSkipThreshold}
        setAutoSkipThreshold={(val) => {
          setAutoSkipThreshold(val);
          saveAllSettings({ auto_skip_threshold: val });
        }}
      />

      {/* Custom Symbol Import Modal */}
      <CustomSymbolImportModal
        isOpen={isCustomImportOpen}
        onClose={() => setIsCustomImportOpen(false)}
        terminalPath={selectedTerminal}
        terminalName={(() => {
          const t = terminals.find((t) => t.path === selectedTerminal);
          return t ? t.custom_name || t.name : undefined;
        })()}
        onImportComplete={() => loadAvailableSymbols(selectedTerminal)}
        onApplyToReplay={(primary, syncs, range) => {
          setSourceSymbol(primary);
          setAdditionalSymbols(syncs.join(","));
          if (range) {
            setStartTime(range.start);
            setEndTime(range.end);
          }
          loadAvailableSymbols(selectedTerminal);
        }}
      />

      {/* Batch Symbol Selector Modal */}
      <SymbolBatchSelectorModal
        isOpen={isBatchSelectorOpen}
        onClose={() => setIsBatchSelectorOpen(false)}
        availableSymbols={availableSymbols}
        currentSourceSymbol={sourceSymbol}
        currentSubSourceSymbol={subSourceSymbol}
        currentEnableDualFeed={enableDualFeed}
        currentAdditionalSymbols={additionalSymbols}
        currentStartTime={startTime}
        currentEndTime={endTime}
        onApply={(src, sub, isDual, syncs, range) => {
          setSourceSymbol(src);
          setSubSourceSymbol(sub);
          setEnableDualFeed(isDual);
          setAdditionalSymbols(syncs.join(","));
          if (range) {
            setStartTime(range.start);
            setEndTime(range.end);
          }
        }}
      />

      {/* Terminal Name Modal */}
      <TerminalNameModal
        isOpen={isTerminalNameModalOpen}
        terminal={editingTerminal}
        onSave={handleSaveTerminalName}
        onReset={handleResetTerminalName}
        onClose={() => {
          setIsTerminalNameModalOpen(false);
          setEditingTerminal(null);
        }}
      />

      {/* DateTime Picker Modal */}
      {activePickerField && (
        <DateTimePickerModal
          fieldLabel={
            activePickerField === "preload"
              ? `過去プリロード開始日 (${timezoneMode})`
              : activePickerField === "start"
              ? `開始日時 (${timezoneMode})`
              : `終了日時 (${timezoneMode})`
          }
          value={
            activePickerField === "preload"
              ? timezoneMode === "JST"
                ? preloadDate
                : getNewsTimeForDisplay(preloadDate, "SERVER")
              : activePickerField === "start"
              ? timezoneMode === "JST"
                ? startTime
                : getNewsTimeForDisplay(startTime, "SERVER")
              : timezoneMode === "JST"
              ? endTime
              : getNewsTimeForDisplay(endTime, "SERVER")
          }
          onChange={(newVal) => {
            const finalVal = timezoneMode === "JST" ? newVal : convertServerToJstStr(newVal);
            if (activePickerField === "preload") setPreloadDate(finalVal);
            else if (activePickerField === "start") setStartTime(finalVal);
            else setEndTime(finalVal);
          }}
          onClose={() => setActivePickerField(null)}
          availableYears={availableYears}
        />
      )}

      {/* Delete Session Modal */}
      <DeleteSessionModal
        isOpen={isDeleteSessionConfirmOpen}
        message={deleteConfirmMessage}
        onConfirm={executeDeleteSession}
        onClose={() => setIsDeleteSessionConfirmOpen(false)}
      />

      {/* Economic Data Missing Confirmation Modal */}
      <EconomicDataMissingModal
        isOpen={isEconomicWarningOpen}
        onClose={() => setIsEconomicWarningOpen(false)}
        onProceed={handleProceedWithMissingEconomicData}
        symbol={sourceSymbol}
        missingMonths={economicMissingMonths}
        availableMonths={economicAvailableMonths}
        startTime={startTime}
        endTime={endTime}
        currentEconomicDir={economicDataDir}
        onFolderSelected={handleEconomicFolderSelected}
      />

      {/* Clear All Sessions Modal */}
      <ClearAllSessionsConfirmModal
        isOpen={isClearAllSessionsConfirmOpen}
        onConfirm={executeClearAllSessions}
        onClose={() => setIsClearAllSessionsConfirmOpen(false)}
      />

      {/* Reset Replay Modal */}
      <ResetReplayConfirmModal
        isOpen={isResetReplayConfirmOpen}
        onConfirm={() => {
          executeResetReplaySettings();
          setIsResetReplayConfirmOpen(false);
        }}
        onClose={() => setIsResetReplayConfirmOpen(false)}
      />

      {/* Reset Trading Modal */}
      <ResetTradingConfirmModal
        isOpen={isResetTradingConfirmOpen}
        onConfirm={() => {
          executeResetTradingSettings();
          setIsResetTradingConfirmOpen(false);
        }}
        onClose={() => setIsResetTradingConfirmOpen(false)}
      />

      {/* Max Bars Warning Modal */}
      <MaxBarsWarningModal
        isOpen={isMaxBarsWarningOpen}
        maxBarsInfo={maxBarsInfo}
        onProceed={() => {
          setIsMaxBarsWarningOpen(false);
          executeInitReplay();
        }}
        onClose={() => setIsMaxBarsWarningOpen(false)}
      />

      {/* Save Session Modal */}
      <SaveSessionModal
        isOpen={isSaveSessionOpen}
        sessionSaveType={sessionSaveType}
        currentSessionId={currentSessionId}
        currentSessionName={currentSessionName}
        saveSessionName={saveSessionName}
        setSaveSessionName={setSaveSessionName}
        saveAsNewSnapshot={saveAsNewSnapshot}
        setSaveAsNewSnapshot={setSaveAsNewSnapshot}
        onSave={async () => {
          await executeSaveSession();
          setIsSaveSessionOpen(false);
          if (sessionSaveType === "terminate") {
            await executeTerminate();
          }
        }}
        onTerminateWithoutSaving={async () => {
          setIsSaveSessionOpen(false);
          await executeTerminate();
        }}
        onClose={() => setIsSaveSessionOpen(false)}
      />

      {/* Time Steps Modal */}
      <TimeStepsModal
        isOpen={isTimeStepsModalOpen}
        timeSteps={timeSteps}
        onApply={(updated) => setTimeSteps(updated)}
        onClose={() => setIsTimeStepsModalOpen(false)}
      />

      {/* Speed Presets Modal */}
      <SpeedPresetsModal
        isOpen={isSpeedPresetsModalOpen}
        timePresets={timePresets}
        tickPresets={tickPresets}
        onSave={async (times, ticks) => {
          setTimePresets(times);
          setTickPresets(ticks);
          await saveAllSettings({
            time_presets: times,
            tick_presets: ticks,
          });
        }}
        onClose={() => setIsSpeedPresetsModalOpen(false)}
      />
    </div>
  );
}

export default WindowRouter;
