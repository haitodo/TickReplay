import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import "./App.css";
import { CustomSelect } from "./CustomSelect";
import { TradeAnalysisWindowContent } from "./TradeAnalysisWindow";
import { SymbolCombobox, SymbolItem } from "./components/SymbolCombobox";
import { SymbolTagInput } from "./components/SymbolTagInput";
import { CustomSymbolImportModal } from "./components/CustomSymbolImportModal";
import { AIAnalysisPanel } from "./components/AIAnalysisPanel";
import { DateTimePickerModal } from "./components/DateTimePickerModal";
import { TradeReportDashboard } from "./components/TradeReportDashboard";
import { SpeedOrderWindowContent } from "./components/SpeedOrderWindowContent";
import { DeleteSessionModal } from "./components/DeleteSessionModal";
import { useVolatilityDetector } from "./hooks/useVolatilityDetector";
import { useTheme } from "./hooks/useTheme";
import {
  getServerToJstOffsetHours,
  parseTimeStrToUtcMs,
  formatJstTime,
  formatServerTime,
  convertServerStrToJstStr as convertServerToJstStr,
  convertJstStrToServerStr,
  getNewsTimeForDisplay
} from "./utils/timeUtils";
import {
  testOpenRouterKey,
  testFredKey,
  testFinnhubKey,
  testGdeltApi,
  ApiTestResult
} from "./utils/apiKeyTester";
import {
  DEFAULT_HOTKEYS,
  HOTKEY_METADATA,
  getTauriShortcutFromEvent,
  formatShortcutForDisplay,
  matchesHotkey,
  MaxBarsInfo
} from "./utils/hotkeyUtils";
import { THEME_PRESETS } from "./constants/themePresets";
import {
  DEFAULT_NEWS_FILTERS,
  TerminalInfo,
  ReplayNewsItem,
  NewsFilters
} from "./constants/newsFilters";
import { translateErrorMessage } from "./utils/i18nUtils";
import { organizeSessions } from "./domain/sessionBoundaries";
import { isEventFiltered as checkEventFiltered } from "./domain/newsFilterLogic";



export interface TimeStepItem {
  id: string;
  seconds: number;
  label: string;
}

const DEFAULT_TIME_STEPS: TimeStepItem[] = [
  { id: "ts-1", seconds: 10, label: "10S" },
  { id: "ts-2", seconds: 60, label: "1M" },
  { id: "ts-3", seconds: 600, label: "10M" },
  { id: "ts-4", seconds: 3600, label: "1H" },
];

const PRESET_TIME_OPTIONS: { seconds: number; label: string }[] = [
  { seconds: 5, label: "5S" },
  { seconds: 10, label: "10S" },
  { seconds: 30, label: "30S" },
  { seconds: 60, label: "1M" },
  { seconds: 300, label: "5M" },
  { seconds: 600, label: "10M" },
  { seconds: 900, label: "15M" },
  { seconds: 1800, label: "30M" },
  { seconds: 3600, label: "1H" },
  { seconds: 14400, label: "4H" },
];

const formatSecondsToLabel = (sec: number): string => {
  if (sec < 60) return `${sec}S`;
  if (sec < 3600 && sec % 60 === 0) return `${sec / 60}M`;
  if (sec % 3600 === 0) return `${sec / 3600}H`;
  if (sec >= 3600) return `${(sec / 3600).toFixed(1)}H`;
  return `${(sec / 60).toFixed(1)}M`;
};

function App() {
  // Check URL routing for child windows
  const urlParams = new URLSearchParams(window.location.search);
  const windowParam = urlParams.get("window");
  if (windowParam === "speed_order") {
    return <SpeedOrderWindowContent />;
  }
  if (windowParam === "trade_analysis") {
    return <TradeAnalysisWindowContent />;
  }

  // --- 接続状態・EAからのステータス
  const [status, setStatus] = useState<"DISCONNECTED" | "CONNECTED" | "READY" | "ACTIVE">("DISCONNECTED");
  const [totalTicks, setTotalTicks] = useState(0);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [virtualTimeMsc, setVirtualTimeMsc] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedMode, setSpeedMode] = useState<"TEMPORAL" | "COUNT">("TEMPORAL");
  const [multiplier, setMultiplier] = useState(1.0);
  const [tickStep, setTickStep] = useState(1);
  const [loopActive, setLoopActive] = useState(false);
  const [loopA, setLoopA] = useState(-1);
  const [loopB, setLoopB] = useState(-1);
  const [loopAIdx, setLoopAIdx] = useState(-1);
  const [loopBIdx, setLoopBIdx] = useState(-1);
  const [sessionBoundaries, setSessionBoundaries] = useState<any>({ TYO: [], LDN: [], NY: [] });

  // --- ローディング状態 (リプレイ初期化中)
  const [isReplayInitializing, setIsReplayInitializingState] = useState(false);
  const isReplayInitializingRef = useRef(false);
  const initTimeoutRef = useRef<any>(null);
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
  const [restoringSession, setRestoringSession] = useState<any>(null);
  const restoringSessionRef = useRef<any>(null);
  const isRestoringRef = useRef(false);
  const updateRestoringSession = (session: any) => {
    restoringSessionRef.current = session;
    setRestoringSession(session);
  };
  const [savedSessions, setSavedSessions] = useState<any[]>([]);
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
  const [expandedGroups, setExpandedGroups] = useState<{ [key: string]: boolean }>({});

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

  const [enablePseudoRate, setEnablePseudoRate] = useState(true);
  const [pseudoBaseSpread, setPseudoBaseSpread] = useState(0.002);
  const [pseudoThreshold, setPseudoThreshold] = useState(0.0110);
  const [pseudoSensitivity, setPseudoSensitivity] = useState(1.025);
  const isInitialLoadRef = useRef(true);
  const [isInitialized, setIsInitialized] = useState(false);

  // --- 仮想取引関連のステータス
  const [currentViewMode, setCurrentViewMode] = useState<"replay" | "trade">("replay");
  const [account, setAccount] = useState<any>(null);
  const [positions, setPositions] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);

  // --- 自動スキャン・設定用状態
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [selectedTerminal, setSelectedTerminal] = useState("");
  const [profiles, setProfiles] = useState<string[]>([]);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [maxBarsInfo, setMaxBarsInfo] = useState<MaxBarsInfo | null>(null);
  const [isMaxBarsWarningOpen, setIsMaxBarsWarningOpen] = useState(false);
  const [sourceSymbol, setSourceSymbol] = useState("USDJPY");
  const [chartSymbol, setChartSymbol] = useState("");
  const hasSavedSymbolRef = useRef(false);
  const [additionalSymbols, setAdditionalSymbols] = useState("");
  const [isCustomImportOpen, setIsCustomImportOpen] = useState(false);
  const [availableSymbols, setAvailableSymbols] = useState<SymbolItem[]>([]);

  const loadAvailableSymbols = async (terminalPath: string) => {
    try {
      const list = await invoke<SymbolItem[]>("get_available_symbols", { terminalPath });
      setAvailableSymbols(list);
    } catch (err) {
      console.error("Failed to load available symbols:", err);
    }
  };

  useEffect(() => {
    loadAvailableSymbols(selectedTerminal);
  }, [selectedTerminal]);

  const [startTime, setStartTime] = useState("2026-05-01 00:00:00");
  const [endTime, setEndTime] = useState("2026-05-02 00:00:00");

  const [preloadedBars, setPreloadedBars] = useState(300);
  const [limitTickHistory, setLimitTickHistory] = useState(true);
  const [tickHistoryTimeframe, setTickHistoryTimeframe] = useState("M5");
  const [maxHistoryBars, setMaxHistoryBars] = useState(300);
  const [autoScrollSync, setAutoScrollSync] = useState(true);
  const [newsAutoScroll, setNewsAutoScroll] = useState(true);
  const [autoSkipWeekend, setAutoSkipWeekend] = useState(true);
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

    const isJpy = sourceSymbol.toUpperCase().includes("JPY");
    const baseSpread = isJpy ? 0.002 : 0.00002;
    const threshold = isJpy ? 0.0110 : 0.000110;

    setPseudoBaseSpread(baseSpread);
    setPseudoThreshold(threshold);
    setPseudoSensitivity(1.025);
  }, [sourceSymbol, isInitialized]);

  // --- UIオプション設定
  const [isRemoteMode, setIsRemoteMode] = useState(false);
  const [isShortcutsActive, setIsShortcutsActive] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
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

  const [errorMessage, setErrorMessage] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isResetReplayConfirmOpen, setIsResetReplayConfirmOpen] = useState(false);
  const [isResetTradingConfirmOpen, setIsResetTradingConfirmOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"general" | "hotkeys" | "news" | "theme" | "ai">("general");

  // タイムステップカスタマイズ State
  const [timeSteps, setTimeSteps] = useState<TimeStepItem[]>(() => {
    const saved = localStorage.getItem("custom-time-steps");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return (parsed as TimeStepItem[]).slice(0, 5).sort((a, b) => a.seconds - b.seconds);
        }
      } catch (e) {
        console.error("Failed to parse custom-time-steps", e);
      }
    }
    return [...DEFAULT_TIME_STEPS].sort((a, b) => a.seconds - b.seconds);
  });

  const [isTimeStepsModalOpen, setIsTimeStepsModalOpen] = useState<boolean>(false);
  const [editingTimeSteps, setEditingTimeSteps] = useState<TimeStepItem[]>(timeSteps);

  // Transport 速度プリセット設定モーダル用 State
  const [isSpeedPresetsModalOpen, setIsSpeedPresetsModalOpen] = useState<boolean>(false);
  const [editingTimePresets, setEditingTimePresets] = useState<number[]>([]);
  const [editingTickPresets, setEditingTickPresets] = useState<number[]>([]);
  const [modalNewTimePreset, setModalNewTimePreset] = useState<string>("");
  const [modalNewTickPreset, setModalNewTickPreset] = useState<string>("");

  useEffect(() => {
    localStorage.setItem("custom-time-steps", JSON.stringify(timeSteps));
  }, [timeSteps]);
  
  // AI急変動・トレンド解析用 State
  const [openRouterApiKey, setOpenRouterApiKey] = useState<string>(() => localStorage.getItem("openrouter-api-key") || "");
  const [openRouterModel, setOpenRouterModel] = useState<string>(() => localStorage.getItem("openrouter-model") || "google/gemini-2.5-flash");
  const [fredApiKey, setFredApiKey] = useState<string>(() => localStorage.getItem("fred-api-key") || "");
  const [finnhubApiKey, setFinnhubApiKey] = useState<string>(() => localStorage.getItem("finnhub-api-key") || "");
  const [volatilityThresholdPips, setVolatilityThresholdPips] = useState<number>(() => parseInt(localStorage.getItem("volatility-threshold-pips") || "20"));
  const [volatilityEnabled, setVolatilityEnabled] = useState<boolean>(() => localStorage.getItem("volatility-enabled") !== "false");
  const [isAIPanelOpen, setIsAIPanelOpen] = useState<boolean>(false);
  const [aiTargetTimeMsc, setAiTargetTimeMsc] = useState<number>(0);
  const [currentPrice, setCurrentPrice] = useState<number>(0);

  // AI設定のlocalStorage保存同期
  useEffect(() => {
    localStorage.setItem("openrouter-api-key", openRouterApiKey);
    localStorage.setItem("openrouter-model", openRouterModel);
    localStorage.setItem("fred-api-key", fredApiKey);
    localStorage.setItem("finnhub-api-key", finnhubApiKey);
    localStorage.setItem("volatility-threshold-pips", String(volatilityThresholdPips));
    localStorage.setItem("volatility-enabled", String(volatilityEnabled));
  }, [openRouterApiKey, openRouterModel, fredApiKey, finnhubApiKey, volatilityThresholdPips, volatilityEnabled]);

  // API Key 接続テスト用 State
  const [openRouterTestResult, setOpenRouterTestResult] = useState<ApiTestResult>({ success: false, status: "idle", message: "" });
  const [fredTestResult, setFredTestResult] = useState<ApiTestResult>({ success: false, status: "idle", message: "" });
  const [finnhubTestResult, setFinnhubTestResult] = useState<ApiTestResult>({ success: false, status: "idle", message: "" });
  const [gdeltTestResult, setGdeltTestResult] = useState<ApiTestResult>({ success: false, status: "idle", message: "" });
  const [isTestingAllApis, setIsTestingAllApis] = useState<boolean>(false);

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
      testGdeltApi()
    ]);

    setOpenRouterTestResult(openRouterRes);
    setFredTestResult(fredRes);
    setFinnhubTestResult(finnhubRes);
    setGdeltTestResult(gdeltRes);
    setIsTestingAllApis(false);
  };


  // ボラティリティ急変動の自動検知フック
  const { spikeInfo, clearSpike } = useVolatilityDetector(
    virtualTimeMsc,
    currentPrice,
    sourceSymbol,
    {
      thresholdPips: volatilityThresholdPips,
      enabled: volatilityEnabled
    }
  );
  const {
    themeId, setThemeId,
    glassEffect, setGlassEffect,
    themeMode, setThemeMode,
    plColorStyle, setPlColorStyle,
    orderColorStyle, setOrderColorStyle
  } = useTheme();
  const [recordingAction, setRecordingAction] = useState<string | null>(null);
  const [hotkeys, setHotkeys] = useState<Record<string, string>>(DEFAULT_HOTKEYS);
  const [timePresets, setTimePresets] = useState<number[]>([0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0]);
  const [tickPresets, setTickPresets] = useState<number[]>([1, 2, 5, 10, 30, 60]);

  const [timezoneMode, setTimezoneMode] = useState<"JST" | "SERVER">("JST");
  
  const [hedging, setHedging] = useState<boolean>(() => {
    const saved = localStorage.getItem("speed-order-hedging");
    return saved === "true";
  });
  const [showHoldingTime, setShowHoldingTime] = useState<boolean>(() => {
    const saved = localStorage.getItem("speed-order-show-holding-time");
    return saved !== "false";
  });
  const [holdingTimeMode, setHoldingTimeMode] = useState<"pc" | "server">(
    () => (localStorage.getItem("speed-order-holding-time-mode") as "pc" | "server") || "pc"
  );

  // 経済指標用状態
  const [newsFilters, setNewsFilters] = useState<NewsFilters>(DEFAULT_NEWS_FILTERS);
  const [newsItems, setNewsItems] = useState<ReplayNewsItem[]>([]);
  const hasLoadedNewsRef = useRef(false);

  const throttledSeekRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const savedConfig = useRef<any>(null); // 保存された設定キャッシュ用のRef
  const newsContainerRef = useRef<HTMLDivElement>(null);
  const lastScrolledEventKeyRef = useRef<string>("");

  const handlersRef = useRef<any>(null);

  const handleStatusString = (payload: string) => {
    try {
      const data = JSON.parse(payload);
      if (data.status === "READY") {
        const isReconnecting = status === "DISCONNECTED" || status === "CONNECTED";
        setStatus((prev) => prev !== "READY" ? "READY" : prev);
        setTotalTicks((prev) => prev !== data.total_ticks ? data.total_ticks : prev);
        setCurrentIdx((prev) => prev !== data.current_idx ? data.current_idx : prev);
        setVirtualTimeMsc((prev) => prev !== data.virtual_time_msc ? data.virtual_time_msc : prev);
        setLoopActive((prev) => prev !== false ? false : prev);
        setLoopA((prev) => prev !== -1 ? -1 : prev);
        setLoopB((prev) => prev !== -1 ? -1 : prev);
        setLoopAIdx((prev) => prev !== -1 ? -1 : prev);
        setLoopBIdx((prev) => prev !== -1 ? -1 : prev);
        if (data.session_boundaries) {
          setSessionBoundaries((prev: any) => {
            if (JSON.stringify(prev) === JSON.stringify(data.session_boundaries)) return prev;
            return data.session_boundaries;
          });
        }
        if (isReconnecting) {
          if (data.speed_mode) setSpeedMode((prev) => prev !== data.speed_mode ? (data.speed_mode as "TEMPORAL" | "COUNT") : prev);
          if (data.multiplier !== undefined) {
            const m = typeof data.multiplier === "number" ? data.multiplier : parseFloat(data.multiplier) || 1.0;
            setMultiplier((prev) => prev !== m ? m : prev);
          }
          if (data.tick_step !== undefined) setTickStep((prev) => prev !== data.tick_step ? data.tick_step : prev);
        }
        setErrorMessage((prev) => prev !== "" ? "" : prev);
        hasLoadedNewsRef.current = false;
        loadReplayNews();
        if (data.account) {
          setAccount((prev: any) => {
            if (JSON.stringify(prev) === JSON.stringify(data.account)) return prev;
            return data.account;
          });
        }
        if (data.positions) {
          setPositions((prev: any[]) => {
            if (JSON.stringify(prev) === JSON.stringify(data.positions)) return prev;
            return data.positions;
          });
        }
        if (data.history) {
          setHistory((prev: any[]) => {
            if (JSON.stringify(prev) === JSON.stringify(data.history)) return prev;
            return data.history;
          });
        }
        if (restoringSessionRef.current) {
          const session = restoringSessionRef.current;
          restoringSessionRef.current = null;
          isRestoringRef.current = true;

          // Restore position & history real times to localStorage
          try {
            const restoredTimes: Record<number, number> = {};
            if (session.virtual_trade) {
              const vt = session.virtual_trade;
              if (vt.positions) {
                vt.positions.forEach((p: any) => {
                  if (p.accumulated_real_time !== undefined) {
                    restoredTimes[p.ticket] = p.accumulated_real_time;
                  }
                });
              }
              if (vt.history) {
                vt.history.forEach((h: any) => {
                  if (h.accumulated_real_time !== undefined) {
                    restoredTimes[h.ticket] = h.accumulated_real_time;
                  }
                });
              }
            }
            localStorage.setItem("speed-order-position-real-times", JSON.stringify(restoredTimes));
            window.dispatchEvent(new StorageEvent("storage", {
              key: "speed-order-position-real-times",
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
          sendCommand({
            command: "ACCOUNT_RESET",
            initial_balance: initialBalanceRef.current,
            leverage: leverageRef.current
          }).catch(console.error);
        }
      } else if (data.status === "CONNECTED") {
        setStatus((prev) => prev !== "CONNECTED" ? "CONNECTED" : prev);
        if (data.symbol) {
          setChartSymbol((prev) => prev !== data.symbol ? data.symbol : prev);
          if (!hasSavedSymbolRef.current) {
            setSourceSymbol((prev) => prev !== data.symbol ? data.symbol : prev);
          }
        }
      } else if (data.status === "ACTIVE") {
        const isReconnecting = status === "DISCONNECTED" || status === "CONNECTED";
        setStatus((prev) => prev !== "ACTIVE" ? "ACTIVE" : prev);
        // ドラッグ中でなければ現在インデックスを更新する
        if (!isDraggingRef.current) {
          setCurrentIdx((prev) => prev !== data.current_idx ? data.current_idx : prev);
        }
        setTotalTicks((prev) => prev !== data.total_ticks ? data.total_ticks : prev);
        setVirtualTimeMsc((prev) => prev !== data.virtual_time_msc ? data.virtual_time_msc : prev);
        setIsPlaying((prev) => prev !== data.is_playing ? data.is_playing : prev);
        if (data.session_boundaries) {
          setSessionBoundaries((prev: any) => {
            if (JSON.stringify(prev) === JSON.stringify(data.session_boundaries)) return prev;
            return data.session_boundaries;
          });
        }
        if (data.bid) setCurrentPrice(data.bid);
        else if (data.account?.bid) setCurrentPrice(data.account.bid);
        if (isReconnecting) {
          if (data.speed_mode) setSpeedMode((prev) => prev !== data.speed_mode ? (data.speed_mode as "TEMPORAL" | "COUNT") : prev);
          if (data.multiplier !== undefined) {
            const m = typeof data.multiplier === "number" ? data.multiplier : parseFloat(data.multiplier) || 1.0;
            setMultiplier((prev) => prev !== m ? m : prev);
          }
          if (data.tick_step !== undefined) setTickStep((prev) => prev !== data.tick_step ? data.tick_step : prev);
        }
        if (data.loop) {
          setLoopActive((prev) => prev !== data.loop.active ? data.loop.active : prev);
          setLoopA((prev) => prev !== data.loop.a_msc ? data.loop.a_msc : prev);
          setLoopB((prev) => prev !== data.loop.b_msc ? data.loop.b_msc : prev);
          setLoopAIdx((prev) => prev !== (data.loop.a_idx !== undefined ? data.loop.a_idx : -1) ? (data.loop.a_idx !== undefined ? data.loop.a_idx : -1) : prev);
          setLoopBIdx((prev) => prev !== (data.loop.b_idx !== undefined ? data.loop.b_idx : -1) ? (data.loop.b_idx !== undefined ? data.loop.b_idx : -1) : prev);
        }
        if (!hasLoadedNewsRef.current) {
          loadReplayNews();
        }
        if (data.account) {
          setAccount((prev: any) => {
            if (JSON.stringify(prev) === JSON.stringify(data.account)) return prev;
            return data.account;
          });
        }
        if (data.positions) {
          setPositions((prev: any[]) => {
            if (JSON.stringify(prev) === JSON.stringify(data.positions)) return prev;
            return data.positions;
          });
        }
        if (data.history) {
          setHistory((prev: any[]) => {
            if (JSON.stringify(prev) === JSON.stringify(data.history)) return prev;
            return data.history;
          });
        }
      } else if (data.status === "ERROR") {
        const lowerMsg = (data.message || "").toLowerCase();
        const isOrderError =
          lowerMsg.includes("margin is insufficient") ||
          lowerMsg.includes("bid/ask prices") ||
          lowerMsg.includes("replay is not initialized");

        if (!isOrderError) {
          setErrorMessage(translateErrorMessage(data.message));
          setIsReplayInitializing(false);
        }
      } else if (data.status === "DISCONNECTED") {
        setStatus((prev) => prev !== "DISCONNECTED" ? "DISCONNECTED" : prev);
        setIsPlaying((prev) => prev !== false ? false : prev);
        setLoopActive((prev) => prev !== false ? false : prev);
        setLoopA((prev) => prev !== -1 ? -1 : prev);
        setLoopB((prev) => prev !== -1 ? -1 : prev);
        setLoopAIdx((prev) => prev !== -1 ? -1 : prev);
        setLoopBIdx((prev) => prev !== -1 ? -1 : prev);
        hasLoadedNewsRef.current = false;
        setNewsItems((prev) => prev.length > 0 ? [] : prev);
        setAccount((prev: any) => prev !== null ? null : prev);
        setPositions((prev) => prev.length > 0 ? [] : prev);
        setHistory((prev) => prev.length > 0 ? [] : prev);

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

  const scheduleStatusUpdate = useCallback((payload: string) => {
    if (pendingStatusPayloadRef.current !== null) {
      skippedCountRef.current++;
    }
    pendingStatusPayloadRef.current = payload;

    try {
      const data = JSON.parse(payload);
      if (data.session_boundaries) {
        setSessionBoundaries((prev: any) => {
          if (JSON.stringify(prev) === JSON.stringify(data.session_boundaries)) return prev;
          return data.session_boundaries;
        });
      }
    } catch (_) {}

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

  const handleCheckConnection = async () => {
    setErrorMessage("");
    try {
      const lastStatus = await invoke<string>("get_last_status");
      if (lastStatus && lastStatus.trim() !== "") {
        handleStatusStringRef.current(lastStatus);
      } else {
        setErrorMessage("EAが接続されていません。MT5チャート上の「Start Replay Sync」ボタンがON（緑色）になっていることを確認してください。");
      }
    } catch (e) {
      console.error(e);
      setErrorMessage("接続確認エラー: " + e);
    }
  };

  // --- テーマモード（ダーク／ライト）適用エフェクト
  useEffect(() => {
    if (themeMode === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.setAttribute("data-theme", "dark");
    }
    localStorage.setItem("theme-mode", themeMode);
  }, [themeMode]);

  

  // --- 両建て設定適用エフェクト
  useEffect(() => {
    localStorage.setItem("speed-order-hedging", String(hedging));
  }, [hedging]);

  // --- 疑似レート設定をEAに同期するエフェクト
  useEffect(() => {
    if (status === "ACTIVE" || status === "READY") {
      sendCommand({
        command: "SET_PSEUDO_RATE",
        enable_pseudo_rate: enablePseudoRate,
        pseudo_base_spread: pseudoBaseSpread,
        pseudo_threshold: pseudoThreshold,
        pseudo_sensitivity: pseudoSensitivity
      }).catch(console.error);
    }
  }, [status, enablePseudoRate, pseudoBaseSpread, pseudoThreshold, pseudoSensitivity]);

  // --- 複数ウィンドウ間での設定同期用エフェクト
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "pl-color-style" && e.newValue) {
        setPlColorStyle(e.newValue as "red-blue" | "green-red");
      } else if (e.key === "speed-order-color-style" && e.newValue) {
        setOrderColorStyle(e.newValue as "blue-red" | "red-green");
      } else if (e.key === "speed-order-hedging" && e.newValue) {
        setHedging(e.newValue === "true");
      } else if (e.key === "speed-order-show-holding-time" && e.newValue) {
        setShowHoldingTime(e.newValue !== "false");
      } else if (e.key === "speed-order-holding-time-mode" && e.newValue) {
        setHoldingTimeMode(e.newValue as "pc" | "server");
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [hedging]);

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
    const unlistenStatus = listen<string>("mt5-status", (event) => {
      scheduleStatusUpdate(event.payload);
    });

    // EA接続時
    const unlistenConnect = listen("mt5-connected", () => {
      setStatus((prev) => prev === "DISCONNECTED" ? "CONNECTED" : prev);
    });

    // EA切断時
    const unlistenDisconnect = listen("mt5-disconnected", async () => {
      setStatus("DISCONNECTED");
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
        const saved = await invoke<any>("load_settings");
        if (saved) {
          savedConfig.current = saved;
          if (saved.source_symbol) {
            setSourceSymbol(saved.source_symbol);
            hasSavedSymbolRef.current = true;
          }
          if (saved.additional_symbols !== undefined && saved.additional_symbols !== null) {
            setAdditionalSymbols(saved.additional_symbols);
          }
          setStartTime(saved.start_time);
          setEndTime(saved.end_time);

          setPreloadedBars(saved.preloaded_bars);
          setAutoScrollSync(saved.auto_scroll_sync);
          if (saved.limit_tick_history !== undefined && saved.limit_tick_history !== null) {
            setLimitTickHistory(saved.limit_tick_history);
          }
          if (saved.tick_history_timeframe) {
            setTickHistoryTimeframe(saved.tick_history_timeframe);
          }
          if (saved.max_history_bars !== undefined && saved.max_history_bars !== null) {
            setMaxHistoryBars(saved.max_history_bars);
          }
          if (saved.news_auto_scroll !== undefined && saved.news_auto_scroll !== null) {
            setNewsAutoScroll(saved.news_auto_scroll);
          }
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
          if (saved.news_filters) {
            setNewsFilters(saved.news_filters);
          }
          if (saved.glass_effect !== undefined && saved.glass_effect !== null) {
            setGlassEffect(saved.glass_effect);
          }
          if (saved.theme_mode) {
            setThemeMode(saved.theme_mode as "dark" | "light");
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
            setPseudoBaseSpread(saved.pseudo_base_spread);
          }
          if (saved.pseudo_threshold !== undefined && saved.pseudo_threshold !== null) {
            setPseudoThreshold(saved.pseudo_threshold);
          }
          if (saved.pseudo_sensitivity !== undefined && saved.pseudo_sensitivity !== null) {
            setPseudoSensitivity(saved.pseudo_sensitivity);
          }
          if (saved.show_holding_time !== undefined && saved.show_holding_time !== null) {
            setShowHoldingTime(saved.show_holding_time);
            localStorage.setItem("speed-order-show-holding-time", String(saved.show_holding_time));
          }
          if (saved.holding_time_mode) {
            setHoldingTimeMode(saved.holding_time_mode as "pc" | "server");
            localStorage.setItem("speed-order-holding-time-mode", saved.holding_time_mode);
          }
          const savedContract = localStorage.getItem("speed-order-contract-size");
          if (savedContract) {
            setContractSize(parseInt(savedContract, 10));
          }
        }
      } catch (e) {
        console.error("Failed to load settings", e);
      }

      try {
        await invoke("set_always_on_top", { always: loadedAlwaysOnTop });
      } catch (e) {
        console.error("Failed to sync initial always_on_top", e);
      }

      try {
        await invoke("set_shortcuts_active", { active: loadedShortcutsActive, hotkeys: loadedHotkeys });
      } catch (e) {
        console.error("Failed to sync initial hotkeys", e);
      }
      localStorage.setItem("speed-order-hotkeys", JSON.stringify(loadedHotkeys));

      try {
        await invoke("sync_presets", { timePresets: loadedTimePresets, tickPresets: loadedTickPresets });
      } catch (e) {
        console.error("Failed to sync initial presets", e);
      }

      let terminalSuccess = false;
      try {
        const res = await invoke<TerminalInfo[]>("get_mt5_terminals");
        setTerminals(res);
        if (res.length > 0) {
          let targetPath = res[0].path;
          if (savedConfig.current && res.some((t) => t.path === savedConfig.current.selected_terminal)) {
            targetPath = savedConfig.current.selected_terminal;
          } else {
            // 保存された設定のターミナルが存在しない場合、キャッシュをクリアして初回ロード完了とする
            savedConfig.current = null;
          }
          setSelectedTerminal(targetPath);
          await invoke("select_terminal", { terminalPath: targetPath });
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
        const lastStatus = await invoke<string>("get_last_status");
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
  }, []);

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
      invoke("select_terminal", { terminalPath: selectedTerminal }).catch(console.error);

      // チャートの最大バー数設定を取得
      invoke<MaxBarsInfo>("get_terminal_max_bars", { terminalPath: selectedTerminal })
        .then((info) => setMaxBarsInfo(info))
        .catch((err) => {
          console.error("Failed to get terminal max bars:", err);
          setMaxBarsInfo(null);
        });

      invoke("get_profiles", { terminalPath: selectedTerminal })
        .then((res: any) => {
          setProfiles(res);
          if (res.length > 0) {
            let targetProfile = res[0];
            if (savedConfig.current && savedConfig.current.selected_terminal === selectedTerminal) {
              if (savedConfig.current.selected_profile === "") {
                targetProfile = res[0];
              } else if (res.includes(savedConfig.current.selected_profile)) {
                targetProfile = savedConfig.current.selected_profile;
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

  // 設定変更時の自動保存処理
  useEffect(() => {
    if (!isInitialized) return;

    const timer = setTimeout(() => {
      saveAllSettings();
    }, 500); // 500msのデバウンスで頻繁なファイル書き込みを防止

    return () => clearTimeout(timer);
  }, [
    isInitialized,
    selectedTerminal,
    selectedProfile,
    sourceSymbol,
    startTime,
    endTime,
    preloadedBars,
    autoScrollSync,
    preloadMode,
    preloadDate,
    preloadTimeframe,
    hotkeys,
    timePresets,
    tickPresets,
    newsFilters,
    glassEffect,
    themeMode,
    newsAutoScroll,
    alwaysOnTop,
    isShortcutsActive,
    limitTickHistory,
    tickHistoryTimeframe,
    maxHistoryBars,
    timezoneMode,
    plColorStyle,
    orderColorStyle,
    enablePseudoRate,
    pseudoBaseSpread,
    pseudoThreshold,
    pseudoSensitivity,
    showHoldingTime,
    holdingTimeMode
  ]);

  // --- 2. 各種制御関数

  const sendCommand = async (cmd: any) => {
    try {
      await invoke("send_command", { commandJson: JSON.stringify(cmd) });
    } catch (e) {
      console.error("Failed to send command", e);
      setErrorMessage(translateErrorMessage("Command error: " + e));
      throw e;
    }
  };

  // すべての設定をまとめて保存・同期するヘルパー関数
  const saveAllSettings = async (
    customHotkeys = hotkeys,
    customTimePresets = timePresets,
    customTickPresets = tickPresets,
    customNewsFilters = newsFilters,
    customGlassEffect = glassEffect,
    customThemeMode = themeMode,
    customNewsAutoScroll = newsAutoScroll,
    customAlwaysOnTop = alwaysOnTop,
    customIsShortcutsActive = isShortcutsActive,
    customAutoScrollSync = autoScrollSync,
    customTimezoneMode = timezoneMode,
    customAutoSkipWeekend = autoSkipWeekend,
    customPlColorStyle = plColorStyle,
    customOrderColorStyle = orderColorStyle,
    customHedging = hedging,
    customEnableVirtualTrading = enableVirtualTrading,
    customInitialBalance = initialBalance,
    customLeverage = leverage,
    customEnablePseudoRate = enablePseudoRate,
    customPseudoBaseSpread = pseudoBaseSpread,
    customPseudoThreshold = pseudoThreshold,
    customPseudoSensitivity = pseudoSensitivity,
    customPreloadTimeframe = preloadTimeframe,
    customShowHoldingTime = showHoldingTime,
    customHoldingTimeMode = holdingTimeMode,
    customAdditionalSymbols = additionalSymbols
  ) => {
    const settingsObj = {
      selected_terminal: selectedTerminal,
      selected_profile: selectedProfile,
      source_symbol: sourceSymbol,
      start_time: startTime,
      end_time: endTime,
      preloaded_bars: preloadedBars,
      auto_scroll_sync: customAutoScrollSync,
      auto_skip_weekend: customAutoSkipWeekend,
      preload_mode: preloadMode,
      preload_date: preloadDate,
      preload_timeframe: customPreloadTimeframe,
      limit_tick_history: limitTickHistory,
      tick_history_timeframe: tickHistoryTimeframe,
      max_history_bars: maxHistoryBars,
      hotkeys: customHotkeys,
      time_presets: customTimePresets,
      tick_presets: customTickPresets,
      news_filters: customNewsFilters,
      glass_effect: customGlassEffect,
      theme_mode: customThemeMode,
      news_auto_scroll: customNewsAutoScroll,
      always_on_top: customAlwaysOnTop,
      is_shortcuts_active: customIsShortcutsActive,
      timezone_mode: customTimezoneMode,
      pl_color_style: customPlColorStyle,
      order_color_style: customOrderColorStyle,
      hedging: customHedging,
      enable_virtual_trading: customEnableVirtualTrading,
      initial_balance: customInitialBalance,
      leverage: customLeverage,
      enable_pseudo_rate: customEnablePseudoRate,
      pseudo_base_spread: customPseudoBaseSpread,
      pseudo_threshold: customPseudoThreshold,
      pseudo_sensitivity: customPseudoSensitivity,
      show_holding_time: customShowHoldingTime,
      holding_time_mode: customHoldingTimeMode,
      additional_symbols: customAdditionalSymbols,
    };
    try {
      localStorage.setItem("speed-order-hotkeys", JSON.stringify(customHotkeys));
      await invoke("save_settings", { settings: settingsObj });
      await invoke("sync_presets", { timePresets: customTimePresets, tickPresets: customTickPresets });
    } catch (e) {
      console.error("Failed to save/sync settings", e);
    }
  };

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

    // チャート最大バー数が Unlimited でない場合の確認警告
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
      await invoke("select_profile", {
        terminalPath: selectedTerminal,
        profileName: selectedProfile,
      });

      // 現在の設定を保存
      await saveAllSettings();

      const initCmd = {
        command: "INIT",
        source_symbol: sourceSymbol,
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
        limit_tick_history: limitTickHistory,
        tick_history_timeframe: tickHistoryTimeframe,
        max_history_bars: maxHistoryBars,
        auto_skip_weekend: autoSkipWeekend,
        enable_pseudo_rate: enablePseudoRate,
        pseudo_base_spread: pseudoBaseSpread,
        pseudo_threshold: pseudoThreshold,
        pseudo_sensitivity: pseudoSensitivity,
        additional_symbols: additionalSymbols,
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
    setLimitTickHistory(true);
    setTickHistoryTimeframe("M5");
    setMaxHistoryBars(300);
    setStartTime("2026-05-01 00:00:00");
    setEndTime("2026-05-02 00:00:00");
    setAutoScrollSync(true);
    setNewsAutoScroll(true);
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
    localStorage.setItem("speed-order-contract-size", "10000");
    setHedging(false);
    setEnablePseudoRate(true);

    const isJpy = sourceSymbol.toUpperCase().includes("JPY");
    setPseudoBaseSpread(isJpy ? 0.002 : 0.00002);
    setPseudoThreshold(isJpy ? 0.0110 : 0.000110);
    setPseudoSensitivity(1.025);
  };

  // 再生/一時停止
  const handlePlayPause = () => {
    const nextPlaying = !isPlaying;
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
  const handleReset = () => sendCommand({ command: "RESET" });

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
      const res = await invoke<any[]>("get_saved_sessions");
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
        await invoke("delete_session", { sessionId: sid });
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
      await invoke("clear_all_sessions");
      await loadSavedSessions();
    } catch (e) {
      console.error("Failed to clear all sessions", e);
      setErrorMessage("セッションデータの一括削除に失敗しました。");
    } finally {
      setIsClearAllSessionsConfirmOpen(false);
    }
  };

  const handleResumeSession = async (session: any) => {
    setErrorMessage("");

    // 保存された設定項目をフロントエンドの状態に反映
    setSelectedTerminal(session.settings.selected_terminal);
    setSelectedProfile(session.settings.selected_profile);
    setSourceSymbol(session.settings.source_symbol);
    setStartTime(session.settings.start_time);
    setEndTime(session.settings.end_time);
    setPreloadedBars(session.settings.preloaded_bars);
    setAutoScrollSync(session.settings.auto_scroll_sync);
    setAutoSkipWeekend(session.settings.auto_skip_weekend ?? true);
    setPreloadMode(session.settings.preload_mode || "BARS");
    setPreloadDate(session.settings.preload_date || "2026-01-01 00:00:00");
    setPreloadTimeframe(session.settings.preload_timeframe || "AUTO");

    if (session.settings.limit_tick_history !== undefined) {
      setLimitTickHistory(session.settings.limit_tick_history);
    }
    if (session.settings.tick_history_timeframe) {
      setTickHistoryTimeframe(session.settings.tick_history_timeframe);
    }
    if (session.settings.max_history_bars !== undefined) {
      setMaxHistoryBars(session.settings.max_history_bars);
    }
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
      setPseudoBaseSpread(session.settings.pseudo_base_spread);
    }
    if (session.settings.pseudo_threshold !== undefined) {
      setPseudoThreshold(session.settings.pseudo_threshold);
    }
    if (session.settings.pseudo_sensitivity !== undefined) {
      setPseudoSensitivity(session.settings.pseudo_sensitivity);
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
      await invoke("select_profile", {
        terminalPath: session.settings.selected_terminal,
        profileName: session.settings.selected_profile,
      });

      const initCmd = {
        command: "INIT",
        source_symbol: session.settings.source_symbol,
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
        limit_tick_history: session.settings.limit_tick_history !== undefined ? session.settings.limit_tick_history : true,
        tick_history_timeframe: session.settings.tick_history_timeframe || "M5",
        max_history_bars: session.settings.max_history_bars !== undefined ? session.settings.max_history_bars : 300,
        auto_skip_weekend: session.settings.auto_skip_weekend !== undefined ? session.settings.auto_skip_weekend : true,
        enable_pseudo_rate: session.settings.enable_pseudo_rate !== undefined ? session.settings.enable_pseudo_rate : true,
        pseudo_base_spread: session.settings.pseudo_base_spread !== undefined ? session.settings.pseudo_base_spread : 0.002,
        pseudo_threshold: session.settings.pseudo_threshold !== undefined ? session.settings.pseudo_threshold : 0.0110,
        pseudo_sensitivity: session.settings.pseudo_sensitivity !== undefined ? session.settings.pseudo_sensitivity : 1.025,
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
        start_time: startTime,
        end_time: endTime,
        preloaded_bars: preloadedBars,
        auto_scroll_sync: autoScrollSync,
        auto_skip_weekend: autoSkipWeekend,
        preload_mode: preloadMode,
        preload_date: preloadDate,
        preload_timeframe: preloadTimeframe,
        limit_tick_history: limitTickHistory,
        tick_history_timeframe: tickHistoryTimeframe,
        max_history_bars: maxHistoryBars,
        timezone_mode: timezoneMode,
        enable_virtual_trading: enableVirtualTrading,
        initial_balance: initialBalance,
        leverage: leverage,
        enable_pseudo_rate: enablePseudoRate,
        pseudo_base_spread: pseudoBaseSpread,
        pseudo_threshold: pseudoThreshold,
        pseudo_sensitivity: pseudoSensitivity,
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
            const storedTimesStr = localStorage.getItem("speed-order-position-real-times");
            if (storedTimesStr) {
              const storedTimes = JSON.parse(storedTimesStr);
              if (storedTimes[p.ticket] !== undefined) {
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
            const storedTimesStr = localStorage.getItem("speed-order-position-real-times");
            if (storedTimesStr) {
              const storedTimes = JSON.parse(storedTimesStr);
              if (storedTimes[h.ticket] !== undefined) {
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
      await invoke("save_session", { sessionId, sessionData });
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

  // 終了
  const handleTerminate = async () => {
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
  };

  // ドラッグ開始ハンドラ（ボーダレスウィンドウの移動用）
  const handleDragStart = async (e: React.MouseEvent) => {
    if (e.button === 0) { // 左クリックのみ
      try {
        await getCurrentWindow().startDragging();
      } catch (err) {
        console.error("Failed to start dragging window", err);
      }
    }
  };

  // リモコンモード切り替え（Tauriウィンドウサイズ・枠線・位置吸着制御）
  const toggleRemoteMode = async (remote: boolean) => {
    try {
      await invoke("set_remote_mode", { isRemote: remote, alwaysOnTop: alwaysOnTop });
      setIsRemoteMode(remote);
      if (remote) {
        setIsSettingsOpen(false);
        setActivePickerField(null);
        setRecordingAction(null);
      }
    } catch (e) {
      console.error("Failed to toggle remote mode", e);
    }
  };

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
      is_playing: isPlaying,
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
      let nextIdx = increment ? Math.min(presets.length - 1, idx + 1) : Math.max(0, idx - 1);
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
      let nextIdx = increment ? Math.min(presets.length - 1, idx + 1) : Math.max(0, idx - 1);
      updateSpeed("COUNT", multiplier, presets[nextIdx]);
    }
  };

  // Fine（0.1刻み微調整）速度変更
  const handleFineSpeed = (increment: boolean) => {
    if (speedMode === "TEMPORAL") {
      const step = 0.1;
      let nextVal = increment ? multiplier + step : multiplier - step;
      nextVal = Math.max(0.1, Math.min(1000.0, nextVal));
      updateSpeed("TEMPORAL", Math.round(nextVal * 10) / 10, tickStep);
    } else {
      const step = 1;
      let nextVal = increment ? tickStep + step : tickStep - step;
      nextVal = Math.max(1, Math.min(1000, nextVal));
      updateSpeed("COUNT", multiplier, nextVal);
    }
  };

  // Medium（1.0刻み調整）速度変更
  const handleMediumSpeed = (increment: boolean) => {
    if (speedMode === "TEMPORAL") {
      const step = 1.0;
      let nextVal = increment ? multiplier + step : multiplier - step;
      nextVal = Math.max(0.1, Math.min(1000.0, nextVal));
      updateSpeed("TEMPORAL", Math.round(nextVal * 10) / 10, tickStep);
    } else {
      const step = 10;
      let nextVal = increment ? tickStep + step : tickStep - step;
      nextVal = Math.max(1, Math.min(1000, nextVal));
      updateSpeed("COUNT", multiplier, nextVal);
    }
  };

  // --- 3. UIトグル動作

  // 常に最前面に表示トグル
  const handleAlwaysOnTopToggle = async () => {
    const next = !alwaysOnTop;
    try {
      await invoke("set_always_on_top", { always: next });
      setAlwaysOnTop(next);
    } catch (e) {
      console.error(e);
    }
  };

  // 時間比率モード時の週末自動スキップ有効化トグル
  const handleAutoSkipWeekendToggle = (val: boolean) => {
    setAutoSkipWeekend(val);
    saveAllSettings(
      hotkeys,
      timePresets,
      tickPresets,
      newsFilters,
      glassEffect,
      themeMode,
      newsAutoScroll,
      alwaysOnTop,
      isShortcutsActive,
      autoScrollSync,
      timezoneMode,
      val
    );
    if (status === "READY" || status === "ACTIVE") {
      sendCommand({
        command: "CONTROL",
        is_playing: isPlaying,
        speed_mode: speedMode,
        multiplier: multiplier,
        tick_step: tickStep,
        auto_skip_weekend: val,
      });
    }
  };

  // キーボードショートカット有効化トグル
  const handleShortcutsToggle = async () => {
    const next = !isShortcutsActive;
    try {
      await invoke("set_shortcuts_active", { active: next, hotkeys: hotkeys });
      setIsShortcutsActive(next);
    } catch (e) {
      console.error(e);
    }
  };

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
        handlePlayPause();
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
        emit("trigger-action", { action: "order_buy" }).catch(console.error);
      } else if (matchesHotkey(e, hotkeys.order_sell)) {
        e.preventDefault();
        emit("trigger-action", { action: "order_sell" }).catch(console.error);
      } else if (matchesHotkey(e, hotkeys.order_close_buy)) {
        e.preventDefault();
        emit("trigger-action", { action: "order_close_buy" }).catch(console.error);
      } else if (matchesHotkey(e, hotkeys.order_close_sell)) {
        e.preventDefault();
        emit("trigger-action", { action: "order_close_sell" }).catch(console.error);
      } else if (matchesHotkey(e, hotkeys.order_close_all)) {
        e.preventDefault();
        emit("trigger-action", { action: "order_close_all" }).catch(console.error);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // SpeedOrderウィンドウ等からのIPC経由のホットキーアクション呼び出しをリッスン
  useEffect(() => {
    const unlisten = listen<{ action: string }>("trigger-action", (event) => {
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
        saveAllSettings(newHotkeys)
          .then(() => {
            invoke("set_shortcuts_active", { active: isShortcutsActive, hotkeys: newHotkeys }).catch(console.error);
          })
          .catch(console.error);

        setRecordingAction(null);
      }
    };

    window.addEventListener("keydown", handleRecordKeyDown, true);
    return () => window.removeEventListener("keydown", handleRecordKeyDown, true);
  }, [recordingAction, hotkeys, selectedTerminal, selectedProfile, sourceSymbol, startTime, endTime, preloadedBars, autoScrollSync, preloadMode, preloadDate, preloadTimeframe, isShortcutsActive, timePresets, tickPresets, autoSkipWeekend]);

  const handleClearHotkey = (actionKey: string) => {
    const newHotkeys = { ...hotkeys, [actionKey]: "" };
    setHotkeys(newHotkeys);

    saveAllSettings(newHotkeys)
      .then(() => {
        invoke("set_shortcuts_active", { active: isShortcutsActive, hotkeys: newHotkeys }).catch(console.error);
      })
      .catch(console.error);
  };

  const handleResetAllHotkeys = () => {
    setHotkeys(DEFAULT_HOTKEYS);

    saveAllSettings(DEFAULT_HOTKEYS)
      .then(() => {
        invoke("set_shortcuts_active", { active: isShortcutsActive, hotkeys: DEFAULT_HOTKEYS }).catch(console.error);
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

  // ドラッグ/クリックシーク
  const sendSeekCommand = (targetIdx: number) => {
    sendCommand({
      command: "SEEK",
      target_index: targetIdx,
    });
  };

  const handleTimelineInteraction = (e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>, svgEl: SVGSVGElement) => {
    const rect = svgEl.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const targetIdx = Math.round(percentage * totalTicks);

    setCurrentIdx(targetIdx); // 即座にスライダーつまみを動かす

    // 200msでのデバウンス（ドラッグ追従負荷の軽減）
    if (!throttledSeekRef.current) {
      throttledSeekRef.current = window.setTimeout(() => {
        sendSeekCommand(targetIdx);
        throttledSeekRef.current = null;
      }, 200);
    }
  };

  const handleTimelineMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    isDraggingRef.current = true;
    const svgEl = e.currentTarget;
    handleTimelineInteraction(e, svgEl);

    const handleMouseMove = (mvEvent: MouseEvent) => {
      handleTimelineInteraction(mvEvent as any, svgEl);
    };

    const handleMouseUp = (muEvent: MouseEvent) => {
      isDraggingRef.current = false;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);

      if (throttledSeekRef.current) {
        clearTimeout(throttledSeekRef.current);
        throttledSeekRef.current = null;
      }

      const rect = svgEl.getBoundingClientRect();
      const x = muEvent.clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, x / rect.width));
      const finalIdx = Math.round(percentage * totalTicks);
      sendSeekCommand(finalIdx);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // セッション描画データの整理
  const sessions = organizeSessions(sessionBoundaries);

  const renderTimelineRects = () => {
    if (totalTicks <= 0 || sessions.length === 0) return null;
    const rects = [];
    for (let i = 0; i < sessions.length; i++) {
      const current = sessions[i];
      const next = sessions[i + 1];
      const startX = (current.idx / totalTicks) * 100;
      const endX = next ? (next.idx / totalTicks) * 100 : 100;
      const width = endX - startX;

      const color = current.type === "TYO" ? "var(--session-tyo)" : current.type === "LDN" ? "var(--session-ldn)" : "var(--session-ny)";

      rects.push(
        <rect
          key={i}
          x={`${startX}%`}
          y="0"
          width={`${width}%`}
          height="100%"
          fill={color}
          opacity="0.25"
        />
      );
    }
    return rects;
  };

  // ミニタイムライン用のセッション背景描画
  const renderMiniSessionTrack = () => {
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
  };

  // 進捗率
  const progressPercent = totalTicks > 0 ? (currentIdx / totalTicks) * 100 : 0;

  // --- 5.5 経済指標 & 日付計算用のヘルパー
  const getDayOffset = () => {
    if (!virtualTimeMsc || !startTime) return "T+0";
    const startJstUtcMsc = parseTimeStrToUtcMs(startTime);
    if (isNaN(startJstUtcMsc)) return "T+0";
    const currentJstUtcMsc = virtualTimeMsc + getServerToJstOffsetHours(virtualTimeMsc) * 3600 * 1000;
    const diffMs = currentJstUtcMsc - startJstUtcMsc;
    const diffDays = Math.floor(diffMs / (24 * 3600 * 1000));
    return `T${diffDays >= 0 ? "+" : ""}${diffDays}`;
  };


  const isEventFiltered = (item: ReplayNewsItem) => checkEventFiltered(item, newsFilters);

  const handleNewsJump = async (eventTimeJst: string) => {
    try {
      await sendCommand({
        command: "SEEK_TIME",
        target_time: eventTimeJst
      });
    } catch (e) {
      console.error("Failed to jump to event time", e);
    }
  };

  const loadReplayNews = async () => {
    try {
      const res = await invoke<string>("read_replay_news");
      const parsed = JSON.parse(res);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // MT5から出力されたピリオド区切りの日付（例: 2026.05.01）をフロントエンドで一貫して比較できるようにハイフン区切り（例: 2026-05-01）に変換
        const formatted = parsed.map((item: any) => ({
          ...item,
          time: item.time ? item.time.replace(/\./g, "-") : ""
        }));
        setNewsItems(formatted);
        // 指標データが1件以上ロードされた場合のみロード済みフラグを立てる
        hasLoadedNewsRef.current = true;
      } else {
        setNewsItems([]);
        // 0件の場合はロード完了フラグを立てず、次回ステータス更新時にリトライできるようにする
      }
    } catch (e) {
      console.error("Failed to load replay news", e);
      setNewsItems([]);
    }
  };

  const currentDisplayDateStr = timezoneMode === "JST"
    ? formatJstTime(virtualTimeMsc).substring(0, 10)
    : formatServerTime(virtualTimeMsc).substring(0, 10);

  const getDisplayNewsTimeStr = (item: ReplayNewsItem) => {
    return getNewsTimeForDisplay(item.time, timezoneMode);
  };

  const filteredDailyNews = newsItems.filter(item => {
    const displayTimeStr = getDisplayNewsTimeStr(item);
    return displayTimeStr.startsWith(currentDisplayDateStr) && isEventFiltered(item);
  });

  // 経済指標リストの自動スクロール制御
  useEffect(() => {
    if (!newsAutoScroll) {
      lastScrolledEventKeyRef.current = "";
    }
  }, [newsAutoScroll]);

  useEffect(() => {
    if (!newsAutoScroll || filteredDailyNews.length === 0) return;

    const currentCompareMsc = timezoneMode === "JST"
      ? virtualTimeMsc + getServerToJstOffsetHours(virtualTimeMsc) * 3600 * 1000
      : virtualTimeMsc;

    // 1. アクティブな指標（バーチャルタイムに最も近い、前後15分以内）を検索
    let targetIdx = -1;
    let minDiff = Infinity;
    for (let i = 0; i < filteredDailyNews.length; i++) {
      const item = filteredDailyNews[i];
      const displayTimeStr = getDisplayNewsTimeStr(item);
      const eventMsc = parseTimeStrToUtcMs(displayTimeStr);
      if (isNaN(eventMsc)) continue;

      const isActive = Math.abs(currentCompareMsc - eventMsc) <= 15 * 60 * 1000;
      if (isActive) {
        const diff = Math.abs(currentCompareMsc - eventMsc);
        if (diff < minDiff) {
          minDiff = diff;
          targetIdx = i;
        }
      }
    }

    // 2. アクティブな指標がない場合、これから発生する最初の指標をターゲットにする
    if (targetIdx === -1) {
      for (let i = 0; i < filteredDailyNews.length; i++) {
        const item = filteredDailyNews[i];
        const displayTimeStr = getDisplayNewsTimeStr(item);
        const eventMsc = parseTimeStrToUtcMs(displayTimeStr);
        if (!isNaN(eventMsc) && eventMsc > currentCompareMsc) {
          targetIdx = i;
          break;
        }
      }
    }

    // 3. すべて過去の指標である場合、最後の指標をターゲットにする
    if (targetIdx === -1 && filteredDailyNews.length > 0) {
      targetIdx = filteredDailyNews.length - 1;
    }

    if (targetIdx !== -1) {
      const targetItem = filteredDailyNews[targetIdx];
      const targetKey = `${targetItem.time}_${targetItem.event}`;

      // ターゲットの指標が変更された場合のみスクロール処理を実行
      if (lastScrolledEventKeyRef.current !== targetKey) {
        lastScrolledEventKeyRef.current = targetKey;
        const container = newsContainerRef.current;
        if (container) {
          const rows = container.querySelectorAll("tbody tr");
          const targetRow = rows[targetIdx] as HTMLElement;
          if (targetRow) {
            const containerRect = container.getBoundingClientRect();
            const rowRect = targetRow.getBoundingClientRect();
            const relativeOffsetTop = rowRect.top - containerRect.top + container.scrollTop;
            const containerHeight = container.clientHeight;
            const rowHeight = targetRow.clientHeight;

            container.scrollTo({
              top: relativeOffsetTop - containerHeight / 2 + rowHeight / 2,
              behavior: "smooth",
            });
          }
        }
      }
    }
  }, [virtualTimeMsc, filteredDailyNews, newsAutoScroll]);

  // --- 6. レンダリング

  if (isRemoteMode) {
    return (
      <div className="remote-wrapper glass-panel relative" data-tauri-drag-region>
        {/* ドラッグ移動用のつまみ（最左端） */}
        <div
          className="remote-grip select-none"
          onMouseDown={handleDragStart}
          data-tauri-drag-region
          title="ドラッグして移動"
        >
          <span className="material-symbols-outlined text-[16px] pointer-events-none" data-tauri-drag-region>
            drag_indicator
          </span>
        </div>

        {/* 左側：ステータス＆時刻表示HUD */}
        <div className="remote-hud" onMouseDown={handleDragStart} data-tauri-drag-region>
          <div className="remote-hud-dot" title="EA接続ステータス"></div>
          <div className="remote-segment select-none" data-tauri-drag-region>
            <span className="remote-segment-time" data-tauri-drag-region>
              {timezoneMode === "JST"
                ? formatJstTime(virtualTimeMsc).substring(11, 19)
                : formatServerTime(virtualTimeMsc).substring(11, 19)}
            </span>
            <span className="remote-segment-date" data-tauri-drag-region>
              {timezoneMode === "JST"
                ? `${formatJstTime(virtualTimeMsc).substring(0, 10).replace(/-/g, ".")} ${getDayOfWeekStr(virtualTimeMsc, true)}`
                : `${formatServerTime(virtualTimeMsc).substring(0, 10).replace(/-/g, ".")} ${getDayOfWeekStr(virtualTimeMsc, false)}`}
            </span>
          </div>
        </div>

        {/* Center: High-Density Controls & Timeline */}
        <div className="remote-controls-center">
          {/* Session Jumps */}
          <div className="remote-session-group">
            <div className="remote-session-block border-r">
              <span className="remote-session-label tyo select-none">TYO</span>
              <button className="remote-btn-tactile" onClick={() => handleSessionJump("TYO", "PREV")} title="Tokyo Session Previous" style={{ marginRight: '2px' }}>
                <span className="material-symbols-outlined text-[14px]">remove</span>
              </button>
              <button className="remote-btn-tactile" onClick={() => handleSessionJump("TYO", "NEXT")} title="Tokyo Session Next">
                <span className="material-symbols-outlined text-[14px]">add</span>
              </button>
            </div>
            <div className="remote-session-block border-r">
              <span className="remote-session-label ldn select-none">LDN</span>
              <button className="remote-btn-tactile" onClick={() => handleSessionJump("LDN", "PREV")} title="London Session Previous" style={{ marginRight: '2px' }}>
                <span className="material-symbols-outlined text-[14px]">remove</span>
              </button>
              <button className="remote-btn-tactile" onClick={() => handleSessionJump("LDN", "NEXT")} title="London Session Next">
                <span className="material-symbols-outlined text-[14px]">add</span>
              </button>
            </div>
            <div className="remote-session-block">
              <span className="remote-session-label ny select-none">NY</span>
              <button className="remote-btn-tactile" onClick={() => handleSessionJump("NY", "PREV")} title="New York Session Previous" style={{ marginRight: '2px' }}>
                <span className="material-symbols-outlined text-[14px]">remove</span>
              </button>
              <button className="remote-btn-tactile" onClick={() => handleSessionJump("NY", "NEXT")} title="New York Session Next">
                <span className="material-symbols-outlined text-[14px]">add</span>
              </button>
            </div>
          </div>

          {/* Time Jumps */}
          <div className="remote-time-group">
            <button className="remote-btn-time" onClick={() => handleTimeJump(-60)} title="Time Jump -1M">-1M</button>
            <button className="remote-btn-time" onClick={() => handleTimeJump(60)} title="Time Jump +1M">+1M</button>
            <div className="remote-divider-v"></div>
            <button className="remote-btn-time" onClick={() => handleTimeJump(-600)} title="Time Jump -10M">-10M</button>
            <button className="remote-btn-time" onClick={() => handleTimeJump(600)} title="Time Jump +10M">+10M</button>
          </div>

          {/* Playback Cluster */}
          <div className="remote-playback-group">
            <button className="remote-btn-playback" onClick={() => handleStep(-1)} title="1 Tick Backward">
              <span className="material-symbols-outlined text-[15px]" style={{ fontVariationSettings: "'FILL' 1" }}>skip_previous</span>
            </button>
            <button className={`remote-btn-playback-primary ${isPlaying ? "active-play" : ""}`} onClick={handlePlayPause} title={isPlaying ? "Pause Replay" : "Play Replay"}>
              <span className="material-symbols-outlined text-[16px] text-[#0D0F14]" style={{ fontVariationSettings: "'FILL' 1" }}>{isPlaying ? "pause" : "play_arrow"}</span>
            </button>
            <button className="remote-btn-playback" onClick={() => handleStep(1)} title="1 Tick Forward">
              <span className="material-symbols-outlined text-[15px]" style={{ fontVariationSettings: "'FILL' 1" }}>skip_next</span>
            </button>
          </div>

          {/* Speed Toggle */}
          <button
            className="remote-speed-btn"
            onClick={() => updateSpeed(speedMode === "TEMPORAL" ? "COUNT" : "TEMPORAL", multiplier, tickStep)}
            title="Click to toggle Speed Mode (Time vs Tick Count)"
          >
            {speedMode === "TEMPORAL" ? `${multiplier.toFixed(1)}x` : `${tickStep}T`}
          </button>
        </div>

        {/* Right: Mini Timeline */}
        <div className="remote-timeline-container">
          <div className="remote-timeline-track-bg">
            {renderMiniSessionTrack()}
          </div>
          <div className="remote-slider-wrapper">
            <input
              className="remote-slider-el"
              max={totalTicks}
              min={0}
              type="range"
              value={currentIdx}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                setCurrentIdx(val);
                sendSeekCommand(val);
              }}
              title={`Tick Progress: ${currentIdx} / ${totalTicks}`}
            />
          </div>
          <div className="remote-timeline-labels select-none">
            <span className="remote-timeline-text">
              {startTime
                ? (timezoneMode === "JST" ? startTime : getNewsTimeForDisplay(startTime, "SERVER")).substring(11, 16)
                : "00:00"}
            </span>
            <span className="remote-timeline-text active">
              {timezoneMode === "JST"
                ? formatJstTime(virtualTimeMsc).substring(11, 16)
                : formatServerTime(virtualTimeMsc).substring(11, 16)}
            </span>
            <span className="remote-timeline-text">
              {endTime
                ? (timezoneMode === "JST" ? endTime : getNewsTimeForDisplay(endTime, "SERVER")).substring(11, 16)
                : "24:00"}
            </span>
          </div>
        </div>

        {/* Far Right: Utility actions */}
        <div className="remote-utilities">
          <button
            className={`remote-btn-utility ${isShortcutsActive ? "active-green" : ""}`}
            onClick={handleShortcutsToggle}
            title="Global Hotkeys Toggle"
          >
            <span className="material-symbols-outlined text-[14px]">keyboard</span>
          </button>
          <button
            className={`remote-btn-utility ${alwaysOnTop ? "active-green" : ""}`}
            onClick={handleAlwaysOnTopToggle}
            title="Always on Top Toggle"
          >
            <span className="material-symbols-outlined text-[14px]">push_pin</span>
          </button>
          <button
            className="remote-btn-utility danger"
            onClick={handleTerminate}
            title="Terminate Replay"
          >
            <span className="material-symbols-outlined text-[14px]">power_settings_new</span>
          </button>
          <button
            className="remote-btn-utility exit"
            onClick={() => toggleRemoteMode(false)}
            title="通常画面に戻る"
          >
            <span className="material-symbols-outlined text-[14px]">desktop_windows</span>
          </button>
        </div>
      </div>
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

      {/* Top Navbar */}
      <nav className="top-navbar">
        <div className="nav-brand">
          <div 
            className="connection-status" 
            title={`Status: ${status === "DISCONNECTED" ? "Disconnected (未接続)" : status === "CONNECTED" ? "Connected (接続完了)" : status === "READY" ? "Ready (準備完了)" : "Active (動作中)"}`}
          >
            <span className={`status-dot ${status.toLowerCase()}`}></span>
          </div>
        </div>

        {/* Central HUD */}
        <div className="hud-center">
          <div className="hud-panel">
            <div className="hud-group">
              {timezoneMode === "JST" ? (
                <div className="hud-item">
                  <span className="hud-label">LCL</span>
                  <span className="hud-val primary">
                    <span className="hud-date">{`${formatJstTime(virtualTimeMsc).substring(0, 10).replace(/-/g, ".")} ${getDayOfWeekStr(virtualTimeMsc, true)}`}</span>
                    {formatJstTime(virtualTimeMsc).substring(11, 19)}
                  </span>
                </div>
              ) : (
                <div className="hud-item">
                  <span className="hud-label">SRV</span>
                  <span className="hud-val primary">
                    <span className="hud-date">{`${formatServerTime(virtualTimeMsc).substring(0, 10).replace(/-/g, ".")} ${getDayOfWeekStr(virtualTimeMsc, false)}`}</span>
                    {formatServerTime(virtualTimeMsc).substring(11, 19)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action icons & Terminate */}
        <div className="nav-actions">
          {/* 1. 画面切替 (検証時のみ) */}
          {(status === "ACTIVE" || status === "READY") && (
            <div className="mode-toggle-segmented" style={{ display: "flex", gap: "2px", backgroundColor: "var(--surface-container-high)", padding: "2px", borderRadius: "var(--radius-sm)", marginRight: "4px", border: "1px solid var(--outline-variant)", userSelect: "none", flexShrink: 0 }}>
              <button
                className={`pro-btn ${currentViewMode === "replay" ? "active-loop" : ""}`}
                style={{ padding: "4px 8px", fontSize: "10px", height: "24px", whiteSpace: "nowrap", flexShrink: 0 }}
                onClick={() => setCurrentViewMode("replay")}
              >
                再生画面
              </button>
              <button
                className={`pro-btn ${currentViewMode === "trade" ? "active-loop" : ""}`}
                style={{ padding: "4px 8px", fontSize: "10px", height: "24px", whiteSpace: "nowrap", flexShrink: 0 }}
                onClick={() => setCurrentViewMode("trade")}
              >
                取引実績
              </button>
            </div>
          )}

          {/* 2. スピード発注パネルを起動 (検証時のみ) */}
          {(status === "ACTIVE" || status === "READY") && (
            <button
              className="pro-btn pro-btn-square"
              onClick={async () => {
                try {
                  await invoke("open_speed_order_window");
                } catch (err) {
                  console.error(err);
                }
              }}
              title="スピード発注パネルを起動"
            >
              <span className="material-symbols-outlined text-[16px]">currency_exchange</span>
            </button>
          )}

          {/* 3. 現在の検証状態を保存 (検証時のみ) */}
          {(status === "READY" || status === "ACTIVE") && (
            <button
              className="pro-btn pro-btn-square"
              onClick={() => {
                const now = new Date();
                const pad = (n: number) => n.toString().padStart(2, '0');
                const defaultName = `${sourceSymbol}_Replay_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
                setSaveSessionName(currentSessionId ? currentSessionName : defaultName);
                setSaveAsNewSnapshot(false);
                setSessionSaveType("manual");
                setIsSaveSessionOpen(true);
              }}
              title="現在の検証状態を保存"
            >
              <span className="material-symbols-outlined text-[16px]">save</span>
            </button>
          )}

          {/* 4. 急変動・トレンドAI解析 (常時表示) */}
          {spikeInfo.isSpike && (
            <button
              className="spike-alert-badge"
              onClick={() => {
                setAiTargetTimeMsc(spikeInfo.spikeTimeMsc);
                setIsAIPanelOpen(true);
                clearSpike();
              }}
              title="急変動が検出されました。クリックしてAI解析を実行"
            >
              ⚡ 急変動 (+{spikeInfo.pipsDelta}p) AI解析
            </button>
          )}

          <button
            className="pro-btn pro-btn-square"
            onClick={() => {
              setAiTargetTimeMsc(virtualTimeMsc);
              setIsAIPanelOpen(true);
            }}
            title="急変動・トレンドAI解析"
          >
            <span className="material-symbols-outlined text-[16px]" style={{ color: "#3b82f6" }}>auto_awesome</span>
          </button>

          {/* 5. 環境設定 (常時表示) */}
          <button
            className="pro-btn pro-btn-square"
            onClick={() => setIsSettingsOpen(true)}
            title="環境設定"
          >
            <span className="material-symbols-outlined text-[16px]">settings</span>
          </button>

          {/* 6. リプレイ検証を終了する (検証時のみ) */}
          {(status === "READY" || status === "ACTIVE") && (
            <button
              className="pro-btn pro-btn-square danger"
              onClick={handleTerminate}
              title="リプレイ検証を終了する"
            >
              <span className="material-symbols-outlined text-[16px]">power_settings_new</span>
            </button>
          )}

          <div className="nav-divider"></div>

          {/* 7. サブメニュー（その他補助機能） */}
          <div className="header-submenu-container" ref={submenuRef}>
            <button
              className={`pro-btn pro-btn-square ${isSubmenuOpen ? "active-loop" : ""}`}
              onClick={() => setIsSubmenuOpen(!isSubmenuOpen)}
              title="その他・補助機能"
            >
              <span className="material-symbols-outlined text-[16px]">more_vert</span>
              {(alwaysOnTop || isShortcutsActive) && (
                <span className="header-submenu-dot-indicator" title="補助機能が有効です"></span>
              )}
            </button>

            {isSubmenuOpen && (
              <div className="header-submenu-dropdown">
                <div className="header-submenu-header">補助ツール &amp; 表示設定</div>
                <button
                  className={`header-submenu-item ${alwaysOnTop ? "active" : ""}`}
                  onClick={() => {
                    handleAlwaysOnTopToggle();
                  }}
                  title="ウインドウを常に最前面に固定"
                >
                  <span className="material-symbols-outlined icon">push_pin</span>
                  <span className="label">最前面に固定</span>
                  <span className="status-tag">{alwaysOnTop ? "ON" : "OFF"}</span>
                </button>

                <button
                  className={`header-submenu-item ${isShortcutsActive ? "active" : ""}`}
                  onClick={() => {
                    handleShortcutsToggle();
                  }}
                  title="キーボードショートカット有効化"
                >
                  <span className="material-symbols-outlined icon">keyboard</span>
                  <span className="label">ショートカット</span>
                  <span className="status-tag">{isShortcutsActive ? "ON" : "OFF"}</span>
                </button>

                <button
                  className="header-submenu-item"
                  onClick={() => {
                    toggleRemoteMode(true);
                    setIsSubmenuOpen(false);
                  }}
                  title="リモート操作モードの切替"
                >
                  <span className="material-symbols-outlined icon">settings_remote</span>
                  <span className="label">リモコンモード</span>
                </button>

                <div className="header-submenu-divider"></div>

                <button
                  className="header-submenu-item"
                  onClick={() => {
                    const nextMode = themeMode === "dark" ? "light" : "dark";
                    setThemeMode(nextMode);
                    saveAllSettings(hotkeys, timePresets, tickPresets, newsFilters, glassEffect, nextMode);
                  }}
                  title={themeMode === "dark" ? "ライトモードに切り替え" : "ダークモードに切り替え"}
                >
                  <span className="material-symbols-outlined icon">
                    {themeMode === "dark" ? "light_mode" : "dark_mode"}
                  </span>
                  <span className="label">{themeMode === "dark" ? "ライトモード" : "ダークモード"}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Main Workspace Area */}
      <main className="main-workspace" style={{ position: "relative" }}>
        {/* エラーバナー (オーバーレイ表示、他パネルの位置がずれないように絶対配置) */}
        {errorMessage && (
          <div
            className="error-banner"
            style={{
              position: "absolute",
              top: "20px",
              left: 0,
              right: 0,
              marginLeft: "auto",
              marginRight: "auto",
              zIndex: 1000,
              width: "calc(100% - 40px)",
              maxWidth: "600px",
              boxShadow: "0 8px 24px rgba(0, 0, 0, 0.6)",
              backgroundColor: "rgba(30, 10, 10, 0.95)",
              border: "1px solid var(--status-danger)",
              margin: "0 auto",
            }}
          >
            <span className="material-symbols-outlined">error</span>
            <span style={{ flex: 1 }}>{errorMessage}</span>
            <button
              className="error-banner-close-btn"
              onClick={() => setErrorMessage("")}
              title="閉じる"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        )}

        {(status === "DISCONNECTED" || status === "CONNECTED") ? (
          /* A. Setup Panel */
          <div className="setup-panel pro-panel" style={{ maxHeight: "calc(100vh - 62px)", display: "flex", flexDirection: "column" }}>
            <div className="pro-panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 className="pro-panel-title">
                <span className="material-symbols-outlined icon-accent">settings_input_component</span>
                Setup Replay Environment
              </h3>
              <div className="mode-toggle-segmented" style={{ display: "flex", gap: "2px", backgroundColor: "var(--surface-container-high)", padding: "2px", borderRadius: "var(--radius-sm)", border: "1px solid var(--outline-variant)", userSelect: "none" }}>
                <button
                  type="button"
                  className={`pro-btn ${setupTab === "replay" ? "active-loop" : ""}`}
                  style={{ padding: "4px 10px", fontSize: "10px", height: "24px" }}
                  onClick={() => setSetupTab("replay")}
                >
                  リプレイ設定
                </button>
                <button
                  type="button"
                  className={`pro-btn ${setupTab === "trading" ? "active-loop" : ""}`}
                  style={{ padding: "4px 10px", fontSize: "10px", height: "24px" }}
                  onClick={() => setSetupTab("trading")}
                >
                  取引設定
                </button>
                <button
                  type="button"
                  className={`pro-btn ${setupTab === "resume" ? "active-loop" : ""}`}
                  style={{ padding: "4px 10px", fontSize: "10px", height: "24px" }}
                  onClick={() => {
                    setSetupTab("resume");
                    loadSavedSessions();
                  }}
                >
                  セッション再開
                </button>
              </div>
            </div>

            <div className="pro-panel-body" style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", flex: 1 }}>
              <div className="setup-cards-scroll-container" style={{ overflowY: "auto", paddingRight: "6px", flex: 1, minHeight: 0, marginBottom: "8px" }}>
                <div className="setup-grid-container" style={{ display: setupTab === "replay" ? "grid" : "none" }}>
                  {/* グループ1: 接続設定 */}
                  <div className="setup-card">
                    <div className="setup-card-header">
                      <div className="setup-card-title">
                        <span className="material-symbols-outlined">settings_ethernet</span>
                        接続設定
                      </div>
                    </div>
                    <div className="setup-card-body">
                      <div className="form-group">
                        <label className="form-label">MT5ターミナル</label>
                        <CustomSelect
                          value={selectedTerminal}
                          onChange={setSelectedTerminal}
                          options={terminals.length > 0
                            ? terminals.map(t => ({ value: t.path, label: t.name }))
                            : [{ value: "", label: "No Terminals Found" }]
                          }
                        />
                      </div>

                      <div className="form-group" style={{ marginTop: "2px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", marginBottom: "3px" }}>
                          <span className="form-label" style={{ marginBottom: 0 }}>チャートの最大バー数</span>
                          {maxBarsInfo ? (
                            maxBarsInfo.is_unlimited ? (
                              <span className="max-bars-badge unlimited">
                                <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>check_circle</span>
                                Unlimited (無制限)
                              </span>
                            ) : (
                              <span className="max-bars-badge limited">
                                <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>warning</span>
                                {maxBarsInfo.max_bars > 0 ? `${maxBarsInfo.max_bars.toLocaleString()} 本` : maxBarsInfo.raw_value} (制限あり)
                              </span>
                            )
                          ) : (
                            <span className="max-bars-badge loading">確認中...</span>
                          )}
                        </div>
                        {maxBarsInfo && !maxBarsInfo.is_unlimited && (
                          <div className="max-bars-warning-note">
                            <span className="material-symbols-outlined" style={{ fontSize: "15px", color: "#ffb74d", marginTop: "1px", flexShrink: 0 }}>info</span>
                            <span>
                              ※ 最大バー数が無制限でない場合、過去データ検証時にインジケータ（MAやVWAP等）が正しく表示されない可能性があります。MT5の <strong>[ツール] → [オプション] → [チャート]</strong> で「チャートの最大バー数」を <strong>「Unlimited (無制限)」</strong> に設定してください。
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="form-group">
                        <label className="form-label">チャートプロファイル</label>
                        <CustomSelect
                          value={selectedProfile}
                          onChange={setSelectedProfile}
                          options={profiles.map(p => ({ value: p, label: p }))}
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">ソースシンボル</label>
                        <div className="input-with-button-container">
                          <SymbolCombobox
                            value={sourceSymbol}
                            onChange={(val) => {
                              setSourceSymbol(val);
                            }}
                            availableSymbols={availableSymbols}
                            placeholder="e.g. USDJPY または EURJPY_Custom"
                          />
                          {chartSymbol && (
                            <button
                              type="button"
                              className="input-inline-btn"
                              onClick={() => {
                                setSourceSymbol(chartSymbol);
                              }}
                              title={`接続中のチャートのシンボル (${chartSymbol}) にリセット`}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>restart_alt</span>
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="form-group">
                        <label className="form-label">同期他通貨シンボル</label>
                        <SymbolTagInput
                          value={additionalSymbols}
                          onChange={setAdditionalSymbols}
                          availableSymbols={availableSymbols}
                          placeholder="銘柄を選択または入力して追加..."
                        />
                      </div>

                      <div style={{ marginTop: "12px" }}>
                        <button
                          type="button"
                          className="btn-custom-import"
                          onClick={() => setIsCustomImportOpen(true)}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>database_upload</span>
                          カスタムシンボルのインポート
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* グループ2: 期間・時間帯設定 */}
                  <div className="setup-card">
                    <div className="setup-card-header">
                      <div className="setup-card-title">
                        <span className="material-symbols-outlined">calendar_month</span>
                        期間・時間帯設定
                      </div>
                    </div>
                    <div className="setup-card-body">
                      <div className="form-group">
                        <label className="form-label">タイムゾーン</label>
                        <CustomSelect
                          value={timezoneMode}
                          onChange={(val) => setTimezoneMode(val as "JST" | "SERVER")}
                          options={[
                            { value: "JST", label: "日本時間 JST" },
                            { value: "SERVER", label: "MT5サーバ時刻 SRV" }
                          ]}
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">開始日時 ({timezoneMode})</label>
                        <div className="input-with-button-container">
                          <input
                            type="text"
                            readOnly
                            className="pro-input input-with-button cursor-pointer"
                            value={timezoneMode === "JST" ? startTime : getNewsTimeForDisplay(startTime, "SERVER")}
                            onClick={() => setActivePickerField("start")}
                            placeholder="YYYY-MM-DD HH:mm:ss"
                          />
                          <button
                            type="button"
                            className="input-inline-btn"
                            onClick={() => setActivePickerField("start")}
                            title="カレンダーで選択"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>calendar_today</span>
                          </button>
                        </div>
                      </div>

                      <div className="form-group">
                        <label className="form-label">終了日時 ({timezoneMode})</label>
                        <div className="input-with-button-container">
                          <input
                            type="text"
                            readOnly
                            className="pro-input input-with-button cursor-pointer"
                            value={timezoneMode === "JST" ? endTime : getNewsTimeForDisplay(endTime, "SERVER")}
                            onClick={() => setActivePickerField("end")}
                            placeholder="YYYY-MM-DD HH:mm:ss"
                          />
                          <button
                            type="button"
                            className="input-inline-btn"
                            onClick={() => setActivePickerField("end")}
                            title="カレンダーで選択"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>calendar_today</span>
                          </button>
                        </div>
                      </div>

                      <label className="checkbox-group" style={{ marginTop: "4px" }}>
                        <input
                          type="checkbox"
                          checked={autoSkipWeekend}
                          onChange={(e) => setAutoSkipWeekend(e.target.checked)}
                        />
                        <span className="form-label" style={{ textTransform: "none", cursor: "pointer" }}>週末をスキップ (時間比率モード)</span>
                      </label>
                    </div>
                  </div>

                  {/* グループ3: プリロード＆履歴設定 */}
                  <div className="setup-card full-width">
                    <div className="setup-card-header">
                      <div className="setup-card-title">
                        <span className="material-symbols-outlined">download_for_offline</span>
                        プリロード・履歴設定
                      </div>
                    </div>
                    <div className="setup-card-body">
                      <div className="setup-card-grid-2">
                        <div className="form-group">
                          <label className="form-label">プリロードモード</label>
                          <CustomSelect
                            value={preloadMode}
                            onChange={(val) => setPreloadMode(val as "BARS" | "DATE")}
                            options={[
                              { value: "BARS", label: "バー数指定" },
                              { value: "DATE", label: "過去日付指定" }
                            ]}
                          />
                        </div>

                        {preloadMode === "BARS" ? (
                          <div className="setup-card-grid-2" style={{ gap: "8px" }}>
                            <div className="form-group">
                              <label className="form-label">プリロード時間足</label>
                              <CustomSelect
                                value={preloadTimeframe}
                                onChange={setPreloadTimeframe}
                                options={[
                                  { value: "AUTO", label: "自動" },
                                  { value: "M1", label: "1分足 (M1)" },
                                  { value: "M5", label: "5分足 (M5)" },
                                  { value: "M15", label: "15分足 (M15)" },
                                  { value: "M30", label: "30分足 (M30)" },
                                  { value: "H1", label: "1時間足 (H1)" },
                                  { value: "H4", label: "4時間足 (H4)" },
                                  { value: "D1", label: "日足 (D1)" }
                                ]}
                              />
                            </div>
                            <div className="form-group">
                              <label className="form-label">プレロードバー数</label>
                              <input
                                type="number"
                                className="pro-input"
                                value={preloadedBars}
                                onChange={(e) => setPreloadedBars(parseInt(e.target.value) || 0)}
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="form-group">
                            <label className="form-label">プリロード開始日時 ({timezoneMode})</label>
                            <div className="input-with-button-container">
                              <input
                                type="text"
                                readOnly
                                className="pro-input input-with-button cursor-pointer"
                                value={timezoneMode === "JST" ? preloadDate : getNewsTimeForDisplay(preloadDate, "SERVER")}
                                onClick={() => setActivePickerField("preload")}
                                placeholder="YYYY-MM-DD HH:mm:ss"
                              />
                              <button
                                type="button"
                                className="input-inline-btn"
                                onClick={() => setActivePickerField("preload")}
                                title="カレンダーで選択"
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>calendar_today</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      <div style={{ borderTop: "1px solid var(--outline-variant)", paddingTop: "10px", marginTop: "4px" }}>
                        <div className="form-group">
                          <label className="checkbox-group">
                            <input
                              type="checkbox"
                              checked={limitTickHistory}
                              onChange={(e) => setLimitTickHistory(e.target.checked)}
                            />
                            <span className="form-label" style={{ textTransform: "none", cursor: "pointer" }}>直近ティック履歴の制限 (高速シーク)</span>
                          </label>

                          {limitTickHistory && (
                            <div className="setup-card-grid-2" style={{ marginTop: "8px" }}>
                              <div className="form-group">
                                <label className="form-label">最大時間足</label>
                                <CustomSelect
                                  value={tickHistoryTimeframe}
                                  onChange={setTickHistoryTimeframe}
                                  options={[
                                    { value: "M1", label: "1分足 (M1)" },
                                    { value: "M5", label: "5分足 (M5)" },
                                    { value: "M15", label: "15分足 (M15)" },
                                    { value: "M30", label: "30分足 (M30)" },
                                    { value: "H1", label: "1時間足 (H1)" },
                                    { value: "H4", label: "4時間足 (H4)" },
                                    { value: "D1", label: "日足 (D1)" }
                                  ]}
                                />
                              </div>
                              <div className="form-group">
                                <label className="form-label">保持バー本数</label>
                                <input
                                  type="number"
                                  className="pro-input"
                                  value={maxHistoryBars}
                                  onChange={(e) => setMaxHistoryBars(parseInt(e.target.value) || 0)}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* グループ4: 表示・同期オプション */}
                  <div className="setup-card full-width">
                    <div className="setup-card-header">
                      <div className="setup-card-title">
                        <span className="material-symbols-outlined">settings_suggest</span>
                        表示・同期オプション
                      </div>
                    </div>
                    <div className="setup-card-body">
                      <div className="setup-card-grid-2">
                        <label className="setup-checkbox-item">
                          <input
                            type="checkbox"
                            checked={autoScrollSync}
                            onChange={(e) => setAutoScrollSync(e.target.checked)}
                          />
                          <span className="setup-checkbox-label">チャート自動スクロール同期</span>
                        </label>
                        <label className="setup-checkbox-item">
                          <input
                            type="checkbox"
                            checked={newsAutoScroll}
                            onChange={(e) => setNewsAutoScroll(e.target.checked)}
                          />
                          <span className="setup-checkbox-label">指標ニュースの自動スクロール</span>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="setup-grid-container" style={{ display: setupTab === "trading" ? "grid" : "none" }}>
                  {/* グループ1: 仮想トレード機能の有効化トグル */}
                  <div className="setup-card full-width">
                    <div className="setup-toggle-block">
                      <div className="setup-toggle-info">
                        <span className="setup-toggle-title">仮想トレード機能</span>
                        <span className="setup-toggle-desc">有効にすると、ダッシュボードや発注窓を利用したデモトレード機能が使用可能になります。</span>
                      </div>
                      <label className="speed-switch">
                        <input
                          type="checkbox"
                          checked={enableVirtualTrading}
                          onChange={(e) => setEnableVirtualTrading(e.target.checked)}
                        />
                        <span className="speed-switch-slider"></span>
                      </label>
                    </div>
                  </div>

                  {enableVirtualTrading && (
                    <>
                      {/* グループ2: 口座・取引設定 */}
                      <div className="setup-card">
                        <div className="setup-card-header">
                          <div className="setup-card-title">
                            <span className="material-symbols-outlined">account_balance_wallet</span>
                            口座・取引設定
                          </div>
                        </div>
                        <div className="setup-card-body">
                          <div className="form-group">
                            <label className="form-label">初期口座残高</label>
                            <input
                              type="number"
                              step="10000"
                              min="0"
                              className="pro-input"
                              value={initialBalance}
                              onChange={(e) => setInitialBalance(Math.max(0, parseInt(e.target.value) || 0))}
                            />
                          </div>

                          <div className="form-group">
                            <label className="form-label">レバレッジ</label>
                            <input
                              type="number"
                              step="1"
                              min="1"
                              className="pro-input"
                              value={leverage}
                              onChange={(e) => setLeverage(Math.max(1, parseInt(e.target.value) || 1))}
                            />
                          </div>

                          <div className="form-group">
                            <label className="form-label">ロット単位</label>
                            <CustomSelect
                              value={contractSize}
                              onChange={(val) => {
                                const intVal = typeof val === "number" ? val : parseInt(val, 10);
                                setContractSize(intVal);
                                localStorage.setItem("speed-order-contract-size", String(intVal));
                              }}
                              options={[
                                { value: 100000, label: "10万通貨 (Standard)" },
                                { value: 10000, label: "1万通貨 (Mini)" },
                                { value: 1000, label: "1,000通貨 (Micro)" }
                              ]}
                            />
                          </div>

                          <div className="setup-toggle-block" style={{ marginTop: "4px", padding: "8px 10px" }}>
                            <div className="setup-toggle-info">
                              <span className="setup-toggle-title" style={{ fontSize: "11px" }}>両建て設定</span>
                              <span className="setup-toggle-desc" style={{ fontSize: "9px" }}>買い・売りポジションの同時保有を許可</span>
                            </div>
                            <label className="speed-switch">
                              <input
                                type="checkbox"
                                checked={hedging}
                                onChange={(e) => setHedging(e.target.checked)}
                              />
                              <span className="speed-switch-slider"></span>
                            </label>
                          </div>
                        </div>
                      </div>

                      {/* グループ3: 疑似レート生成設定 */}
                      <div className="setup-card">
                        <div className="setup-card-header">
                          <div className="setup-card-title">
                            <span className="material-symbols-outlined">tune</span>
                            疑似レート生成設定
                          </div>
                        </div>
                        <div className="setup-card-body">
                          <div className="setup-toggle-block" style={{ padding: "8px 10px" }}>
                            <div className="setup-toggle-info">
                              <span className="setup-toggle-title" style={{ fontSize: "11px" }}>疑似レート生成機能</span>
                              <span className="setup-toggle-desc" style={{ fontSize: "9px" }}>スプレッド調整等のレートで取引執行</span>
                            </div>
                            <label className="speed-switch">
                              <input
                                type="checkbox"
                                checked={enablePseudoRate}
                                onChange={(e) => setEnablePseudoRate(e.target.checked)}
                              />
                              <span className="speed-switch-slider"></span>
                            </label>
                          </div>

                          {enablePseudoRate && (
                            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "4px" }}>
                              <div className="form-group">
                                <label className="form-label">国内基準スプレッド</label>
                                <input
                                  type="number"
                                  step="any"
                                  min="0"
                                  className="pro-input"
                                  value={pseudoBaseSpread}
                                  onChange={(e) => setPseudoBaseSpread(parseFloat(e.target.value) || 0)}
                                />
                              </div>

                              <div className="form-group">
                                <label className="form-label">MT5側判定閾値</label>
                                <input
                                  type="number"
                                  step="any"
                                  min="0"
                                  className="pro-input"
                                  value={pseudoThreshold}
                                  onChange={(e) => setPseudoThreshold(parseFloat(e.target.value) || 0)}
                                />
                              </div>

                              <div className="form-group">
                                <label className="form-label">拡大感度係数</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max="2"
                                  className="pro-input"
                                  value={pseudoSensitivity}
                                  onChange={(e) => setPseudoSensitivity(parseFloat(e.target.value) || 0)}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* 保存されたセッション再開タブ */}
                {setupTab === "resume" && (() => {
                  // 固有のセッショングループごとにセッションを分類
                  const groupedSessions: { [key: string]: any[] } = {};
                  savedSessions.forEach((session) => {
                    const gid = session.group_session_id || session.id;
                    if (!groupedSessions[gid]) {
                      groupedSessions[gid] = [];
                    }
                    groupedSessions[gid].push(session);
                  });

                  // 各グループ内のセッションを保存日時の降順（新しい順）にソート
                  Object.keys(groupedSessions).forEach((gid) => {
                    groupedSessions[gid].sort((a, b) => {
                      return new Date(b.saved_at).getTime() - new Date(a.saved_at).getTime();
                    });
                  });

                  // グループ自身を、そのグループの最新セッションの保存日時降順（新しい順）にソート
                  const sortedGroupIds = Object.keys(groupedSessions).sort((a, b) => {
                    const aLatest = groupedSessions[a][0];
                    const bLatest = groupedSessions[b][0];
                    return new Date(bLatest.saved_at).getTime() - new Date(aLatest.saved_at).getTime();
                  });

                  return (
                    <div className="saved-sessions-container" style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "4px" }}>
                      {savedSessions.length > 0 && (
                        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "2px" }}>
                          <button
                            className="pro-btn danger"
                            style={{ padding: "4px 8px", fontSize: "10px", height: "24px" }}
                            onClick={handleClearAllSessions}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>delete_sweep</span>
                            全セッション削除
                          </button>
                        </div>
                      )}

                      {savedSessions.length === 0 ? (
                        <div className="no-sessions-fallback" style={{ padding: "40px 20px", textAlign: "center", backgroundColor: "var(--surface-container)", borderRadius: "var(--radius-sm)", border: "1px dashed var(--outline-variant)", color: "var(--on-surface-variant)" }}>
                          <span className="material-symbols-outlined" style={{ fontSize: "48px", opacity: 0.5, marginBottom: "8px" }}>drafts</span>
                          <p style={{ fontSize: "12px" }}>保存されたセッションはありません。</p>
                        </div>
                      ) : (
                        sortedGroupIds.map((gid) => {
                          const groupList = groupedSessions[gid];
                          const latestSession = groupList[0];

                          const progressPercent = latestSession.progress.total_ticks > 0
                            ? ((latestSession.progress.current_idx / latestSession.progress.total_ticks) * 100).toFixed(1)
                            : "0.0";
                          const balanceStr = latestSession.virtual_trade
                            ? `${latestSession.virtual_trade.balance.toLocaleString()} JPY`
                            : "口座データなし";
                          const posCount = latestSession.virtual_trade?.positions?.length || 0;
                          const histCount = latestSession.virtual_trade?.history?.length || 0;
                          const jstTimeStr = latestSession.progress.virtual_time_msc > 0
                            ? formatJstTime(latestSession.progress.virtual_time_msc)
                            : "時刻情報なし";

                          const isExpanded = !!expandedGroups[gid];

                          return (
                            <div
                              key={gid}
                              className="session-card"
                              style={{
                                padding: "12px 14px",
                                backgroundColor: "var(--surface-container)",
                                borderRadius: "var(--radius-sm)",
                                border: "1px solid var(--outline-variant)",
                                display: "flex",
                                flexDirection: "column",
                                gap: "8px",
                                transition: "all 0.2s ease"
                              }}
                            >
                              <div className="session-card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div>
                                  <h4 style={{ margin: 0, fontSize: "13px", fontWeight: 600, color: "var(--on-surface)", display: "flex", alignItems: "center", gap: "6px" }}>
                                    {latestSession.name}
                                    {groupList.length > 1 && (
                                      <span style={{ fontSize: "10px", color: "var(--primary-color)", fontWeight: "normal" }}>
                                        (履歴 {groupList.length} 件)
                                      </span>
                                    )}
                                  </h4>
                                  <span style={{ fontSize: "9px", color: "var(--on-surface-variant)" }}>
                                    最終保存: {new Date(latestSession.saved_at).toLocaleString("ja-JP")}
                                  </span>
                                </div>
                                <span
                                  className="session-badge"
                                  style={{
                                    padding: "2px 6px",
                                    fontSize: "9px",
                                    fontWeight: 600,
                                    borderRadius: "4px",
                                    backgroundColor: "rgba(var(--primary-rgb), 0.15)",
                                    color: "var(--primary-color)",
                                    border: "1px solid rgba(var(--primary-rgb), 0.3)"
                                  }}
                                >
                                  {latestSession.settings.source_symbol} ({latestSession.settings.selected_profile})
                                </span>
                              </div>

                              <div className="session-card-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "10px", color: "var(--on-surface-variant)" }}>
                                <div>
                                  <div><strong>進行状況:</strong> {latestSession.progress.current_idx.toLocaleString()} / {latestSession.progress.total_ticks.toLocaleString()} ({progressPercent}%)</div>
                                  <div><strong>仮想時刻:</strong> {jstTimeStr}</div>
                                </div>
                                <div>
                                  <div><strong>残高:</strong> {balanceStr}</div>
                                  <div><strong>ポジション:</strong> 保有 {posCount} / 決済 {histCount}</div>
                                </div>
                              </div>

                              <div className="session-card-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--outline-variant)", paddingTop: "8px", marginTop: "4px" }}>
                                {groupList.length > 1 ? (
                                  <button
                                    className="pro-btn"
                                    style={{ padding: "4px 8px", fontSize: "10px", height: "22px", display: "flex", alignItems: "center", gap: "2px" }}
                                    onClick={() => setExpandedGroups(prev => ({ ...prev, [gid]: !prev[gid] }))}
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
                                      {isExpanded ? "expand_less" : "expand_more"}
                                    </span>
                                    {isExpanded ? "履歴を非表示" : `履歴を表示 (${groupList.length - 1}件)`}
                                  </button>
                                ) : (
                                  <div></div>
                                )}
                                <div style={{ display: "flex", gap: "8px" }}>
                                  <button
                                    className="pro-btn danger"
                                    style={{ padding: "4px 8px", fontSize: "10px", height: "22px" }}
                                    onClick={() => {
                                      handleDeleteSessions(
                                        groupList.map(s => s.id),
                                        `このセッションおよび関連するすべての履歴（全 ${groupList.length} 件）を完全に削除しますか？この操作は取り消せません。`
                                      );
                                    }}
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: "11px" }}>delete</span>
                                    全削除
                                  </button>
                                  <button
                                    className="pro-btn primary"
                                    style={{ padding: "4px 12px", fontSize: "10px", height: "22px" }}
                                    onClick={() => handleResumeSession(latestSession)}
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: "11px" }}>play_arrow</span>
                                    再開
                                  </button>
                                </div>
                              </div>

                              {/* 履歴リスト（アコーディオン） */}
                              {isExpanded && (
                                <div
                                  className="session-history-list"
                                  style={{
                                    marginTop: "6px",
                                    padding: "8px 10px",
                                    backgroundColor: "rgba(0, 0, 0, 0.15)",
                                    borderRadius: "var(--radius-sm)",
                                    border: "1px solid rgba(255, 255, 255, 0.05)",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "6px"
                                  }}
                                >
                                  <div style={{ fontSize: "9px", fontWeight: 600, color: "var(--on-surface-variant)", borderBottom: "1px solid rgba(255, 255, 255, 0.05)", paddingBottom: "4px", marginBottom: "2px" }}>
                                    保存履歴 (時系列順 - 新しい順)
                                  </div>
                                  {groupList.map((snap, index) => {
                                    const snapPercent = snap.progress.total_ticks > 0
                                      ? ((snap.progress.current_idx / snap.progress.total_ticks) * 100).toFixed(1)
                                      : "0.0";
                                    const snapJstTime = snap.progress.virtual_time_msc > 0
                                      ? formatJstTime(snap.progress.virtual_time_msc)
                                      : "時刻情報なし";
                                    const snapBalance = snap.virtual_trade
                                      ? `${snap.virtual_trade.balance.toLocaleString()} JPY`
                                      : "口座データなし";
                                    const isSnapLatest = index === 0;

                                    return (
                                      <div
                                        key={snap.id}
                                        style={{
                                          display: "flex",
                                          justifyContent: "space-between",
                                          alignItems: "center",
                                          fontSize: "10px",
                                          padding: "4px 6px",
                                          borderRadius: "4px",
                                          backgroundColor: isSnapLatest ? "rgba(255, 255, 255, 0.05)" : "transparent"
                                        }}
                                      >
                                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                          <div style={{ fontWeight: 500, color: "var(--on-surface)", display: "flex", alignItems: "center", gap: "4px" }}>
                                            <span>{snap.name}</span>
                                            {isSnapLatest && (
                                              <span style={{ fontSize: "8px", padding: "1px 4px", borderRadius: "3px", backgroundColor: "rgba(var(--primary-rgb), 0.2)", color: "var(--primary-color)" }}>
                                                最新
                                              </span>
                                            )}
                                          </div>
                                          <div style={{ fontSize: "9px", color: "var(--on-surface-variant)" }}>
                                            保存時刻: {new Date(snap.saved_at).toLocaleString("ja-JP")} | 進行: {snapPercent}% | 仮想時刻: {snapJstTime} | 残高: {snapBalance}
                                          </div>
                                        </div>
                                        <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                                          <button
                                            className="pro-btn danger"
                                            style={{ padding: "2px 6px", fontSize: "9px", height: "18px" }}
                                            onClick={() => {
                                              handleDeleteSessions(
                                                [snap.id],
                                                `この履歴（スナップショット「${snap.name}」）を削除しますか？この操作は取り消せません。`
                                              );
                                            }}
                                          >
                                            削除
                                          </button>
                                          <button
                                            className="pro-btn primary"
                                            style={{ padding: "2px 8px", fontSize: "9px", height: "18px" }}
                                            onClick={() => handleResumeSession(snap)}
                                          >
                                            再開
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  );
                })()}
              </div>

              {setupTab !== "resume" && (
                <div style={{ display: "flex", gap: "8px", marginTop: "4px", flexShrink: 0 }}>
                  <button
                    type="button"
                    className="pro-btn pro-btn-square"
                    style={{ height: "38px", width: "38px", padding: 0, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                    onClick={setupTab === "replay" ? handleResetReplaySettings : handleResetTradingSettings}
                    title={setupTab === "replay" ? "リプレイ設定をデフォルトに戻す" : "取引設定をデフォルトに戻す"}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>restart_alt</span>
                  </button>
                  <button
                    className="pro-btn primary pro-glow"
                    style={{ flex: 1, padding: "8px 10px", fontSize: "13px" }}
                    onClick={status === "DISCONNECTED" ? handleCheckConnection : handleInit}
                  >
                    {status === "DISCONNECTED" ? "Waiting for EA... (Click to Refresh)" : "リプレイ開始"}
                  </button>
                </div>
              )}

              {status === "DISCONNECTED" && (
                <div className="setup-hint" style={{ marginTop: "8px", flexShrink: 0 }}>
                  <p>MT5チャートに <strong>TickReplayControllerEA</strong> を適用してください。</p>
                  <p>EAは選択されたターミナルの Experts フォルダに自動配置されています。</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* B. Playback Control Dashboard */
          currentViewMode === "trade" ? (
            <TradeReportDashboard
              account={account}
              positions={positions}
              history={history}
              sendCommand={sendCommand}
              setCurrentViewMode={setCurrentViewMode}
              initialBalance={initialBalance}
              leverage={leverage}
              holdingTimeMode={holdingTimeMode}
            />
          ) : (
            <>
              {/* Timeline Panel */}
              <div className="pro-panel timeline-panel">
                <div className="pro-panel-header">
                  <h3 className="pro-panel-title" title="Market Timeline Overview" style={{ cursor: "pointer" }}>
                    <span className="material-symbols-outlined icon-accent">timeline</span>
                  </h3>
                  <div className="timeline-header-info">
                    <span className="timeline-meta-tick">
                      Tick: <span className="timeline-meta-val">{currentIdx}</span> / {totalTicks}
                    </span>
                    <span className="timeline-meta-percent">{progressPercent.toFixed(1)}%</span>
                    <span className="pro-panel-meta timeline-cycle-badge">24H CYCLE</span>
                  </div>
                </div>
                <div className="pro-panel-body" style={{ padding: "4px 8px" }}>
                  <div className="timeline-wrapper">
                    <div className="timeline-track">
                      <svg
                        style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}
                        onMouseDown={handleTimelineMouseDown}
                      >
                        {renderTimelineRects()}

                        {loopAIdx !== -1 && totalTicks > 0 && (
                          <>
                            <line
                              x1={`${(loopAIdx / totalTicks) * 100}%`}
                              y1="0"
                              x2={`${(loopAIdx / totalTicks) * 100}%`}
                              y2="100%"
                              stroke="var(--primary-color)"
                              strokeWidth="2"
                              strokeDasharray="4,4"
                            />
                            {loopBIdx !== -1 && (
                              <>
                                <line
                                  x1={`${(loopBIdx / totalTicks) * 100}%`}
                                  y1="0"
                                  x2={`${(loopBIdx / totalTicks) * 100}%`}
                                  y2="100%"
                                  stroke="var(--primary-color)"
                                  strokeWidth="2"
                                  strokeDasharray="4,4"
                                />
                                <rect
                                  x={`${(loopAIdx / totalTicks) * 100}%`}
                                  y="0"
                                  width={`${((loopBIdx - loopAIdx) / totalTicks) * 100}%`}
                                  height="100%"
                                  fill="var(--primary-color)"
                                  opacity="0.15"
                                />
                              </>
                            )}
                          </>
                        )}

                        <line
                          x1={`${progressPercent}%`}
                          y1="0"
                          x2={`${progressPercent}%`}
                          y2="100%"
                          stroke="var(--timeline-playhead, #ffffff)"
                          strokeWidth="2"
                        />
                        <circle
                          cx={`${progressPercent}%`}
                          cy="50%"
                          r="4"
                          fill="var(--primary-color)"
                          stroke="var(--timeline-playhead-border, #ffffff)"
                          strokeWidth="1"
                        />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>

              {/* Columns Grid */}
              <div className="cols-grid">
                {/* Left Column: Transport & Jump Matrix */}
                <div className="col-left">
                  {/* Transport Panel */}
                  <div className="pro-panel">
                    <div className="pro-panel-header" style={{ padding: "4px 8px 4px 12px", minWidth: 0, gap: "8px" }}>
                      <h3 className="pro-panel-title" title="Transport" style={{ flexShrink: 0, cursor: "pointer" }}>
                        <span className="material-symbols-outlined icon-accent">play_circle</span>
                      </h3>

                      {/* Presets Pills Inline (Header Move) */}
                      <div className="transport-presets-inline" style={{ flex: 1, justifyContent: "center" }}>
                        {speedMode === "TEMPORAL" ? (
                          timePresets.map((preset) => {
                            const label = `${preset}x`;
                            const isActive = Math.abs(preset - multiplier) < 0.01;
                            return (
                              <button
                                key={preset}
                                className={`preset-pill-btn ${isActive ? "active" : ""}`}
                                onClick={() => updateSpeed("TEMPORAL", preset, tickStep)}
                              >
                                {label}
                              </button>
                            );
                          })
                        ) : (
                          tickPresets.map((preset) => {
                            const isActive = preset === tickStep;
                            return (
                              <button
                                key={preset}
                                className={`preset-pill-btn ${isActive ? "active" : ""}`}
                                onClick={() => updateSpeed("COUNT", multiplier, preset)}
                              >
                                {preset}T
                              </button>
                            );
                          })
                        )}
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                        <button
                          className="toggle-btn"
                          style={{ padding: "2px 6px", height: "18px", fontSize: "10px", display: "inline-flex", alignItems: "center", gap: "3px" }}
                          onClick={() => {
                            setEditingTimePresets([...timePresets]);
                            setEditingTickPresets([...tickPresets]);
                            setModalNewTimePreset("");
                            setModalNewTickPreset("");
                            setIsSpeedPresetsModalOpen(true);
                          }}
                          title="再生速度・スキップティックのプリセットを編集"
                        >
                          <span className="material-symbols-outlined text-[12px]">tune</span>
                          <span>Preset設定</span>
                        </button>

                        <button
                          className={`toggle-btn ${speedMode === "TEMPORAL" ? "active" : ""}`}
                          style={{
                            padding: "2px 8px",
                            height: "18px",
                            fontSize: "10px",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "3px",
                            fontWeight: 600,
                            fontFamily: "var(--font-data)"
                          }}
                          onClick={() => updateSpeed(speedMode === "TEMPORAL" ? "COUNT" : "TEMPORAL", multiplier, tickStep)}
                          title="再生モード切替 (Time Mode / Tick Mode)"
                        >
                          <span className="material-symbols-outlined text-[12px]">
                            {speedMode === "TEMPORAL" ? "schedule" : "tag"}
                          </span>
                          <span>{speedMode === "TEMPORAL" ? "TIME MODE" : "TICK MODE"}</span>
                        </button>
                      </div>
                    </div>
                    <div className="pro-panel-body transport-panel-body">
                      {/* Playback Controls Group (Compact) */}
                      <div className="transport-playback-group">
                        <button className="pro-btn pro-btn-compact" onClick={() => handleStep(-1)} title="Previous Step">
                          <span className="material-symbols-outlined text-[16px]">skip_previous</span>
                        </button>
                        <button
                          className={`pro-btn pro-btn-compact-play pro-glow ${isPlaying ? "active-loop" : "primary"}`}
                          onClick={handlePlayPause}
                          title={isPlaying ? "Pause (Space)" : "Play (Space)"}
                        >
                          <span className="material-symbols-outlined text-[22px]">{isPlaying ? "pause" : "play_arrow"}</span>
                        </button>
                        <button className="pro-btn pro-btn-compact" onClick={() => handleStep(1)} title="Next Step">
                          <span className="material-symbols-outlined text-[16px]">skip_next</span>
                        </button>
                      </div>

                      <div className="transport-v-divider"></div>

                      {/* Single Horizontal Speed Toolbar */}
                      <div className="transport-speed-inline-bar">
                        {/* Integrated Multi-tier Speed Stepper */}
                        <div className="speed-precision-stepper">
                          <button
                            className="stepper-btn coarse"
                            onClick={() => handleCoarseSpeed(false)}
                            title="プリセット切り替え Down (左のプリセットへジャンプ)"
                          >
                            &lt;&lt;
                          </button>
                          <button
                            className="stepper-btn medium"
                            onClick={() => handleMediumSpeed(false)}
                            title={speedMode === "TEMPORAL" ? "1.0刻み Down (-1.0x)" : "10刻み Down (-10T)"}
                          >
                            &lt;
                          </button>
                          <button
                            className="stepper-btn fine"
                            onClick={() => handleFineSpeed(false)}
                            title={speedMode === "TEMPORAL" ? "0.1刻み Down (-0.1x)" : "1刻み Down (-1T)"}
                          >
                            -
                          </button>
                          <div className="stepper-display">
                            <span className="stepper-value">
                              {speedMode === "TEMPORAL" ? `${multiplier.toFixed(1)}x` : `${tickStep}T`}
                            </span>
                          </div>
                          <button
                            className="stepper-btn fine"
                            onClick={() => handleFineSpeed(true)}
                            title={speedMode === "TEMPORAL" ? "0.1刻み Up (+0.1x)" : "1刻み Up (+1T)"}
                          >
                            +
                          </button>
                          <button
                            className="stepper-btn medium"
                            onClick={() => handleMediumSpeed(true)}
                            title={speedMode === "TEMPORAL" ? "1.0刻み Up (+1.0x)" : "10刻み Up (+10T)"}
                          >
                            &gt;
                          </button>
                          <button
                            className="stepper-btn coarse"
                            onClick={() => handleCoarseSpeed(true)}
                            title="プリセット切り替え Up (右のプリセットへジャンプ)"
                          >
                            &gt;&gt;
                          </button>
                        </div>
                      </div>

                      <div className="transport-v-divider"></div>

                      {/* Loop Controls Group */}
                      <div className="transport-loop-group">
                        <span className="loop-group-label">Loop {loopActive && "•"}</span>
                        <div className="loop-btn-group">
                          <button
                            className={`pro-btn loop-btn ${loopA !== -1 ? "active-loop" : ""}`}
                            onClick={handleSetLoopA}
                            title="Set Loop Point A"
                          >
                            A
                          </button>
                          <button
                            className="pro-btn loop-btn loop-clear-btn"
                            onClick={handleClearLoop}
                            title="Clear Loop Points"
                          >
                            <span className="material-symbols-outlined text-[12px]">sync_disabled</span>
                          </button>
                          <button
                            className={`pro-btn loop-btn ${loopB !== -1 ? "active-loop" : ""}`}
                            onClick={handleSetLoopB}
                            title="Set Loop Point B"
                          >
                            B
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Navigation Matrix Panel */}
                  <div className="pro-panel" style={{ flex: 1, minWidth: 0 }}>
                    <div className="pro-panel-header" style={{ padding: "6px 8px", minWidth: 0, gap: "6px" }}>
                      <h3 className="pro-panel-title" title="Navigation Matrix" style={{ flexShrink: 0, cursor: "pointer" }}>
                        <span className="material-symbols-outlined icon-accent">grid_view</span>
                      </h3>
                      <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
                        <button
                          className="toggle-btn"
                          style={{ padding: "2px 5px", height: "18px", fontSize: "10px", display: "inline-flex", alignItems: "center", gap: "2px" }}
                          onClick={() => {
                            setEditingTimeSteps([...timeSteps]);
                            setIsTimeStepsModalOpen(true);
                          }}
                          title="タイムステップを編集 (最大5つ)"
                        >
                          <span className="material-symbols-outlined text-[12px]">tune</span>
                          <span>Step設定</span>
                        </button>
                        <span style={{ fontSize: "9.5px", color: "var(--on-surface-variant)", marginLeft: "2px" }}>Day:</span>
                        <button className="toggle-btn" style={{ padding: 0, width: "16px", height: "16px", display: "inline-flex", alignItems: "center", justifyContent: "center" }} onClick={() => handleSessionJump("ANY", "PREV")} title="Previous Day">
                          <span className="material-symbols-outlined text-[12px]" style={{ lineHeight: 1 }}>chevron_left</span>
                        </button>
                        <span className="font-data" style={{ fontSize: "10px", color: "var(--primary-color)", backgroundColor: "rgba(var(--primary-rgb), 0.12)", padding: "1px 5px", borderRadius: "3px", fontWeight: 600 }}>
                          {getDayOffset()}
                        </span>
                        <button className="toggle-btn" style={{ padding: 0, width: "16px", height: "16px", display: "inline-flex", alignItems: "center", justifyContent: "center" }} onClick={() => handleSessionJump("ANY", "NEXT")} title="Next Day">
                          <span className="material-symbols-outlined text-[12px]" style={{ lineHeight: 1 }}>chevron_right</span>
                        </button>
                      </div>
                    </div>
                    <div className="pro-panel-body nav-matrix-compact-body">
                      {/* Row 1: Session Jump */}
                      <div className="session-jump-grid">
                        {/* Tokyo */}
                        <div className="session-stepper-card tyo">
                          <button className="session-stepper-btn" onClick={() => handleSessionJump("TYO", "PREV")} title="Previous Tokyo Session">
                            <span className="material-symbols-outlined">remove</span>
                          </button>
                          <button className="session-pill tyo" onClick={() => handleSessionJump("TYO", "NEXT")} title="Jump to Tokyo Session">
                            <span className="session-pill-dot tyo"></span>
                            <div className="session-pill-text">
                              <span className="session-pill-name">Tokyo</span>
                              <span className="session-pill-time">09:00</span>
                            </div>
                          </button>
                          <button className="session-stepper-btn" onClick={() => handleSessionJump("TYO", "NEXT")} title="Next Tokyo Session">
                            <span className="material-symbols-outlined">add</span>
                          </button>
                        </div>

                        {/* London */}
                        <div className="session-stepper-card ldn">
                          <button className="session-stepper-btn" onClick={() => handleSessionJump("LDN", "PREV")} title="Previous London Session">
                            <span className="material-symbols-outlined">remove</span>
                          </button>
                          <button className="session-pill ldn" onClick={() => handleSessionJump("LDN", "NEXT")} title="Jump to London Session">
                            <span className="session-pill-dot ldn"></span>
                            <div className="session-pill-text">
                              <span className="session-pill-name">London</span>
                              <span className="session-pill-time">16:00</span>
                            </div>
                          </button>
                          <button className="session-stepper-btn" onClick={() => handleSessionJump("LDN", "NEXT")} title="Next London Session">
                            <span className="material-symbols-outlined">add</span>
                          </button>
                        </div>

                        {/* New York */}
                        <div className="session-stepper-card ny">
                          <button className="session-stepper-btn" onClick={() => handleSessionJump("NY", "PREV")} title="Previous New York Session">
                            <span className="material-symbols-outlined">remove</span>
                          </button>
                          <button className="session-pill ny" onClick={() => handleSessionJump("NY", "NEXT")} title="Jump to New York Session">
                            <span className="session-pill-dot ny"></span>
                            <div className="session-pill-text">
                              <span className="session-pill-name">New York</span>
                              <span className="session-pill-time">21:00</span>
                            </div>
                          </button>
                          <button className="session-stepper-btn" onClick={() => handleSessionJump("NY", "NEXT")} title="Next New York Session">
                            <span className="material-symbols-outlined">add</span>
                          </button>
                        </div>
                      </div>

                      {/* Row 2: Time Steps */}
                      <div className="time-steps-horizontal-grid" style={{ gridTemplateColumns: `repeat(${timeSteps.length}, minmax(0, 1fr))` }}>
                        {timeSteps.map((step) => (
                          <div className="time-step-card" key={step.id}>
                            <button className="time-step-btn" onClick={() => handleTimeJump(-step.seconds)} title={`-${step.label}`}>
                              <span className="material-symbols-outlined">remove</span>
                            </button>
                            <span className="time-step-val">{step.label}</span>
                            <button className="time-step-btn" onClick={() => handleTimeJump(step.seconds)} title={`+${step.label}`}>
                              <span className="material-symbols-outlined">add</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Column: Economic Impact Calendar */}
                <div className="col-right">
                  <div className="pro-panel" style={{ flex: 1 }}>
                    <div className="pro-panel-header">
                      <h3 className="pro-panel-title" title="News Impact List" style={{ cursor: "pointer" }}>
                        <span className="material-symbols-outlined icon-accent">monitoring</span>
                      </h3>
                      <span className="font-data" style={{ fontSize: "9px", color: "var(--primary-color)", backgroundColor: "rgba(var(--primary-rgb), 0.1)", padding: "2px 6px", borderRadius: "2px" }}>
                        SYNCED
                      </span>
                    </div>
                    <div className="pro-panel-body" style={{ flex: 1 }}>
                      <div ref={newsContainerRef} className="news-table-container">
                        <table className="news-table">
                          <thead>
                            <tr>
                              <th className="news-th" style={{ width: "45px" }}>Time</th>
                              <th className="news-th" style={{ width: "35px" }}>Ccy</th>
                              <th className="news-th" style={{ width: "20px" }}>Imp</th>
                              <th className="news-th">Event</th>
                              <th className="news-th" style={{ width: "100px", textAlign: "right" }}>Value (Act/For/Pre)</th>
                              <th className="news-th" style={{ width: "60px", textAlign: "center" }}>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredDailyNews.map((item, idx) => {
                              const displayTimeStr = getDisplayNewsTimeStr(item);
                              const eventMsc = parseTimeStrToUtcMs(displayTimeStr);
                              const eventServerMsc = parseTimeStrToUtcMs(convertJstStrToServerStr(item.time));

                              const currentCompareMsc = timezoneMode === "JST"
                                ? virtualTimeMsc + getServerToJstOffsetHours(virtualTimeMsc) * 3600 * 1000
                                : virtualTimeMsc;

                              const isPast = !isNaN(eventMsc) && currentCompareMsc >= eventMsc;
                              const isActive = !isNaN(eventMsc) && Math.abs(currentCompareMsc - eventMsc) <= 15 * 60 * 1000;

                              // 重要度ドットクラス
                              const impClass = item.importance.toLowerCase().replace("_", "-");

                              // 表示する時間のフォーマット (HH:mm)
                              const displayTime = displayTimeStr.substring(11, 16);

                              return (
                                <tr key={idx} className={`news-tr ${isPast ? "past" : ""} ${isActive ? "active-news" : ""}`}>
                                  <td className="news-td news-time">{displayTime}</td>
                                  <td className="news-td news-ccy">
                                    <span className={`ccy-badge ${item.currency.toLowerCase()}`}>{item.currency}</span>
                                  </td>
                                  <td className="news-td">
                                    <span className={`news-dot ${impClass}`} title={`Importance: ${item.importance}`}></span>
                                  </td>
                                  <td className="news-td news-event" title={item.event}>{item.event}</td>
                                  <td className="news-td news-val" style={{ whiteSpace: "nowrap" }}>
                                    <span className="val-act" title="Actual">{item.actual}</span>
                                    <span className="val-divider">/</span>
                                    <span className="val-fore" title="Forecast">{item.forecast}</span>
                                    <span className="val-divider">/</span>
                                    <span className="val-prev" title="Previous">{item.previous}</span>
                                  </td>
                                  <td className="news-td" style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                                    <button
                                      className="news-jump-btn"
                                      onClick={() => handleNewsJump(item.time)}
                                      title={`${item.time} に時間ジャンプ`}
                                    >
                                      <span className="material-symbols-outlined text-[14px]">location_searching</span>
                                    </button>
                                    <button
                                      className="news-ai-btn"
                                      onClick={() => {
                                        setAiTargetTimeMsc(eventServerMsc);
                                        setIsAIPanelOpen(true);
                                      }}
                                      title={`${item.event} 時刻の要因をAI解析`}
                                    >
                                      <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                            {filteredDailyNews.length === 0 && (
                              <tr>
                                <td colSpan={6} style={{ textAlign: "center", color: "var(--on-surface-variant)", padding: "16px 0", fontSize: "11px" }}>
                                  {newsItems.length === 0 ? "指標データがロードされていません。" : "表示対象の指標はありません（日付またはフィルター設定）"}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )
        )}
      </main>

      {/* Status Bar Footer */}
      <footer className="status-bar">
        <div className="status-bar-left">
          SYSTEM_ACTIVE_V2.4 // OBSIDIAN FLUX
        </div>
        <div className="status-bar-right">
          <span className="status-bar-item">
            <span className="status-bar-dot"></span>
            Mode: Desktop
          </span>
          <span className="status-bar-item">
            <span className="status-bar-dot active"></span>
            Engine: Active
          </span>
        </div>
      </footer>
      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="modal-overlay" onClick={() => { if (!recordingAction) setIsSettingsOpen(false); }}>
          <div className="modal-container system-settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">
                <span className="material-symbols-outlined icon-accent">settings</span>
                System & Control Settings
              </h3>
              <button className="modal-close-btn" onClick={() => { if (!recordingAction) setIsSettingsOpen(false); }} disabled={!!recordingAction}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="modal-tabs">
              <button
                className={`modal-tab-btn ${activeTab === "general" ? "active" : ""}`}
                onClick={() => setActiveTab("general")}
              >
                General
              </button>
              <button
                className={`modal-tab-btn ${activeTab === "hotkeys" ? "active" : ""}`}
                onClick={() => setActiveTab("hotkeys")}
              >
                Hotkeys
              </button>
              <button
                className={`modal-tab-btn ${activeTab === "news" ? "active" : ""}`}
                onClick={() => setActiveTab("news")}
              >
                News
              </button>
              <button
                className={`modal-tab-btn ${activeTab === "theme" ? "active" : ""}`}
                onClick={() => setActiveTab("theme")}
              >
                Theme
              </button>
              <button
                className={`modal-tab-btn ${activeTab === "ai" ? "active" : ""}`}
                onClick={() => setActiveTab("ai")}
              >
                AI & Analysis
              </button>
            </div>

            <div className="modal-body">
              {activeTab === "general" && (
                <div className="settings-grid">
                  <div>
                    <h4 className="settings-section-title">リプレイ初期値</h4>
                    <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
                      <div className="form-group">
                        <label className="form-label">プリロードモード</label>
                        <CustomSelect
                          value={preloadMode}
                          onChange={(val) => setPreloadMode(val as "BARS" | "DATE")}
                          options={[
                            { value: "BARS", label: "バー数指定" },
                            { value: "DATE", label: "過去日付指定" }
                          ]}
                        />
                      </div>

                      {preloadMode === "BARS" ? (
                        <div style={{ display: "flex", gap: "8px" }}>
                          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                            <label className="form-label">プリロード時間足</label>
                            <CustomSelect
                              value={preloadTimeframe}
                              onChange={setPreloadTimeframe}
                              options={[
                                { value: "AUTO", label: "自動" },
                                { value: "M1", label: "1分足 (M1)" },
                                { value: "M5", label: "5分足 (M5)" },
                                { value: "M15", label: "15分足 (M15)" },
                                { value: "M30", label: "30分足 (M30)" },
                                { value: "H1", label: "1時間足 (H1)" },
                                { value: "H4", label: "4時間足 (H4)" },
                                { value: "D1", label: "日足 (D1)" }
                              ]}
                            />
                          </div>
                          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                            <label className="form-label">プレロードバー数</label>
                            <input
                              type="number"
                              className="pro-input"
                              value={preloadedBars}
                              onChange={(e) => setPreloadedBars(parseInt(e.target.value) || 0)}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="form-group">
                          <label className="form-label">過去プリロード開始日 JST</label>
                          <div className="input-with-button-container">
                            <input
                              type="text"
                              readOnly
                              className="pro-input input-with-button cursor-pointer"
                              value={preloadDate}
                              onClick={() => setActivePickerField("preload")}
                              placeholder="YYYY-MM-DD HH:mm:ss"
                            />
                            <button
                              type="button"
                              className="input-inline-btn"
                              onClick={() => setActivePickerField("preload")}
                              title="カレンダーで選択"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>calendar_today</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ marginTop: "12px" }}>
                    <h4 className="settings-section-title">ティック履歴制限設定</h4>
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      <label className="checkbox-group">
                        <input
                          type="checkbox"
                          checked={limitTickHistory}
                          onChange={(e) => setLimitTickHistory(e.target.checked)}
                        />
                        <span className="form-label" style={{ textTransform: "none", cursor: "pointer" }}>直近ティック履歴の制限 (高速シーク)</span>
                      </label>

                      {limitTickHistory && (
                        <div style={{ display: "flex", gap: "12px", marginTop: "4px" }}>
                          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                            <label className="form-label">最大時間足 (インジ使用)</label>
                            <CustomSelect
                              value={tickHistoryTimeframe}
                              onChange={setTickHistoryTimeframe}
                              options={[
                                { value: "M1", label: "1分足 (M1)" },
                                { value: "M5", label: "5分足 (M5)" },
                                { value: "M15", label: "15分足 (M15)" },
                                { value: "M30", label: "30分足 (M30)" },
                                { value: "H1", label: "1時間足 (H1)" },
                                { value: "H4", label: "4時間足 (H4)" },
                                { value: "D1", label: "日足 (D1)" }
                              ]}
                            />
                          </div>
                          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                            <label className="form-label">保持バー本数</label>
                            <input
                              type="number"
                              className="pro-input"
                              value={maxHistoryBars}
                              onChange={(e) => setMaxHistoryBars(parseInt(e.target.value) || 0)}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ marginTop: "12px" }}>
                    <h4 className="settings-section-title">タイムゾーン設定</h4>
                    <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">表示時刻の基準</label>
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          <div className="pro-input" style={{ backgroundColor: "var(--surface-container-low)", opacity: 0.8, display: "flex", alignItems: "center", height: "38px", userSelect: "none" }}>
                            {timezoneMode === "JST" ? "日本時間 JST" : "MT5サーバ時刻 SRV"}
                          </div>
                          <span style={{ fontSize: "10px", color: "var(--on-surface-variant)" }}>
                            ※タイムゾーンの変更はセットアップ画面（Setup Replay Environment）でのみ可能です。
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: "8px" }}>
                    <h4 className="settings-section-title">動作設定</h4>
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      <label className="checkbox-group">
                        <input
                          type="checkbox"
                          checked={autoScrollSync}
                          onChange={(e) => setAutoScrollSync(e.target.checked)}
                        />
                        <span className="form-label" style={{ textTransform: "none", cursor: "pointer" }}>チャート自動スクロールを同期する</span>
                      </label>

                      <label className="checkbox-group">
                        <input
                          type="checkbox"
                          checked={newsAutoScroll}
                          onChange={(e) => {
                            const val = e.target.checked;
                            setNewsAutoScroll(val);
                            saveAllSettings(hotkeys, timePresets, tickPresets, newsFilters, glassEffect, themeMode, val);
                          }}
                        />
                        <span className="form-label" style={{ textTransform: "none", cursor: "pointer" }}>経済指標リストの自動スクロールを有効にする</span>
                      </label>

                      <label className="checkbox-group">
                        <input
                          type="checkbox"
                          checked={autoSkipWeekend}
                          onChange={(e) => handleAutoSkipWeekendToggle(e.target.checked)}
                        />
                        <span className="form-label" style={{ textTransform: "none", cursor: "pointer" }}>時間比率モード時に週末などの休場期間を自動スキップする</span>
                      </label>

                      <label className="checkbox-group">
                        <input
                          type="checkbox"
                          checked={alwaysOnTop}
                          onChange={handleAlwaysOnTopToggle}
                        />
                        <span className="form-label" style={{ textTransform: "none", cursor: "pointer" }}>常に最前面に表示する</span>
                      </label>

                      <label className="checkbox-group">
                        <input
                          type="checkbox"
                          checked={isShortcutsActive}
                          onChange={handleShortcutsToggle}
                        />
                        <span className="form-label" style={{ textTransform: "none", cursor: "pointer" }}>グローバルショートカットキーを有効にする (MT5非フォーカス時も有効)</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "hotkeys" && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div className="settings-info-text" style={{ flex: 1, marginRight: "12px", padding: "8px 12px" }}>
                      設定したい機能の「録音」ボタンをクリックし、割り当てたいキーの組み合わせを押してください。<br />
                      <strong>Escキー</strong>を押すと録音をキャンセルします。
                    </div>
                    <button className="pro-btn danger" onClick={handleResetAllHotkeys}>
                      <span className="material-symbols-outlined text-[14px]">restart_alt</span>
                      初期設定に戻す
                    </button>
                  </div>

                  <div className="hotkey-list">
                    {Object.keys(DEFAULT_HOTKEYS).map(actionKey => {
                      const meta = HOTKEY_METADATA[actionKey] || { name: actionKey, desc: "" };
                      const currentKey = hotkeys[actionKey] || "";
                      const isRecording = recordingAction === actionKey;

                      // 重複チェック
                      const getDuplicateHotkeys = () => {
                        const counts: Record<string, number> = {};
                        Object.values(hotkeys).forEach(val => {
                          if (val && val.trim() !== "") {
                            counts[val] = (counts[val] || 0) + 1;
                          }
                        });
                        return counts;
                      };
                      const dupCounts = getDuplicateHotkeys();
                      const isDuplicate = currentKey && dupCounts[currentKey] > 1;

                      return (
                        <div key={actionKey} className={`hotkey-item ${isDuplicate ? "duplicate" : ""}`}>
                          <div className="hotkey-name-info">
                            <span className="hotkey-name">{meta.name}</span>
                            <span className="hotkey-desc">{meta.desc}</span>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px" }}>
                            {isDuplicate && (
                              <span className="material-symbols-outlined hotkey-warning-badge" title="他の機能とキー設定が重複しています">
                                warning
                              </span>
                            )}
                            <button
                              className={`hotkey-btn-record ${isRecording ? "recording" : ""}`}
                              onClick={() => {
                                if (isRecording) {
                                  setRecordingAction(null);
                                } else {
                                  setRecordingAction(actionKey);
                                }
                              }}
                            >
                              <span className="material-symbols-outlined text-[14px]">
                                {isRecording ? "keyboard_voice" : "keyboard"}
                              </span>
                              {isRecording ? "キー入力待ち..." : formatShortcutForDisplay(currentKey)}
                            </button>
                          </div>

                          <div className="hotkey-actions">
                            <button
                              className="pro-btn pro-btn-square"
                              onClick={() => handleClearHotkey(actionKey)}
                              disabled={!currentKey}
                              title="割り当て解除"
                            >
                              <span className="material-symbols-outlined text-[14px]">backspace</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {activeTab === "news" && (
                <div className="news-settings-container">
                  <div className="news-settings-header">
                    <div className="news-settings-info">
                      <h4 className="settings-section-title" style={{ margin: 0, border: "none" }}>Economic Indicators Filter</h4>
                      <p className="settings-info-text">
                        取得・表示する経済指標の通貨と重要度（インパクト）を選択します。
                      </p>
                    </div>
                    <div className="news-settings-actions">
                      <button
                        className="pro-btn"
                        onClick={() => {
                          setNewsFilters(DEFAULT_NEWS_FILTERS);
                          saveAllSettings(hotkeys, timePresets, tickPresets, DEFAULT_NEWS_FILTERS);
                        }}
                      >
                        <span className="material-symbols-outlined text-[12px]">restart_alt</span>
                        Default
                      </button>
                      <button
                        className="pro-btn"
                        onClick={() => {
                          const allChecked: NewsFilters = {};
                          Object.keys(newsFilters).forEach(key => {
                            allChecked[key] = { low: true, medium: true, high: true, veryHigh: true };
                          });
                          setNewsFilters(allChecked);
                          saveAllSettings(hotkeys, timePresets, tickPresets, allChecked);
                        }}
                      >
                        Check All
                      </button>
                      <button
                        className="pro-btn danger"
                        onClick={() => {
                          const allCleared: NewsFilters = {};
                          Object.keys(newsFilters).forEach(key => {
                            allCleared[key] = { low: false, medium: false, high: false, veryHigh: false };
                          });
                          setNewsFilters(allCleared);
                          saveAllSettings(hotkeys, timePresets, tickPresets, allCleared);
                        }}
                      >
                        Clear All
                      </button>
                    </div>
                  </div>

                  <div className="news-filter-matrix-wrapper">
                    <table className="news-filter-table">
                      <thead>
                        <tr>
                          <th>Currency</th>
                          <th style={{ textAlign: "center", width: "70px" }}>LOW</th>
                          <th style={{ textAlign: "center", width: "70px" }}>MEDIUM</th>
                          <th style={{ textAlign: "center", width: "70px" }}>HIGH</th>
                          <th style={{ textAlign: "center", width: "70px" }}>VERY HIGH</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.keys(newsFilters).map((ccy) => {
                          const filter = newsFilters[ccy];
                          return (
                            <tr key={ccy}>
                              <td className="news-filter-ccy">{ccy === "OTHERS" ? "Others" : ccy}</td>
                              <td style={{ textAlign: "center" }}>
                                <input
                                  type="checkbox"
                                  checked={filter.low}
                                  onChange={(e) => {
                                    const updated = {
                                      ...newsFilters,
                                      [ccy]: { ...filter, low: e.target.checked }
                                    };
                                    setNewsFilters(updated);
                                    saveAllSettings(hotkeys, timePresets, tickPresets, updated);
                                  }}
                                />
                              </td>
                              <td style={{ textAlign: "center" }}>
                                <input
                                  type="checkbox"
                                  checked={filter.medium}
                                  onChange={(e) => {
                                    const updated = {
                                      ...newsFilters,
                                      [ccy]: { ...filter, medium: e.target.checked }
                                    };
                                    setNewsFilters(updated);
                                    saveAllSettings(hotkeys, timePresets, tickPresets, updated);
                                  }}
                                />
                              </td>
                              <td style={{ textAlign: "center" }}>
                                <input
                                  type="checkbox"
                                  checked={filter.high}
                                  onChange={(e) => {
                                    const updated = {
                                      ...newsFilters,
                                      [ccy]: { ...filter, high: e.target.checked }
                                    };
                                    setNewsFilters(updated);
                                    saveAllSettings(hotkeys, timePresets, tickPresets, updated);
                                  }}
                                />
                              </td>
                              <td style={{ textAlign: "center" }}>
                                <input
                                  type="checkbox"
                                  checked={filter.veryHigh}
                                  onChange={(e) => {
                                    const updated = {
                                      ...newsFilters,
                                      [ccy]: { ...filter, veryHigh: e.target.checked }
                                    };
                                    setNewsFilters(updated);
                                    saveAllSettings(hotkeys, timePresets, tickPresets, updated);
                                  }}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === "theme" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div className="settings-section-title" style={{ fontSize: "11px", fontWeight: "600", textTransform: "uppercase", color: "var(--on-surface-variant)", letterSpacing: "0.05em" }}>
                    テーマモード
                  </div>
                  <div className="theme-mode-picker-grid">
                    <div
                      className={`theme-mode-card ${themeMode === "dark" ? "active" : ""}`}
                      onClick={() => {
                        setThemeMode("dark");
                        saveAllSettings(hotkeys, timePresets, tickPresets, newsFilters, glassEffect, "dark");
                      }}
                    >
                      <span className="material-symbols-outlined">dark_mode</span>
                      <span className="theme-name-ja">ダークモード</span>
                      <span className="theme-name-en">Dark Mode</span>
                    </div>
                    <div
                      className={`theme-mode-card ${themeMode === "light" ? "active" : ""}`}
                      onClick={() => {
                        setThemeMode("light");
                        saveAllSettings(hotkeys, timePresets, tickPresets, newsFilters, glassEffect, "light");
                      }}
                    >
                      <span className="material-symbols-outlined">light_mode</span>
                      <span className="theme-name-ja">ライトモード</span>
                      <span className="theme-name-en">Light Mode</span>
                    </div>
                  </div>
                  <div style={{ height: "1px", backgroundColor: "var(--outline-variant)", margin: "4px 0" }} />
                  <div className="settings-section-title" style={{ fontSize: "11px", fontWeight: "600", textTransform: "uppercase", color: "var(--on-surface-variant)", letterSpacing: "0.05em" }}>
                    アクセントカラー
                  </div>
                  <div className="settings-info-text">
                    UIのアクセントカラーを変更して、ツール全体の雰囲気をカスタマイズできます。<br />
                    お好みの色をクリックすると即座に反映され、設定は自動的に保存されます。
                  </div>
                  <div className="theme-picker-grid">
                    {THEME_PRESETS.map((theme) => {
                      const isActive = themeId === theme.id;
                      return (
                        <div
                          key={theme.id}
                          className={`theme-picker-card ${isActive ? "active" : ""}`}
                          onClick={() => setThemeId(theme.id)}
                        >
                          <div
                            className="theme-color-circle"
                            style={{ backgroundColor: theme.color }}
                          />
                          <span className="theme-name-ja">{theme.nameJa}</span>
                          <span className="theme-name-en">{theme.nameEn}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ height: "1px", backgroundColor: "var(--outline-variant)", margin: "8px 0" }} />
                  <div className="settings-section-title" style={{ fontSize: "11px", fontWeight: "600", textTransform: "uppercase", color: "var(--on-surface-variant)", letterSpacing: "0.05em" }}>
                    損益配色設定
                  </div>
                  <div className="settings-info-text">
                    口座実績やポジション一覧の損益・pips表示の配色パターンを選択します。
                  </div>
                  <div className="theme-mode-picker-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                    <div
                      className={`theme-mode-card ${plColorStyle === "red-blue" ? "active" : ""}`}
                      onClick={() => {
                        setPlColorStyle("red-blue");
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ color: plColorStyle === "red-blue" ? "var(--on-primary)" : "#ef4444" }}>trending_up</span>
                      <span className="theme-name-ja">利益: 赤 / 損失: 青</span>
                      <span className="theme-name-en">Profit: Red / Loss: Blue</span>
                    </div>
                    <div
                      className={`theme-mode-card ${plColorStyle === "green-red" ? "active" : ""}`}
                      onClick={() => {
                        setPlColorStyle("green-red");
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ color: plColorStyle === "green-red" ? "var(--on-primary)" : "#10b981" }}>trending_up</span>
                      <span className="theme-name-ja">利益: 緑 / 損失: 赤</span>
                      <span className="theme-name-en">Profit: Green / Loss: Red</span>
                    </div>
                  </div>
                  <div style={{ height: "1px", backgroundColor: "var(--outline-variant)", margin: "8px 0" }} />
                  <div className="settings-section-title" style={{ marginTop: "4px", fontSize: "11px", fontWeight: "600", textTransform: "uppercase", color: "var(--on-surface-variant)", letterSpacing: "0.05em" }}>
                    追加エフェクト
                  </div>
                  <div className="glass-toggle-container" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", backgroundColor: "var(--surface-container-low)", borderRadius: "var(--radius-md)", border: "1px solid var(--outline-variant)" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--on-surface)" }}>
                        ガラス・アクリル風質感 (不透明・軽量)
                      </span>
                      <span style={{ fontSize: "10px", color: "var(--on-surface-variant)" }}>
                        透過やブラーを行わずに、不透明のグラデーションと境界ハイライトでガラスアクリル風の質感を表現します（PC負荷なし）。
                      </span>
                    </div>
                    <label className="pro-switch" style={{ position: "relative", display: "inline-block", width: "40px", height: "20px" }}>
                      <input
                        type="checkbox"
                        checked={glassEffect}
                        onChange={(e) => {
                          const nextVal = e.target.checked;
                          setGlassEffect(nextVal);
                          saveAllSettings(hotkeys, timePresets, tickPresets, newsFilters, nextVal);
                        }}
                        style={{ opacity: 0, width: 0, height: 0 }}
                      />
                      <span className="pro-switch-slider" style={{ position: "absolute", cursor: "pointer", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "var(--outline-variant)", transition: "0.2s", borderRadius: "20px" }} />
                    </label>
                  </div>
                </div>
              )}

              {activeTab === "ai" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <div className="api-test-header-bar">
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--on-surface)" }}>
                        APIキー動作確認・接続テスト
                      </div>
                      <div style={{ fontSize: "10px", color: "var(--on-surface-variant)", marginTop: "2px" }}>
                        設定された各種APIキーが正常に疎通・機能しているかテストできます。
                      </div>
                    </div>
                    <button
                      type="button"
                      className="pro-btn primary"
                      style={{ height: "30px", fontSize: "11px", gap: "6px" }}
                      onClick={handleTestAllApis}
                      disabled={isTestingAllApis}
                    >
                      <span className={`material-symbols-outlined text-[14px] ${isTestingAllApis ? "api-spin-icon" : ""}`}>
                        {isTestingAllApis ? "sync" : "checklist"}
                      </span>
                      {isTestingAllApis ? "一括テスト中..." : "すべてのAPIキーを一括テスト"}
                    </button>
                  </div>

                  <div className="settings-grid">
                    <div>
                      <h4 className="settings-section-title">OpenRouter LLM設定</h4>
                      <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
                        <div className="form-group">
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                            <label className="form-label" style={{ marginBottom: 0 }}>OpenRouter API Key</label>
                            <button
                              type="button"
                              className="pro-btn"
                              style={{ height: "24px", padding: "0 8px", fontSize: "10px", gap: "4px" }}
                              onClick={handleTestOpenRouter}
                              disabled={openRouterTestResult.status === "testing" || isTestingAllApis}
                            >
                              <span className={`material-symbols-outlined text-[12px] ${openRouterTestResult.status === "testing" ? "api-spin-icon" : ""}`}>
                                {openRouterTestResult.status === "testing" ? "sync" : "bolt"}
                              </span>
                              動作確認
                            </button>
                          </div>
                          <input
                            type="password"
                            className="pro-input"
                            value={openRouterApiKey}
                            onChange={(e) => setOpenRouterApiKey(e.target.value)}
                            placeholder="sk-or-v1-..."
                          />
                          <span style={{ fontSize: "10px", color: "var(--on-surface-variant)", marginTop: "2px" }}>
                            OpenRouterのAPI Key（sk-or-v1-で始まるキー）を入力します。
                          </span>
                          {openRouterTestResult.status !== "idle" && (
                            <div className={`api-test-result ${openRouterTestResult.status}`}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: 1 }}>
                                <span className="material-symbols-outlined text-[14px]">
                                  {openRouterTestResult.status === "testing" ? "sync" : openRouterTestResult.success ? "check_circle" : "error"}
                                </span>
                                <span>{openRouterTestResult.message}</span>
                              </div>
                              {openRouterTestResult.latency !== undefined && (
                                <span className="api-test-latency">{openRouterTestResult.latency}ms</span>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="form-group">
                          <label className="form-label">LLMモデル指定</label>
                          <CustomSelect
                            value={openRouterModel}
                            onChange={(val) => setOpenRouterModel(val)}
                            options={[
                              { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash (推奨・高速)" },
                              { value: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet (高精度)" },
                              { value: "openai/gpt-4o-mini", label: "GPT-4o Mini (軽量)" },
                              { value: "deepseek/deepseek-chat", label: "DeepSeek V3" }
                            ]}
                          />
                          <input
                            type="text"
                            className="pro-input"
                            style={{ marginTop: "6px" }}
                            value={openRouterModel}
                            onChange={(e) => setOpenRouterModel(e.target.value)}
                            placeholder="モデル名を直接入力 (例: google/gemini-2.5-flash)"
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <h4 className="settings-section-title">補足データソース (任意)</h4>
                      <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
                        <div className="form-group">
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                            <label className="form-label" style={{ marginBottom: 0 }}>FRED API Key (FRB金利取得)</label>
                            <button
                              type="button"
                              className="pro-btn"
                              style={{ height: "24px", padding: "0 8px", fontSize: "10px", gap: "4px" }}
                              onClick={handleTestFred}
                              disabled={fredTestResult.status === "testing" || isTestingAllApis}
                            >
                              <span className={`material-symbols-outlined text-[12px] ${fredTestResult.status === "testing" ? "api-spin-icon" : ""}`}>
                                {fredTestResult.status === "testing" ? "sync" : "bolt"}
                              </span>
                              動作確認
                            </button>
                          </div>
                          <input
                            type="text"
                            className="pro-input"
                            value={fredApiKey}
                            onChange={(e) => setFredApiKey(e.target.value)}
                            placeholder="FRED API Key (任意)"
                          />
                          {fredTestResult.status !== "idle" && (
                            <div className={`api-test-result ${fredTestResult.status}`}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: 1 }}>
                                <span className="material-symbols-outlined text-[14px]">
                                  {fredTestResult.status === "testing" ? "sync" : fredTestResult.success ? "check_circle" : "error"}
                                </span>
                                <span>{fredTestResult.message}</span>
                              </div>
                              {fredTestResult.latency !== undefined && (
                                <span className="api-test-latency">{fredTestResult.latency}ms</span>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="form-group">
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                            <label className="form-label" style={{ marginBottom: 0 }}>Finnhub API Key (FXニュース用)</label>
                            <button
                              type="button"
                              className="pro-btn"
                              style={{ height: "24px", padding: "0 8px", fontSize: "10px", gap: "4px" }}
                              onClick={handleTestFinnhub}
                              disabled={finnhubTestResult.status === "testing" || isTestingAllApis}
                            >
                              <span className={`material-symbols-outlined text-[12px] ${finnhubTestResult.status === "testing" ? "api-spin-icon" : ""}`}>
                                {finnhubTestResult.status === "testing" ? "sync" : "bolt"}
                              </span>
                              動作確認
                            </button>
                          </div>
                          <input
                            type="text"
                            className="pro-input"
                            value={finnhubApiKey}
                            onChange={(e) => setFinnhubApiKey(e.target.value)}
                            placeholder="Finnhub API Key (任意)"
                          />
                          {finnhubTestResult.status !== "idle" && (
                            <div className={`api-test-result ${finnhubTestResult.status}`}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: 1 }}>
                                <span className="material-symbols-outlined text-[14px]">
                                  {finnhubTestResult.status === "testing" ? "sync" : finnhubTestResult.success ? "check_circle" : "error"}
                                </span>
                                <span>{finnhubTestResult.message}</span>
                              </div>
                              {finnhubTestResult.latency !== undefined && (
                                <span className="api-test-latency">{finnhubTestResult.latency}ms</span>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="form-group" style={{ marginTop: "4px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <label className="form-label" style={{ marginBottom: 0 }}>GDELT ニュース API (キー不要)</label>
                            <button
                              type="button"
                              className="pro-btn"
                              style={{ height: "24px", padding: "0 8px", fontSize: "10px", gap: "4px" }}
                              onClick={handleTestGdelt}
                              disabled={gdeltTestResult.status === "testing" || isTestingAllApis}
                            >
                              <span className={`material-symbols-outlined text-[12px] ${gdeltTestResult.status === "testing" ? "api-spin-icon" : ""}`}>
                                {gdeltTestResult.status === "testing" ? "sync" : "bolt"}
                              </span>
                              動作確認
                            </button>
                          </div>
                          {gdeltTestResult.status !== "idle" && (
                            <div className={`api-test-result ${gdeltTestResult.status}`}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: 1 }}>
                                <span className="material-symbols-outlined text-[14px]">
                                  {gdeltTestResult.status === "testing" ? "sync" : gdeltTestResult.success ? "check_circle" : "error"}
                                </span>
                                <span>{gdeltTestResult.message}</span>
                              </div>
                              {gdeltTestResult.latency !== undefined && (
                                <span className="api-test-latency">{gdeltTestResult.latency}ms</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <h4 className="settings-section-title" style={{ marginTop: "16px" }}>急変動自動検知</h4>
                      <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                        <div className="form-group">
                          <label className="form-label">検知閾値 (Pips / 5分)</label>
                          <input
                            type="number"
                            className="pro-input"
                            value={volatilityThresholdPips}
                            onChange={(e) => setVolatilityThresholdPips(parseInt(e.target.value) || 20)}
                          />
                        </div>
                        <div className="form-group" style={{ display: "flex", alignItems: "center", paddingTop: "20px" }}>
                          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "12px" }}>
                            <input
                              type="checkbox"
                              checked={volatilityEnabled}
                              onChange={(e) => setVolatilityEnabled(e.target.checked)}
                            />
                            自動スパイク通知バッジを有効化
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                className="pro-btn primary"
                onClick={() => {
                  saveAllSettings();
                  setIsSettingsOpen(false);
                }}
                disabled={!!recordingAction}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
      {activePickerField && (
        <DateTimePickerModal
          fieldLabel={
            activePickerField === "preload" ? `過去プリロード開始日 (${timezoneMode})` :
              activePickerField === "start" ? `開始日時 (${timezoneMode})` :
                `終了日時 (${timezoneMode})`
          }
          value={
            activePickerField === "preload" ? (timezoneMode === "JST" ? preloadDate : getNewsTimeForDisplay(preloadDate, "SERVER")) :
              activePickerField === "start" ? (timezoneMode === "JST" ? startTime : getNewsTimeForDisplay(startTime, "SERVER")) :
                (timezoneMode === "JST" ? endTime : getNewsTimeForDisplay(endTime, "SERVER"))
          }
          onChange={(newVal) => {
            const finalVal = timezoneMode === "JST" ? newVal : convertServerToJstStr(newVal);
            if (activePickerField === "preload") setPreloadDate(finalVal);
            else if (activePickerField === "start") setStartTime(finalVal);
            else setEndTime(finalVal);
          }}
          onClose={() => setActivePickerField(null)}
        />
      )}

      {/* Session Delete Confirmation Modal */}
      <DeleteSessionModal
        isOpen={isDeleteSessionConfirmOpen}
        message={deleteConfirmMessage}
        onConfirm={executeDeleteSession}
        onClose={() => setIsDeleteSessionConfirmOpen(false)}
      />

      {/* Session Clear All Confirmation Modal */}
      {isClearAllSessionsConfirmOpen && (
        <div className="modal-overlay" onClick={() => setIsClearAllSessionsConfirmOpen(false)}>
          <div className="modal-container" style={{ maxWidth: "400px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="material-symbols-outlined" style={{ color: "var(--status-danger)" }}>delete_sweep</span>
                全セッションデータの削除
              </h3>
              <button className="modal-close-btn" onClick={() => setIsClearAllSessionsConfirmOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "12px", lineHeight: "1.6" }}>
              <div style={{ fontSize: "12px", textAlign: "center" }}>
                保存されているすべてのセッションデータを完全に削除してもよろしいですか？この操作は取り消せません。
              </div>
            </div>
            <div className="modal-footer" style={{ padding: "12px 16px", display: "flex", gap: "8px", width: "100%", boxSizing: "border-box" }}>
              <button
                className="pro-btn"
                style={{ flex: 1 }}
                onClick={() => setIsClearAllSessionsConfirmOpen(false)}
              >
                キャンセル
              </button>
              <button
                className="pro-btn danger-filled"
                style={{ flex: 1 }}
                onClick={executeClearAllSessions}
              >
                一括削除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Replay Settings Reset Confirmation Modal */}
      {isResetReplayConfirmOpen && (
        <div className="modal-overlay" onClick={() => setIsResetReplayConfirmOpen(false)}>
          <div className="modal-container" style={{ maxWidth: "400px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="material-symbols-outlined text-accent" style={{ color: "var(--primary-color)" }}>restart_alt</span>
                リプレイ設定のリセット
              </h3>
              <button className="modal-close-btn" onClick={() => setIsResetReplayConfirmOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "12px", lineHeight: "1.6" }}>
              <div style={{ fontSize: "12px", textAlign: "center" }}>
                リプレイ設定（ターミナル、プロファイル、通貨ペア、各種時間など）をデフォルト値にリセットしますか？
              </div>
            </div>
            <div className="modal-footer" style={{ padding: "12px 16px", display: "flex", gap: "8px", width: "100%", boxSizing: "border-box" }}>
              <button
                className="pro-btn"
                style={{ flex: 1 }}
                onClick={() => setIsResetReplayConfirmOpen(false)}
              >
                キャンセル
              </button>
              <button
                className="pro-btn primary"
                style={{ flex: 1 }}
                onClick={() => {
                  executeResetReplaySettings();
                  setIsResetReplayConfirmOpen(false);
                }}
              >
                リセット
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Max Bars Warning Modal */}
      {isMaxBarsWarningOpen && (
        <div className="modal-overlay" onClick={() => setIsMaxBarsWarningOpen(false)}>
          <div className="modal-container" style={{ maxWidth: "460px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "6px", color: "#ffb74d" }}>
                <span className="material-symbols-outlined" style={{ color: "#ffb74d" }}>warning</span>
                チャート最大バー数の確認
              </h3>
              <button className="modal-close-btn" onClick={() => setIsMaxBarsWarningOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "12px", lineHeight: "1.6" }}>
              <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--on-surface)" }}>
                MT5の「チャートの最大バー数」が Unlimited（無制限）に設定されていません。
              </div>
              <div style={{ backgroundColor: "rgba(255, 183, 77, 0.1)", border: "1px dashed rgba(255, 183, 77, 0.4)", borderRadius: "6px", padding: "10px 12px", fontSize: "12px" }}>
                <div><strong>現在の設定:</strong> {maxBarsInfo ? (maxBarsInfo.max_bars > 0 ? `${maxBarsInfo.max_bars.toLocaleString()} 本` : maxBarsInfo.raw_value) : "未検出"}</div>
              </div>
              <div style={{ fontSize: "12px", color: "var(--on-surface-variant)" }}>
                最大バー数が制限されている場合、過去データ検証時にインジケータ（移動平均線やVWAP等）の計算本数が不足し、チャート上に正しく描画されないことがあります。
              </div>
              <div style={{ fontSize: "12px", backgroundColor: "rgba(255, 255, 255, 0.04)", padding: "10px 12px", borderRadius: "6px", border: "1px solid var(--outline-variant)" }}>
                💡 <strong>推奨設定手順:</strong><br />
                MT5のメニュー <strong>[ツール] → [オプション] → [チャート]</strong> タブを開き、<strong>「チャートの最大バー数」</strong> を <strong>「Unlimited」</strong> に変更して「OK」を押してください。
              </div>
            </div>
            <div className="modal-footer" style={{ padding: "12px 16px", display: "flex", gap: "8px", width: "100%", boxSizing: "border-box" }}>
              <button
                type="button"
                className="pro-btn"
                style={{ flex: 1 }}
                onClick={() => setIsMaxBarsWarningOpen(false)}
              >
                キャンセル（設定変更）
              </button>
              <button
                type="button"
                className="pro-btn primary"
                style={{ flex: 1, backgroundColor: "#ffb74d", color: "#1c1b1f", fontWeight: "bold" }}
                onClick={() => {
                  setIsMaxBarsWarningOpen(false);
                  executeInitReplay();
                }}
              >
                このまま開始する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Trading Settings Reset Confirmation Modal */}
      {isResetTradingConfirmOpen && (
        <div className="modal-overlay" onClick={() => setIsResetTradingConfirmOpen(false)}>
          <div className="modal-container" style={{ maxWidth: "400px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="material-symbols-outlined text-accent" style={{ color: "var(--primary-color)" }}>restart_alt</span>
                取引設定のリセット
              </h3>
              <button className="modal-close-btn" onClick={() => setIsResetTradingConfirmOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "12px", lineHeight: "1.6" }}>
              <div style={{ fontSize: "12px", textAlign: "center" }}>
                取引設定（初期残高、レバレッジ、ロット単位、疑似レート生成設定など）をデフォルト値にリセットしますか？
              </div>
            </div>
            <div className="modal-footer" style={{ padding: "12px 16px", display: "flex", gap: "8px", width: "100%", boxSizing: "border-box" }}>
              <button
                className="pro-btn"
                style={{ flex: 1 }}
                onClick={() => setIsResetTradingConfirmOpen(false)}
              >
                キャンセル
              </button>
              <button
                className="pro-btn primary"
                style={{ flex: 1 }}
                onClick={() => {
                  executeResetTradingSettings();
                  setIsResetTradingConfirmOpen(false);
                }}
              >
                リセット
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Session Modal */}
      {isSaveSessionOpen && (
        <div className="modal-overlay" onClick={() => setIsSaveSessionOpen(false)}>
          <div className="modal-container" style={{ maxWidth: "400px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="material-symbols-outlined icon-accent" style={{ color: "var(--primary-color)" }}>save</span>
                {sessionSaveType === "terminate" ? "セッションを保存して終了" : "現在の状態を保存"}
              </h3>
              <button className="modal-close-btn" onClick={() => setIsSaveSessionOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ marginBottom: "6px" }}>セッション名</label>
                <input
                  type="text"
                  className="pro-input"
                  value={saveSessionName}
                  onChange={(e) => setSaveSessionName(e.target.value)}
                  placeholder="セッション名を入力してください"
                  style={{ width: "100%", boxSizing: "border-box" }}
                />
              </div>
              {currentSessionId && (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "12px", color: "var(--on-surface)" }}>
                    <input
                      type="checkbox"
                      checked={saveAsNewSnapshot}
                      onChange={(e) => setSaveAsNewSnapshot(e.target.checked)}
                      style={{ cursor: "pointer" }}
                    />
                    新規スナップショットとして保存
                  </label>
                  <span style={{ fontSize: "10px", color: "var(--on-surface-variant)", marginLeft: "20px", lineHeight: "1.4" }}>
                    {saveAsNewSnapshot
                      ? "現在の履歴を上書きせず、同じセッション内に新しい履歴（スナップショット）として保存します。"
                      : `既存の保存データ（${currentSessionName}）に上書き保存します。`}
                  </span>
                </div>
              )}
            </div>
            <div className="modal-footer" style={{ padding: "12px 16px", display: "flex", gap: "8px", width: "100%", boxSizing: "border-box" }}>
              {sessionSaveType === "terminate" && (
                <button
                  className="pro-btn danger"
                  style={{ marginRight: "auto" }}
                  onClick={async () => {
                    setIsSaveSessionOpen(false);
                    await executeTerminate();
                  }}
                >
                  保存せずに終了
                </button>
              )}
              <button
                className="pro-btn"
                onClick={() => setIsSaveSessionOpen(false)}
              >
                キャンセル
              </button>
              <button
                className="pro-btn primary"
                disabled={!saveSessionName.trim()}
                onClick={async () => {
                  await executeSaveSession();
                  setIsSaveSessionOpen(false);
                  if (sessionSaveType === "terminate") {
                    await executeTerminate();
                  }
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* カスタムシンボル構築・インポート モーダル */}
      <CustomSymbolImportModal
        isOpen={isCustomImportOpen}
        onClose={() => setIsCustomImportOpen(false)}
        terminalPath={selectedTerminal}
        onImportComplete={() => loadAvailableSymbols(selectedTerminal)}
      />

      {/* Time Steps カスタマイズ モーダル */}
      {isTimeStepsModalOpen && (
        <div className="modal-overlay" onClick={() => setIsTimeStepsModalOpen(false)}>
          <div className="modal-container" style={{ maxWidth: "460px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="material-symbols-outlined icon-accent" style={{ color: "var(--primary-color)" }}>tune</span>
                Time Steps カスタマイズ (最大5つ)
              </h3>
              <button className="modal-close-btn" onClick={() => setIsTimeStepsModalOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "16px" }}>
              
              {/* Quick Add Presets */}
              <div>
                <div className="form-label" style={{ marginBottom: "6px" }}>クイック追加プリセット:</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {PRESET_TIME_OPTIONS.map((preset) => {
                    const isAlreadyAdded = editingTimeSteps.some((item) => item.seconds === preset.seconds);
                    const isMax = editingTimeSteps.length >= 5;
                    return (
                      <button
                        key={preset.label}
                        className={`pro-btn ${isAlreadyAdded ? "secondary" : ""}`}
                        disabled={isAlreadyAdded || isMax}
                        style={{
                          padding: "3px 8px",
                          fontSize: "11px",
                          opacity: isAlreadyAdded || isMax ? 0.5 : 1,
                          cursor: isAlreadyAdded || isMax ? "not-allowed" : "pointer"
                        }}
                        onClick={() => {
                          if (editingTimeSteps.length < 5 && !isAlreadyAdded) {
                            const updated = [
                              ...editingTimeSteps,
                              { id: `ts-${Date.now()}-${Math.random()}`, seconds: preset.seconds, label: preset.label }
                            ].sort((a, b) => a.seconds - b.seconds);
                            setEditingTimeSteps(updated);
                          }
                        }}
                      >
                        + {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Current Steps Edit List */}
              <div>
                <div className="form-label" style={{ marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>設定中のステップ (最大5枠 / 現在 {editingTimeSteps.length}枠):</span>
                  {editingTimeSteps.length < 5 && (
                    <button
                      className="pro-btn"
                      style={{ padding: "2px 8px", fontSize: "11px" }}
                      onClick={() => {
                        const updated = [
                          ...editingTimeSteps,
                          { id: `ts-${Date.now()}`, seconds: 300, label: "5M" }
                        ].sort((a, b) => a.seconds - b.seconds);
                        setEditingTimeSteps(updated);
                      }}
                    >
                      + カスタム追加
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {editingTimeSteps.map((step, index) => (
                    <div
                      key={step.id || index}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        backgroundColor: "var(--surface-obsidian)",
                        padding: "6px 10px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--outline-variant)"
                      }}
                    >
                      <span className="font-data" style={{ fontSize: "12px", color: "var(--on-surface-variant)", width: "18px" }}>
                        #{index + 1}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: "4px", flex: 1 }}>
                        <span style={{ fontSize: "11px", color: "var(--on-surface-variant)" }}>秒数:</span>
                        <input
                          type="number"
                          className="pro-input"
                          style={{ width: "70px", padding: "2px 6px", fontSize: "12px", textAlign: "right" }}
                          value={step.seconds}
                          min={1}
                          max={86400}
                          onChange={(e) => {
                            const val = Math.max(1, parseInt(e.target.value) || 1);
                            const updated = [...editingTimeSteps];
                            updated[index] = {
                              ...updated[index],
                              seconds: val,
                              label: formatSecondsToLabel(val)
                            };
                            setEditingTimeSteps(updated);
                          }}
                        />
                        <span style={{ fontSize: "11px", color: "var(--on-surface-variant)" }}>秒</span>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <span style={{ fontSize: "11px", color: "var(--on-surface-variant)" }}>表示名:</span>
                        <input
                          type="text"
                          className="pro-input"
                          style={{ width: "55px", padding: "2px 6px", fontSize: "12px", fontWeight: 700 }}
                          value={step.label}
                          onChange={(e) => {
                            const updated = [...editingTimeSteps];
                            updated[index] = { ...updated[index], label: e.target.value };
                            setEditingTimeSteps(updated);
                          }}
                        />
                      </div>

                      <button
                        className="pro-btn danger pro-btn-square"
                        style={{ width: "24px", height: "24px", padding: 0 }}
                        disabled={editingTimeSteps.length <= 1}
                        title="削除"
                        onClick={() => {
                          if (editingTimeSteps.length > 1) {
                            setEditingTimeSteps(editingTimeSteps.filter((_, i) => i !== index));
                          }
                        }}
                      >
                        <span className="material-symbols-outlined text-[13px]">delete</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="modal-footer" style={{ padding: "12px 16px", display: "flex", gap: "8px", justifyContent: "space-between" }}>
              <button
                className="pro-btn secondary"
                onClick={() => setEditingTimeSteps([...DEFAULT_TIME_STEPS].sort((a, b) => a.seconds - b.seconds))}
                title="デフォルトに戻す"
              >
                初期化
              </button>
              <div style={{ display: "flex", gap: "8px" }}>
                <button className="pro-btn" onClick={() => setIsTimeStepsModalOpen(false)}>
                  キャンセル
                </button>
                <button
                  className="pro-btn primary"
                  onClick={() => {
                    const sorted = [...editingTimeSteps].sort((a, b) => a.seconds - b.seconds);
                    setTimeSteps(sorted);
                    setIsTimeStepsModalOpen(false);
                  }}
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transport 速度プリセット カスタマイズ モーダル */}
      {isSpeedPresetsModalOpen && (
        <div className="modal-overlay" onClick={() => setIsSpeedPresetsModalOpen(false)}>
          <div className="modal-container" style={{ maxWidth: "500px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="material-symbols-outlined icon-accent" style={{ color: "var(--primary-color)" }}>tune</span>
                Transport 速度プリセット設定
              </h3>
              <button className="modal-close-btn" onClick={() => setIsSpeedPresetsModalOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "18px" }}>
              
              {/* 時間倍率プリセット */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <div className="form-label" style={{ fontWeight: 700, color: "var(--on-surface)", fontSize: "13px" }}>
                    再生速度プリセット (時間比率)
                  </div>
                  <button
                    className="pro-btn danger"
                    style={{ padding: "2px 6px", fontSize: "10px" }}
                    onClick={() => {
                      setEditingTimePresets([1.0, 5.0, 10.0, 60.0, 300.0, 3600.0]);
                    }}
                  >
                    <span className="material-symbols-outlined text-[12px]">restart_alt</span>
                    時間初期化
                  </button>
                </div>

                {/* クイック追加 */}
                <div style={{ marginBottom: "8px" }}>
                  <div style={{ fontSize: "11px", color: "var(--on-surface-variant)", marginBottom: "4px" }}>クイック追加:</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                    {[0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0, 300.0].map((quickVal) => {
                      const isAdded = editingTimePresets.includes(quickVal);
                      return (
                        <button
                          key={`quick-time-${quickVal}`}
                          className={`pro-btn ${isAdded ? "secondary" : ""}`}
                          disabled={isAdded}
                          style={{
                            padding: "2px 6px",
                            fontSize: "10px",
                            opacity: isAdded ? 0.5 : 1,
                            cursor: isAdded ? "not-allowed" : "pointer"
                          }}
                          onClick={() => {
                            if (!isAdded) {
                              const updated = [...editingTimePresets, quickVal].sort((a, b) => a - b);
                              setEditingTimePresets(updated);
                            }
                          }}
                        >
                          + {quickVal}x
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* バッジ一覧 */}
                <div className="preset-badges-container" style={{ marginBottom: "8px" }}>
                  {editingTimePresets.map((preset) => (
                    <span key={`time-${preset}`} className="preset-badge">
                      {preset}x
                      <button
                        className="preset-badge-delete-btn"
                        onClick={() => {
                          setEditingTimePresets(editingTimePresets.filter((p) => p !== preset));
                        }}
                        title="削除"
                      >
                        <span className="material-symbols-outlined text-[12px]">close</span>
                      </button>
                    </span>
                  ))}
                  {editingTimePresets.length === 0 && (
                    <span style={{ color: "var(--on-surface-variant)", fontSize: "11px" }}>登録されたプリセットはありません。</span>
                  )}
                </div>

                {/* カスタム追加 */}
                <div className="preset-add-group">
                  <input
                    type="number"
                    step="any"
                    className="pro-input"
                    style={{ flex: 1, height: "28px", padding: "4px 8px", fontSize: "12px" }}
                    placeholder="倍率値 (例: 120)"
                    value={modalNewTimePreset}
                    onChange={(e) => setModalNewTimePreset(e.target.value)}
                  />
                  <button
                    className="pro-btn primary"
                    style={{ height: "28px", padding: "0 10px" }}
                    onClick={() => {
                      const val = parseFloat(modalNewTimePreset);
                      if (isNaN(val) || val <= 0) return;
                      if (!editingTimePresets.includes(val)) {
                        const updated = [...editingTimePresets, val].sort((a, b) => a - b);
                        setEditingTimePresets(updated);
                      }
                      setModalNewTimePreset("");
                    }}
                  >
                    追加
                  </button>
                </div>
              </div>

              <div style={{ height: "1px", backgroundColor: "var(--outline-variant)", margin: "0 -4px" }}></div>

              {/* スキップティック数プリセット */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <div className="form-label" style={{ fontWeight: 700, color: "var(--on-surface)", fontSize: "13px" }}>
                    スキップティック数プリセット
                  </div>
                  <button
                    className="pro-btn danger"
                    style={{ padding: "2px 6px", fontSize: "10px" }}
                    onClick={() => {
                      setEditingTickPresets([1, 5, 10, 50, 100, 500]);
                    }}
                  >
                    <span className="material-symbols-outlined text-[12px]">restart_alt</span>
                    ティック初期化
                  </button>
                </div>

                {/* クイック追加 */}
                <div style={{ marginBottom: "8px" }}>
                  <div style={{ fontSize: "11px", color: "var(--on-surface-variant)", marginBottom: "4px" }}>クイック追加:</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                    {[1, 5, 10, 20, 50, 100, 200, 500, 1000].map((quickVal) => {
                      const isAdded = editingTickPresets.includes(quickVal);
                      return (
                        <button
                          key={`quick-tick-${quickVal}`}
                          className={`pro-btn ${isAdded ? "secondary" : ""}`}
                          disabled={isAdded}
                          style={{
                            padding: "2px 6px",
                            fontSize: "10px",
                            opacity: isAdded ? 0.5 : 1,
                            cursor: isAdded ? "not-allowed" : "pointer"
                          }}
                          onClick={() => {
                            if (!isAdded) {
                              const updated = [...editingTickPresets, quickVal].sort((a, b) => a - b);
                              setEditingTickPresets(updated);
                            }
                          }}
                        >
                          + {quickVal}T
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* バッジ一覧 */}
                <div className="preset-badges-container" style={{ marginBottom: "8px" }}>
                  {editingTickPresets.map((preset) => (
                    <span key={`tick-${preset}`} className="preset-badge">
                      {preset}T
                      <button
                        className="preset-badge-delete-btn"
                        onClick={() => {
                          setEditingTickPresets(editingTickPresets.filter((p) => p !== preset));
                        }}
                        title="削除"
                      >
                        <span className="material-symbols-outlined text-[12px]">close</span>
                      </button>
                    </span>
                  ))}
                  {editingTickPresets.length === 0 && (
                    <span style={{ color: "var(--on-surface-variant)", fontSize: "11px" }}>登録されたプリセットはありません。</span>
                  )}
                </div>

                {/* カスタム追加 */}
                <div className="preset-add-group">
                  <input
                    type="number"
                    className="pro-input"
                    style={{ flex: 1, height: "28px", padding: "4px 8px", fontSize: "12px" }}
                    placeholder="ティック数 (例: 200)"
                    value={modalNewTickPreset}
                    onChange={(e) => setModalNewTickPreset(e.target.value)}
                  />
                  <button
                    className="pro-btn primary"
                    style={{ height: "28px", padding: "0 10px" }}
                    onClick={() => {
                      const val = parseInt(modalNewTickPreset);
                      if (isNaN(val) || val <= 0) return;
                      if (!editingTickPresets.includes(val)) {
                        const updated = [...editingTickPresets, val].sort((a, b) => a - b);
                        setEditingTickPresets(updated);
                      }
                      setModalNewTickPreset("");
                    }}
                  >
                    追加
                  </button>
                </div>
              </div>

            </div>

            <div className="modal-footer" style={{ padding: "12px 16px", display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button className="pro-btn" onClick={() => setIsSpeedPresetsModalOpen(false)}>
                キャンセル
              </button>
              <button
                className="pro-btn primary"
                onClick={() => {
                  const sortedTime = [...editingTimePresets].sort((a, b) => a - b);
                  const sortedTick = [...editingTickPresets].sort((a, b) => a - b);
                  setTimePresets(sortedTime);
                  setTickPresets(sortedTick);
                  saveAllSettings(hotkeys, sortedTime, sortedTick);
                  setIsSpeedPresetsModalOpen(false);
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 急変動・トレンドAI解析スライドインパネル */}
      <AIAnalysisPanel
        isOpen={isAIPanelOpen}
        onClose={() => setIsAIPanelOpen(false)}
        virtualTimeMsc={aiTargetTimeMsc || virtualTimeMsc}
        symbol={sourceSymbol}
        newsItems={newsItems}
        openRouterApiKey={openRouterApiKey}
        openRouterModel={openRouterModel}
        fredApiKey={fredApiKey}
        finnhubApiKey={finnhubApiKey}
        timezoneMode={timezoneMode}
      />
    </div>
  );
}

export default App;
