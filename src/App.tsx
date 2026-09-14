import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import "./App.css";
import { SymbolItem } from "./components/SymbolCombobox";
import { CustomSymbolImportModal } from "./components/CustomSymbolImportModal";
import { SymbolBatchSelectorModal } from "./components/SymbolBatchSelectorModal";
import { SymbolSelectorWindowContent } from "./components/SymbolSelectorWindowContent";
import { AIAnalysisPanel } from "./components/AIAnalysisPanel";
import { DateTimePickerModal } from "./components/DateTimePickerModal";
import { SpeedOrderWindowContent } from "./components/SpeedOrderWindowContent";
import { PositionsWindowContent } from "./components/PositionsWindowContent";
import { SettingsWindowContent } from "./components/Settings/SettingsWindowContent";
import { DeleteSessionModal } from "./components/DeleteSessionModal";
import { EconomicDataMissingModal } from "./components/Modals/EconomicDataMissingModal";
import { TerminalNameModal } from "./components/Modals/TerminalNameModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppHeader } from "./components/Header/AppHeader";
import { SetupPanel } from "./components/Setup/SetupPanel";
import { RemoteHudBar } from "./components/Remote/RemoteHudBar";
import { SettingsModal } from "./components/Settings/SettingsModal";
import { parseSymbolName, getCompanionSymbols, switchSymbolSuffix, getAllYears, checkSymbolYearMismatch } from "./utils/symbolUtils";
import { parseDateTimeStr, alignDateRangeToYear } from "./utils/dateUtils";
import { checkEconomicDataAvailability } from "./utils/economicDataUtils";
import { useTheme } from "./hooks/useTheme";
import {
  getServerToJstOffsetHours,
  convertServerStrToJstStr as convertServerToJstStr,
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
  getTauriShortcutFromEvent,
  matchesHotkey,
  MaxBarsInfo
} from "./utils/hotkeyUtils";
import { TerminalInfo } from "./types/terminal";
import {
  ReplayProgressPayload,
  SessionBoundariesData,
  TimeStepItem,
} from "./types";
import { SavedSession } from "./types/session";
import { PersistedSettings } from "./types/settings";
import { TradeHistoryItem, VirtualAccount, VirtualPosition } from "./types/trading";
import { translateErrorMessage } from "./utils/i18nUtils";
import { organizeSessions, getCurrentSession } from "./domain/sessionBoundaries";
import { ReplayCommand, sendReplayCommand } from "./utils/command";



export const DEFAULT_TIME_STEPS: TimeStepItem[] = [
  { id: "ts-1", seconds: 10, label: "10S" },
  { id: "ts-2", seconds: 60, label: "1M" },
  { id: "ts-3", seconds: 600, label: "10M" },
  { id: "ts-4", seconds: 3600, label: "1H" },
];

export type { TimeStepItem } from "./types/replay";

/**
 * 口座情報の高速等価比較（JSON.stringify による毎フレームGCアロケーションを抑止）
 */
function isAccountEqual(a: VirtualAccount | null, b?: VirtualAccount): boolean {
  if (!a || !b) return a === b;
  return (
    a.balance === b.balance &&
    a.equity === b.equity &&
    a.margin === b.margin &&
    a.free_margin === b.free_margin &&
    a.margin_level === b.margin_level &&
    a.total_profit === b.total_profit &&
    a.leverage === b.leverage
  );
}

/**
 * 保有ポジション配列の高速等価比較（JSON.stringify による毎フレームGCアロケーションを抑止）
 */
function arePositionsEqual(a?: VirtualPosition[], b?: VirtualPosition[]): boolean {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p1 = a[i];
    const p2 = b[i];
    if (
      p1.ticket !== p2.ticket ||
      p1.type !== p2.type ||
      p1.volume !== p2.volume ||
      p1.open_price !== p2.open_price ||
      p1.current_price !== p2.current_price ||
      p1.profit !== p2.profit ||
      p1.sl !== p2.sl ||
      p1.tp !== p2.tp ||
      p1.mfe_pips !== p2.mfe_pips ||
      p1.mae_pips !== p2.mae_pips
    ) {
      return false;
    }
  }
  return true;
}

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

import { ControllerWindowContent } from "./components/Controls/ControllerWindowContent";

export const formatSecondsToLabel = (sec: number): string => {
  if (sec < 60) return `${sec}S`;
  if (sec < 3600 && sec % 60 === 0) return `${sec / 60}M`;
  if (sec % 3600 === 0) return `${sec / 3600}H`;
  if (sec >= 3600) return `${(sec / 3600).toFixed(1)}H`;
  return `${(sec / 60).toFixed(1)}M`;
};

export const formatTimeStepLabel = (sec: number): string => {
  if (sec < 60) return `${sec}S`;
  if (sec >= 86400) return `${(sec / 86400).toFixed(0)}D`;
  if (sec >= 3600) return `${(sec / 3600).toFixed(0)}H`;
  return `${(sec / 60).toFixed(1)}M`;
};

function App() {
  // Check URL routing for child windows
  const urlParams = new URLSearchParams(window.location.search);
  const windowParam = urlParams.get("window");
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

  // --- 接続状態・EAからのステータス
  const [status, setStatus] = useState<"DISCONNECTED" | "CONNECTED" | "READY" | "ACTIVE">("DISCONNECTED");
  const [totalTicks, setTotalTicks] = useState(0);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [virtualTimeMsc, setVirtualTimeMsc] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
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
  const [expandedGroups, setExpandedGroups] = useState<{ [key: string]: boolean }>({});

  // 経済指標データの充足確認モーダル用 State
  const [isEconomicWarningOpen, setIsEconomicWarningOpen] = useState(false);
  const [economicMissingMonths, setEconomicMissingMonths] = useState<string[]>([]);
  const [economicAvailableMonths, setEconomicAvailableMonths] = useState<string[]>([]);
  const [_economicAvailabilityMap, setEconomicAvailabilityMap] = useState<Record<string, boolean>>({});
  const [economicDataDir, setEconomicDataDir] = useState<string>(() => localStorage.getItem("replay_economic_data_dir") || "");

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
      await invoke("save_terminal_name", { terminalPath, customName });
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
      await invoke("save_terminal_name", { terminalPath, customName: "" });
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
  const [mainFeedRate, setMainFeedRate] = useState<{ bid: number; ask: number; spread: number }>({ bid: 0, ask: 0, spread: 0 });
  const [subFeedRate, setSubFeedRate] = useState<{ active: boolean; symbol: string; bid: number; ask: number; spread: number } | null>(null);
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
      const list = await invoke<SymbolItem[]>("get_available_symbols", { terminalPath });
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
      localStorage.setItem("selected-terminal-path", selectedTerminal);
      localStorage.setItem(
        "symbol-selector-current-state",
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
      await emit("symbol-selector-init", {
        sourceSymbol,
        subSourceSymbol,
        enableDualFeed,
        additionalSymbols,
        availableSymbols,
        startTime,
        endTime,
      });
      await invoke("open_symbol_selector_window");
    } catch (err) {
      console.warn("Failed to open symbol selector window via invoke, opening modal fallback:", err);
      setIsBatchSelectorOpen(true);
    }
  };

  // セレクターウィンドウからの選択結果適用イベントを受信
  useEffect(() => {
    const unlisten = listen<SymbolSelectionPayload>("apply-symbol-selection", (event) => {
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
  const [limitTickHistory, setLimitTickHistory] = useState(true);
  const [tickHistoryTimeframe, setTickHistoryTimeframe] = useState("M5");
  const [maxHistoryBars, setMaxHistoryBars] = useState(300);
  const [autoScrollSync, setAutoScrollSync] = useState(true);
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

  // リプレイ状態（READY / ACTIVE）に新しく遷移した際、モニター2の操作コントローラーウィンドウを起動
  const prevStatusRef = useRef<string | null>(null);
  useEffect(() => {
    if (isRemoteMode) return;
    if (
      prevStatusRef.current !== null &&
      (prevStatusRef.current === "CONNECTED" || prevStatusRef.current === "DISCONNECTED") &&
      (status === "READY" || status === "ACTIVE")
    ) {
      invoke("open_controller_window").catch((err) => {
        console.warn("Open controller window failed or not applicable in browser:", err);
      });
    }
    prevStatusRef.current = status;
  }, [status, isRemoteMode]);

  const [errorMessage, setErrorMessage] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isResetReplayConfirmOpen, setIsResetReplayConfirmOpen] = useState(false);
  const [isResetTradingConfirmOpen, setIsResetTradingConfirmOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"general" | "hotkeys" | "theme" | "ai">("general");

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
  const [isAIPanelOpen, setIsAIPanelOpen] = useState<boolean>(false);
  const [aiTargetTimeMsc, setAiTargetTimeMsc] = useState<number>(0);

  // AI設定のlocalStorage保存同期
  useEffect(() => {
    localStorage.setItem("openrouter-api-key", openRouterApiKey);
    localStorage.setItem("openrouter-model", openRouterModel);
    localStorage.setItem("fred-api-key", fredApiKey);
    localStorage.setItem("finnhub-api-key", finnhubApiKey);
  }, [openRouterApiKey, openRouterModel, fredApiKey, finnhubApiKey]);

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



  const {
    theme, setTheme, cycleTheme,
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
  const isDraggingRef = useRef(false);
  const savedConfig = useRef<PersistedSettings | null>(null); // 保存された設定キャッシュ用のRef

  const handlersRef = useRef<AppHandlers | null>(null);

  const handleStatusString = (payload: string) => {
    try {
      const data = JSON.parse(payload) as ReplayProgressPayload;
      if (data.status === "READY") {
        const isReconnecting = status === "DISCONNECTED" || status === "CONNECTED";
        setStatus((prev) => prev !== "READY" ? "READY" : prev);
        if (data.total_ticks !== undefined) setTotalTicks((prev) => prev !== (data.total_ticks ?? prev) ? (data.total_ticks ?? prev) : prev);
        if (data.current_idx !== undefined) setCurrentIdx((prev) => prev !== (data.current_idx ?? prev) ? (data.current_idx ?? prev) : prev);
        if (data.virtual_time_msc !== undefined) setVirtualTimeMsc((prev) => prev !== (data.virtual_time_msc ?? prev) ? (data.virtual_time_msc ?? prev) : prev);
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
        setErrorMessage((prev) => prev !== "" ? "" : prev);
        if (data.account) {
          setAccount((prev) => {
            if (isAccountEqual(prev, data.account)) return prev;
            return data.account ?? prev;
          });
        }
        if (data.bid !== undefined && data.ask !== undefined) {
          const spread = data.spread !== undefined ? data.spread : 0;
          setMainFeedRate((prev) => {
            if (prev.bid === data.bid && prev.ask === data.ask && prev.spread === spread) return prev;
            return { bid: data.bid!, ask: data.ask!, spread };
          });
        }
        if (data.dual_feed) {
          const sym = data.sub_symbol || "";
          const sBid = data.sub_bid || 0;
          const sAsk = data.sub_ask || 0;
          const sSpread = data.sub_spread !== undefined ? data.sub_spread : 0;
          setSubFeedRate((prev) => {
            if (prev && prev.active && prev.symbol === sym && prev.bid === sBid && prev.ask === sAsk && prev.spread === sSpread) return prev;
            return { active: true, symbol: sym, bid: sBid, ask: sAsk, spread: sSpread };
          });
        } else {
          setSubFeedRate((prev) => prev === null ? prev : null);
        }
        if (data.positions) {
          setPositions((prev) => {
            if (arePositionsEqual(prev, data.positions)) return prev;
            return data.positions ?? prev;
          });
        }
        if (data.history && (data.history_revision === undefined || historyRevisionRef.current !== data.history_revision)) {
          historyRevisionRef.current = data.history_revision;
          setHistory(data.history);
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
                vt.positions.forEach((p) => {
                  if (p.accumulated_real_time !== undefined) {
                    restoredTimes[p.ticket] = p.accumulated_real_time;
                  }
                });
              }
              if (vt.history) {
                vt.history.forEach((h) => {
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
        if (data.is_playing !== undefined) setIsPlaying((prev) => prev !== (data.is_playing ?? prev) ? (data.is_playing ?? prev) : prev);
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
        if (data.account) {
          setAccount((prev) => {
            if (isAccountEqual(prev, data.account)) return prev;
            return data.account ?? prev;
          });
        }
        if (data.bid !== undefined && data.ask !== undefined) {
          const spread = data.spread !== undefined ? data.spread : 0;
          setMainFeedRate((prev) => {
            if (prev.bid === data.bid && prev.ask === data.ask && prev.spread === spread) return prev;
            return { bid: data.bid!, ask: data.ask!, spread };
          });
        }
        if (data.dual_feed) {
          const sym = data.sub_symbol || "";
          const sBid = data.sub_bid || 0;
          const sAsk = data.sub_ask || 0;
          const sSpread = data.sub_spread !== undefined ? data.sub_spread : 0;
          setSubFeedRate((prev) => {
            if (prev && prev.active && prev.symbol === sym && prev.bid === sBid && prev.ask === sAsk && prev.spread === sSpread) return prev;
            return { active: true, symbol: sym, bid: sBid, ask: sAsk, spread: sSpread };
          });
        } else {
          setSubFeedRate((prev) => prev === null ? prev : null);
        }
        if (data.positions) {
          setPositions((prev) => {
            if (arePositionsEqual(prev, data.positions)) return prev;
            return data.positions ?? prev;
          });
        }
        if (data.history && (data.history_revision === undefined || historyRevisionRef.current !== data.history_revision)) {
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

  const scheduleStatusUpdate = useCallback((payload: string) => {
    if (pendingStatusPayloadRef.current !== null) {
      skippedCountRef.current++;
    }
    pendingStatusPayloadRef.current = payload;

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
      // 1. EAへPINGコマンドを送信して即時ステータス返信を促す
      try {
        await sendCommand({ command: "PING" });
      } catch (_) {}

      // 2. 直近のステータスを取得して反映
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

  

  // --- 両建て設定適用エフェクト
  useEffect(() => {
    localStorage.setItem("speed-order-hedging", String(hedging));
  }, [hedging]);

  // --- 疑似レート設定をEAに同期するエフェクト
  useEffect(() => {
    if (status === "ACTIVE" || status === "READY") {
      const rawBase = pipsToPriceDiff(sourceSymbol, pseudoBaseSpread);
      const rawThresh = pipsToPriceDiff(sourceSymbol, pseudoThreshold);
      const rawRolloverSpread = pipsToPriceDiff(sourceSymbol, pseudoRolloverSpread);

      sendCommand({
        command: "SET_PSEUDO_RATE",
        enable_pseudo_rate: enablePseudoRate,
        pseudo_base_spread: rawBase,
        pseudo_threshold: rawThresh,
        pseudo_sensitivity: pseudoSensitivity,
        pseudo_rollover_enabled: pseudoRolloverEnabled,
        pseudo_rollover_spread: rawRolloverSpread,
        pseudo_rollover_recovery_min: pseudoRolloverRecoveryMin,
      }).catch(console.error);
    }
  }, [
    status,
    enablePseudoRate,
    pseudoBaseSpread,
    pseudoThreshold,
    pseudoSensitivity,
    pseudoRolloverEnabled,
    pseudoRolloverSpread,
    pseudoRolloverRecoveryMin,
    sourceSymbol,
  ]);

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
        const saved = await invoke<PersistedSettings>("load_settings");
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
          if (saved.limit_tick_history !== undefined && saved.limit_tick_history !== null) {
            setLimitTickHistory(saved.limit_tick_history);
          }
          if (saved.tick_history_timeframe) {
            setTickHistoryTimeframe(saved.tick_history_timeframe);
          }
          if (saved.max_history_bars !== undefined && saved.max_history_bars !== null) {
            setMaxHistoryBars(saved.max_history_bars);
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
          if (saved.theme_mode) {
            if (["dark", "dim", "light", "sepia", "warm-sepia"].includes(saved.theme_mode)) {
              setTheme(saved.theme_mode);
            }
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
            localStorage.setItem("speed-order-show-holding-time", String(saved.show_holding_time));
          }
          if (saved.holding_time_mode) {
            setHoldingTimeMode(saved.holding_time_mode as "pc" | "server");
            localStorage.setItem("speed-order-holding-time-mode", saved.holding_time_mode);
          }
          if (saved.contract_size !== undefined && saved.contract_size !== null) {
            setContractSize(saved.contract_size);
            localStorage.setItem("speed-order-contract-size", String(saved.contract_size));
          } else {
            const savedContract = localStorage.getItem("speed-order-contract-size");
            if (savedContract) {
              setContractSize(parseInt(savedContract, 10));
            }
          }
          if (saved.economic_data_dir) {
            setEconomicDataDir(saved.economic_data_dir);
            localStorage.setItem("replay_economic_data_dir", saved.economic_data_dir);
          } else if (!localStorage.getItem("replay_economic_data_dir")) {
            invoke<string>("get_default_economic_data_dir")
              .then((def) => {
                if (def) {
                  setEconomicDataDir(def);
                  localStorage.setItem("replay_economic_data_dir", def);
                }
              })
              .catch(() => {});
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
          const savedTerminal = savedConfig.current?.selected_terminal;
          if (savedTerminal && res.some((t) => t.path === savedTerminal)) {
            targetPath = savedTerminal;
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

      invoke<string[]>("get_profiles", { terminalPath: selectedTerminal })
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
    theme,
    alwaysOnTop,
    isShortcutsActive,
    limitTickHistory,
    tickHistoryTimeframe,
    maxHistoryBars,
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

  const sendCommand = async (cmd: ReplayCommand) => {
    try {
      await sendReplayCommand(cmd);
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
    customTheme = theme,
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
    customPseudoMode = pseudoMode,
    customPseudoRolloverEnabled = pseudoRolloverEnabled,
    customPseudoRolloverSpread = pseudoRolloverSpread,
    customPseudoRolloverRecoveryMin = pseudoRolloverRecoveryMin,
    customPreloadTimeframe = preloadTimeframe,
    customShowHoldingTime = showHoldingTime,
    customHoldingTimeMode = holdingTimeMode,
    customAdditionalSymbols = additionalSymbols,
    customContractSize = contractSize,
    customEconomicDataDir = economicDataDir
  ) => {
    const settingsObj = {
      selected_terminal: selectedTerminal,
      selected_profile: selectedProfile,
      source_symbol: sourceSymbol,
      enable_dual_feed: enableDualFeed,
      sub_source_symbol: subSourceSymbol,
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
      theme_mode: customTheme,
      always_on_top: customAlwaysOnTop,
      is_shortcuts_active: customIsShortcutsActive,
      timezone_mode: customTimezoneMode,
      pl_color_style: customPlColorStyle,
      order_color_style: customOrderColorStyle,
      hedging: customHedging,
      enable_virtual_trading: customEnableVirtualTrading,
      initial_balance: customInitialBalance,
      leverage: customLeverage,
      contract_size: customContractSize,
      enable_pseudo_rate: customEnablePseudoRate,
      pseudo_base_spread: customPseudoBaseSpread,
      pseudo_threshold: customPseudoThreshold,
      pseudo_sensitivity: customPseudoSensitivity,
      pseudo_mode: customPseudoMode,
      pseudo_rollover_enabled: customPseudoRolloverEnabled,
      pseudo_rollover_spread: customPseudoRolloverSpread,
      pseudo_rollover_recovery_min: customPseudoRolloverRecoveryMin,
      show_holding_time: customShowHoldingTime,
      holding_time_mode: customHoldingTimeMode,
      additional_symbols: customAdditionalSymbols,
      economic_data_dir: customEconomicDataDir,
      terminal_names: (() => {
        const map: { [key: string]: string } = {};
        terminals.forEach((t) => {
          if (t.custom_name && t.custom_name.trim()) {
            if (t.id) map[t.id] = t.custom_name.trim();
            map[t.path] = t.custom_name.trim();
          }
        });
        return Object.keys(map).length > 0 ? map : undefined;
      })(),
    };
    try {
      localStorage.setItem("speed-order-hotkeys", JSON.stringify(customHotkeys));
      localStorage.setItem("speed-order-contract-size", customContractSize.toString());
      localStorage.setItem("replay_economic_data_dir", customEconomicDataDir);
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
    localStorage.setItem("replay_economic_data_dir", newDir);
    try {
      await invoke("save_settings", {
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
      await invoke("select_profile", {
        terminalPath: selectedTerminal,
        profileName: selectedProfile,
      });

      // 現在の設定を保存
      await saveAllSettings();

      // 経済指標スケジュールCSVの事前取得（有効時）
      let economicEventsCsv = "";
      if (enablePseudoRate) {
        try {
          economicEventsCsv = await invoke<string>("get_economic_schedule_csv", {
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
        limit_tick_history: limitTickHistory,
        tick_history_timeframe: tickHistoryTimeframe,
        max_history_bars: maxHistoryBars,
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

    setPseudoBaseSpread(0.2);
    setPseudoThreshold(1.5);
    setPseudoSensitivity(0.25);
    setPseudoRolloverSpread(3.8);
    setPseudoRolloverRecoveryMin(15);
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
      const res = await invoke<SavedSession[]>("get_saved_sessions");
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
      localStorage.setItem("speed-order-contract-size", String(session.settings.contract_size));
    }
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
      await invoke("select_profile", {
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
        limit_tick_history: session.settings.limit_tick_history !== undefined ? session.settings.limit_tick_history : true,
        tick_history_timeframe: session.settings.tick_history_timeframe || "M5",
        max_history_bars: session.settings.max_history_bars !== undefined ? session.settings.max_history_bars : 300,
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
      theme,
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
  const sessions = organizeSessions(sessionBoundaries);
  const currentSession = getCurrentSession(sessions, currentIdx);

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
        theme={theme}
        setTheme={setTheme}
        cycleTheme={cycleTheme}
        saveAllSettings={saveAllSettings}
        hotkeys={hotkeys}
        timePresets={timePresets}
        tickPresets={tickPresets}
        handleAlwaysOnTopToggle={handleAlwaysOnTopToggle}
        handleShortcutsToggle={handleShortcutsToggle}
        toggleRemoteMode={toggleRemoteMode}
        handleTerminate={handleTerminate}
        setIsSettingsOpen={setIsSettingsOpen}
        setIsAIPanelOpen={setIsAIPanelOpen}
        setAiTargetTimeMsc={setAiTargetTimeMsc}
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
          limitTickHistory={limitTickHistory}
          setLimitTickHistory={setLimitTickHistory}
          tickHistoryTimeframe={tickHistoryTimeframe}
          setTickHistoryTimeframe={setTickHistoryTimeframe}
          maxHistoryBars={maxHistoryBars}
          setMaxHistoryBars={setMaxHistoryBars}
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
        limitTickHistory={limitTickHistory}
        setLimitTickHistory={setLimitTickHistory}
        tickHistoryTimeframe={tickHistoryTimeframe}
        setTickHistoryTimeframe={setTickHistoryTimeframe}
        maxHistoryBars={maxHistoryBars}
        setMaxHistoryBars={setMaxHistoryBars}
        autoScrollSync={autoScrollSync}
        setAutoScrollSync={setAutoScrollSync}
        autoSkipWeekend={autoSkipWeekend}
        handleAutoSkipWeekendToggle={handleAutoSkipWeekendToggle}
        alwaysOnTop={alwaysOnTop}
        handleAlwaysOnTopToggle={handleAlwaysOnTopToggle}
        isShortcutsActive={isShortcutsActive}
        handleShortcutsToggle={handleShortcutsToggle}
        theme={theme}
        setTheme={setTheme}
        plColorStyle={plColorStyle}
        setPlColorStyle={setPlColorStyle}
        openRouterApiKey={openRouterApiKey}
        setOpenRouterApiKey={setOpenRouterApiKey}
        openRouterModel={openRouterModel}
        setOpenRouterModel={setOpenRouterModel}
        fredApiKey={fredApiKey}
        setFredApiKey={setFredApiKey}
        finnhubApiKey={finnhubApiKey}
        setFinnhubApiKey={setFinnhubApiKey}
        openRouterTestResult={openRouterTestResult}
        fredTestResult={fredTestResult}
        finnhubTestResult={finnhubTestResult}
        gdeltTestResult={gdeltTestResult}
        isTestingAllApis={isTestingAllApis}
        handleTestOpenRouter={handleTestOpenRouter}
        handleTestFred={handleTestFred}
        handleTestFinnhub={handleTestFinnhub}
        handleTestGdelt={handleTestGdelt}
        handleTestAllApis={handleTestAllApis}
        saveAllSettings={saveAllSettings}
        timePresets={timePresets}
        tickPresets={tickPresets}
        economicDataDir={economicDataDir}
        setEconomicDataDir={saveEconomicDataDir}
      />

      {/* AI Analysis Panel */}
      <AIAnalysisPanel
        isOpen={isAIPanelOpen}
        onClose={() => setIsAIPanelOpen(false)}
        virtualTimeMsc={aiTargetTimeMsc || virtualTimeMsc}
        symbol={sourceSymbol}
        newsItems={[]}
        openRouterApiKey={openRouterApiKey}
        openRouterModel={openRouterModel}
        fredApiKey={fredApiKey}
        finnhubApiKey={finnhubApiKey}
        timezoneMode={timezoneMode}
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
      {isClearAllSessionsConfirmOpen && (
        <div className="modal-overlay" onClick={() => setIsClearAllSessionsConfirmOpen(false)}>
          <div className="modal-container" style={{ maxWidth: "400px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="material-symbols-outlined" style={{ color: "var(--status-danger)" }}>
                  delete_sweep
                </span>
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
              <button className="pro-btn" style={{ flex: 1 }} onClick={() => setIsClearAllSessionsConfirmOpen(false)}>
                キャンセル
              </button>
              <button className="pro-btn danger-filled" style={{ flex: 1 }} onClick={executeClearAllSessions}>
                一括削除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Replay Modal */}
      {isResetReplayConfirmOpen && (
        <div className="modal-overlay" onClick={() => setIsResetReplayConfirmOpen(false)}>
          <div className="modal-container" style={{ maxWidth: "400px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="material-symbols-outlined text-accent" style={{ color: "var(--primary-color)" }}>
                  restart_alt
                </span>
                リプレイ設定のリセット
              </h3>
              <button className="modal-close-btn" onClick={() => setIsResetReplayConfirmOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "12px", lineHeight: "1.6" }}>
              <div style={{ fontSize: "12px", textAlign: "center" }}>
                リプレイ設定をデフォルト値にリセットしますか？
              </div>
            </div>
            <div className="modal-footer" style={{ padding: "12px 16px", display: "flex", gap: "8px", width: "100%", boxSizing: "border-box" }}>
              <button className="pro-btn" style={{ flex: 1 }} onClick={() => setIsResetReplayConfirmOpen(false)}>
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

      {/* Reset Trading Modal */}
      {isResetTradingConfirmOpen && (
        <div className="modal-overlay" onClick={() => setIsResetTradingConfirmOpen(false)}>
          <div className="modal-container" style={{ maxWidth: "400px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="material-symbols-outlined text-accent" style={{ color: "var(--primary-color)" }}>
                  restart_alt
                </span>
                取引設定のリセット
              </h3>
              <button className="modal-close-btn" onClick={() => setIsResetTradingConfirmOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "12px", lineHeight: "1.6" }}>
              <div style={{ fontSize: "12px", textAlign: "center" }}>
                取引設定をデフォルト値にリセットしますか？
              </div>
            </div>
            <div className="modal-footer" style={{ padding: "12px 16px", display: "flex", gap: "8px", width: "100%", boxSizing: "border-box" }}>
              <button className="pro-btn" style={{ flex: 1 }} onClick={() => setIsResetTradingConfirmOpen(false)}>
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

      {/* Max Bars Warning Modal */}
      {isMaxBarsWarningOpen && (
        <div className="modal-overlay" onClick={() => setIsMaxBarsWarningOpen(false)}>
          <div className="modal-container" style={{ maxWidth: "400px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "6px", color: "#ffb74d" }}>
                <span className="material-symbols-outlined" style={{ color: "#ffb74d" }}>
                  warning
                </span>
                チャート最大バー数の確認
              </h3>
              <button className="modal-close-btn" onClick={() => setIsMaxBarsWarningOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "10px", lineHeight: "1.5" }}>
              <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--on-surface)" }}>
                MT5の「チャートの最大バー数」が無制限に設定されていません。
              </div>
              <div style={{ backgroundColor: "rgba(255, 183, 77, 0.1)", border: "1px dashed rgba(255, 183, 77, 0.4)", borderRadius: "6px", padding: "8px 10px", fontSize: "11px" }}>
                <div>
                  <strong>現在の設定:</strong>{" "}
                  {maxBarsInfo ? (maxBarsInfo.max_bars > 0 ? `${maxBarsInfo.max_bars.toLocaleString()} 本` : maxBarsInfo.raw_value) : "未検出"}
                </div>
              </div>
              <div style={{ fontSize: "11px", color: "var(--on-surface-variant)" }}>
                ※ 過去データ検証時にインジケータを正確に計算するため、MT5の [ツール] → [オプション] → [チャート] で「無制限」に設定することを推奨します。
              </div>
            </div>
            <div className="modal-footer" style={{ padding: "12px 16px", display: "flex", gap: "8px", width: "100%", boxSizing: "border-box" }}>
              <button type="button" className="pro-btn" style={{ flex: 1 }} onClick={() => setIsMaxBarsWarningOpen(false)}>
                戻る
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
                開始する
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
                <span className="material-symbols-outlined icon-accent" style={{ color: "var(--primary-color)" }}>
                  save
                </span>
                {sessionSaveType === "terminate" ? "セッションを保存して終了" : "現在の状態を保存"}
              </h3>
              <button className="modal-close-btn" onClick={() => setIsSaveSessionOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ marginBottom: "4px" }}>
                  セッション名
                </label>
                <input
                  type="text"
                  className="input-compact"
                  value={saveSessionName}
                  onChange={(e) => setSaveSessionName(e.target.value)}
                  placeholder="セッション名を入力してください"
                />
              </div>
              {currentSessionId && (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "2px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "11.5px", color: "var(--on-surface)" }}>
                    <input
                      type="checkbox"
                      checked={saveAsNewSnapshot}
                      onChange={(e) => setSaveAsNewSnapshot(e.target.checked)}
                    />
                    新規スナップショットとして保存
                  </label>
                  <span style={{ fontSize: "9.5px", color: "var(--on-surface-variant)", marginLeft: "18px" }}>
                    {saveAsNewSnapshot
                      ? "現在の履歴を上書きせず、新しい履歴として保存します。"
                      : `既存データ（${currentSessionName}）に上書き保存します。`}
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
                  保存せず終了
                </button>
              )}
              <button className="pro-btn" onClick={() => setIsSaveSessionOpen(false)}>
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

      {/* Time Steps Modal */}
      {isTimeStepsModalOpen && (
        <div className="modal-overlay" onClick={() => setIsTimeStepsModalOpen(false)}>
          <div className="modal-container" style={{ maxWidth: "420px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="material-symbols-outlined icon-accent" style={{ color: "var(--primary-color)" }}>
                  tune
                </span>
                Time Steps 設定 (最大5枠)
              </h3>
              <button className="modal-close-btn" onClick={() => setIsTimeStepsModalOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <div className="form-label" style={{ marginBottom: "4px" }}>
                  プリセットから追加:
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                  {PRESET_TIME_OPTIONS.map((preset) => {
                    const isAlreadyAdded = editingTimeSteps.some((item) => item.seconds === preset.seconds);
                    const isMax = editingTimeSteps.length >= 5;
                    return (
                      <button
                        key={preset.label}
                        className="chip-btn"
                        disabled={isAlreadyAdded || isMax}
                        style={{
                          opacity: isAlreadyAdded || isMax ? 0.4 : 1,
                          cursor: isAlreadyAdded || isMax ? "not-allowed" : "pointer",
                        }}
                        onClick={() => {
                          if (editingTimeSteps.length < 5 && !isAlreadyAdded) {
                            const updated = [
                              ...editingTimeSteps,
                              { id: `ts-${Date.now()}-${Math.random()}`, seconds: preset.seconds, label: preset.label },
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

              <div>
                <div className="form-label" style={{ marginBottom: "6px" }}>
                  設定中のステップ ({editingTimeSteps.length}/5):
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {editingTimeSteps.map((step, index) => (
                    <div
                      key={step.id || index}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        backgroundColor: "#161922",
                        padding: "4px 8px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid rgba(255, 255, 255, 0.06)",
                      }}
                    >
                      <span className="font-data" style={{ fontSize: "11px", color: "var(--on-surface-variant)", width: "16px" }}>
                        #{index + 1}
                      </span>
                      <input
                        type="number"
                        className="input-compact"
                        style={{ width: "65px", textAlign: "right" }}
                        value={step.seconds}
                        min={1}
                        max={86400}
                        onChange={(e) => {
                          const val = Math.max(1, parseInt(e.target.value) || 1);
                          const updated = [...editingTimeSteps];
                          updated[index] = {
                            ...updated[index],
                            seconds: val,
                            label: formatSecondsToLabel(val),
                          };
                          setEditingTimeSteps(updated);
                        }}
                      />
                      <span style={{ fontSize: "10px", color: "var(--on-surface-variant)" }}>秒</span>
                      <input
                        type="text"
                        className="input-compact"
                        style={{ width: "50px", fontWeight: 700, marginLeft: "auto" }}
                        value={step.label}
                        onChange={(e) => {
                          const updated = [...editingTimeSteps];
                          updated[index] = { ...updated[index], label: e.target.value };
                          setEditingTimeSteps(updated);
                        }}
                      />
                      <button
                        className="btn-danger-compact"
                        style={{ width: "22px", height: "22px", padding: 0, justifyContent: "center" }}
                        disabled={editingTimeSteps.length <= 1}
                        onClick={() => {
                          if (editingTimeSteps.length > 1) {
                            setEditingTimeSteps(editingTimeSteps.filter((_, i) => i !== index));
                          }
                        }}
                      >
                        <span className="material-symbols-outlined text-[12px]">delete</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="modal-footer" style={{ padding: "10px 16px", display: "flex", gap: "8px", justifyContent: "space-between" }}>
              <button
                className="pro-btn"
                onClick={() => setEditingTimeSteps([...DEFAULT_TIME_STEPS].sort((a, b) => a.seconds - b.seconds))}
              >
                初期化
              </button>
              <div style={{ display: "flex", gap: "6px" }}>
                <button className="pro-btn" onClick={() => setIsTimeStepsModalOpen(false)}>
                  キャンセル
                </button>
                <button
                  className="pro-btn primary"
                  onClick={() => {
                    setTimeSteps(editingTimeSteps);
                    setIsTimeStepsModalOpen(false);
                  }}
                >
                  反映
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Speed Presets Modal */}
      {isSpeedPresetsModalOpen && (
        <div className="modal-overlay" onClick={() => setIsSpeedPresetsModalOpen(false)}>
          <div className="modal-container" style={{ maxWidth: "420px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="material-symbols-outlined icon-accent" style={{ color: "var(--primary-color)" }}>
                  tune
                </span>
                速度プリセット設定
              </h3>
              <button className="modal-close-btn" onClick={() => setIsSpeedPresetsModalOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
              {/* Time Presets */}
              <div>
                <div className="form-label" style={{ marginBottom: "4px" }}>
                  時間比率モード (倍率):
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "6px" }}>
                  {editingTimePresets.map((val, idx) => (
                    <span
                      key={idx}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "3px",
                        background: "#161922",
                        border: "1px solid rgba(255, 255, 255, 0.08)",
                        borderRadius: "12px",
                        padding: "2px 8px",
                        fontSize: "11px",
                      }}
                    >
                      {val}x
                      <button
                        type="button"
                        style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", padding: 0 }}
                        onClick={() => setEditingTimePresets(editingTimePresets.filter((_, i) => i !== idx))}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div style={{ display: "flex", gap: "4px" }}>
                  <input
                    type="number"
                    step="0.1"
                    className="input-compact"
                    placeholder="例: 15.0"
                    value={modalNewTimePreset}
                    onChange={(e) => setModalNewTimePreset(e.target.value)}
                  />
                  <button
                    type="button"
                    className="pro-btn primary"
                    onClick={() => {
                      const num = parseFloat(modalNewTimePreset);
                      if (!isNaN(num) && num > 0 && !editingTimePresets.includes(num)) {
                        setEditingTimePresets([...editingTimePresets, num].sort((a, b) => a - b));
                        setModalNewTimePreset("");
                      }
                    }}
                  >
                    追加
                  </button>
                </div>
              </div>

              {/* Tick Presets */}
              <div>
                <div className="form-label" style={{ marginBottom: "4px" }}>
                  ティック数モード (枚数):
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "6px" }}>
                  {editingTickPresets.map((val, idx) => (
                    <span
                      key={idx}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "3px",
                        background: "#161922",
                        border: "1px solid rgba(255, 255, 255, 0.08)",
                        borderRadius: "12px",
                        padding: "2px 8px",
                        fontSize: "11px",
                      }}
                    >
                      {val}T
                      <button
                        type="button"
                        style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", padding: 0 }}
                        onClick={() => setEditingTickPresets(editingTickPresets.filter((_, i) => i !== idx))}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div style={{ display: "flex", gap: "4px" }}>
                  <input
                    type="number"
                    step="1"
                    className="input-compact"
                    placeholder="例: 20"
                    value={modalNewTickPreset}
                    onChange={(e) => setModalNewTickPreset(e.target.value)}
                  />
                  <button
                    type="button"
                    className="pro-btn primary"
                    onClick={() => {
                      const num = parseInt(modalNewTickPreset);
                      if (!isNaN(num) && num > 0 && !editingTickPresets.includes(num)) {
                        setEditingTickPresets([...editingTickPresets, num].sort((a, b) => a - b));
                        setModalNewTickPreset("");
                      }
                    }}
                  >
                    追加
                  </button>
                </div>
              </div>
            </div>

            <div className="modal-footer" style={{ padding: "10px 16px", display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button className="pro-btn" onClick={() => setIsSpeedPresetsModalOpen(false)}>
                キャンセル
              </button>
              <button
                className="pro-btn primary"
                onClick={() => {
                  setTimePresets(editingTimePresets);
                  setTickPresets(editingTickPresets);
                  saveAllSettings(hotkeys, editingTimePresets, editingTickPresets, theme);
                  setIsSpeedPresetsModalOpen(false);
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
