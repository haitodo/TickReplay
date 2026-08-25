import React, { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getMonthRange } from "../utils/dateUtils";

export interface ScannedZipFile {
  year_month: string;
  file_path: string;
  already_imported: boolean;
}

export interface ScannedPairGroup {
  category: string;
  broker?: string;
  year?: string;
  pair_name: string;
  suggested_symbol_name: string;
  group_path: string;
  files: ScannedZipFile[];
  already_exists_in_mt5: boolean;
}

interface CustomSymbolImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  terminalPath: string;
  terminalName?: string;
  onImportComplete?: () => void;
  onApplyToReplay?: (
    sourceSymbol: string,
    syncSymbols: string[],
    dateRange?: { start: string; end: string }
  ) => void;
}

const STORAGE_KEY = "custom_symbol_import_root_dir";

export const CustomSymbolImportModal: React.FC<CustomSymbolImportModalProps> = ({
  isOpen,
  onClose,
  terminalPath,
  terminalName,
  onImportComplete,
  onApplyToReplay
}) => {
  // 初期フォルダパス: localStorageから取得、なければ D:\TickData
  const [rootDir, setRootDir] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY) || "D:\\TickData";
  });
  const [scannedGroups, setScannedGroups] = useState<ScannedPairGroup[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [symbolNames, setSymbolNames] = useState<{ [key: string]: string }>({});
  const [groupPaths, setGroupPaths] = useState<{ [key: string]: string }>({});
  const [selectedMonths, setSelectedMonths] = useState<{ [filePath: string]: boolean }>({});

  // フィルタリング用ステート
  const [selectedBrokerFilter, setSelectedBrokerFilter] = useState<string>("ALL");
  const [selectedYearFilter, setSelectedYearFilter] = useState<string>("ALL");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<"ALL" | "unimported_only" | "imported_only">("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, currentLabel: "", ticksCount: 0 });
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [mt5Connected, setMt5Connected] = useState<boolean | null>(null);
  const [lastImportedSymbols, setLastImportedSymbols] = useState<string[]>([]);
  const [lastImportedMonths, setLastImportedMonths] = useState<string[]>([]);
  const [importCompletedSuccessfully, setImportCompletedSuccessfully] = useState(false);

  const cancelImportRef = useRef(false);

  const getGroupKey = (g: { category?: string; pair_name: string; suggested_symbol_name?: string }) => {
    return g.suggested_symbol_name || `${g.category || "Custom"}_${g.pair_name}`;
  };

  const getGroupBroker = (g: ScannedPairGroup): string => {
    if (g.broker && g.broker.trim() && g.broker.toLowerCase() !== "custom") return g.broker;
    if (g.category && !/^\d{4}$/.test(g.category) && g.category.toLowerCase() !== "custom") return g.category;
    return "Custom";
  };

  const getGroupYear = (g: ScannedPairGroup): string => {
    if (g.year && /^\d{4}$/.test(g.year)) return g.year;
    if (g.category && /^\d{4}$/.test(g.category)) return g.category;
    if (g.files.length > 0 && g.files[0].year_month) {
      const match = g.files[0].year_month.match(/^(\d{4})/);
      if (match) return match[1];
    }
    const matchSym = g.suggested_symbol_name.match(/_(\d{4})(?:_|$)/);
    if (matchSym) return matchSym[1];
    return "";
  };

  // モーダル表示時に MT5 EA 接続状態を確認 ＆ 自動スキャン
  useEffect(() => {
    if (isOpen) {
      checkMt5Connection();
      setImportCompletedSuccessfully(false);
      setLastImportedSymbols([]);
      if (rootDir && rootDir.trim()) {
        handleScanWithDir(rootDir.trim());
      }
    }
  }, [isOpen]);

  const checkMt5Connection = async (): Promise<boolean> => {
    try {
      const statusStr = await invoke<string>("get_last_status");
      const isConnected = !!(statusStr && statusStr.trim().length > 0);
      setMt5Connected(isConnected);
      return isConnected;
    } catch {
      setMt5Connected(false);
      return false;
    }
  };

  // フォルダパスの保存・更新
  const updateRootDir = (path: string) => {
    setRootDir(path);
    if (path.trim()) {
      localStorage.setItem(STORAGE_KEY, path.trim());
    }
  };

  const handleBrowseFolder = async () => {
    try {
      const selected = await invoke<string | null>("select_folder");
      if (selected) {
        updateRootDir(selected);
        handleScanWithDir(selected);
      }
    } catch (err: any) {
      console.error("Failed to open folder picker:", err);
    }
  };

  const handleScanWithDir = async (targetDir: string) => {
    if (!targetDir.trim()) {
      setErrorMessage("フォルダパスを入力してください");
      return;
    }
    updateRootDir(targetDir);
    setErrorMessage("");
    setIsScanning(true);
    setImportCompletedSuccessfully(false);
    try {
      const groups = await invoke<ScannedPairGroup[]>("scan_custom_symbol_files", {
        rootDir: targetDir,
        terminalPath
      });
      setScannedGroups(groups);
      setSelectedBrokerFilter("ALL");
      setSelectedYearFilter("ALL");
      setSelectedStatusFilter("ALL");
      setSearchQuery("");

      // 初期値設定
      const initialNames: { [key: string]: string } = {};
      const initialGroups: { [key: string]: string } = {};
      const initialMonths: { [filePath: string]: boolean } = {};

      groups.forEach(g => {
        const key = getGroupKey(g);
        initialNames[key] = g.suggested_symbol_name;
        initialGroups[key] = g.group_path || (g.category && g.category !== "Custom" ? g.category : "Custom");

        g.files.forEach(f => {
          // すでにインポート済みの場合はデフォルトチェックOFF (スキップ)、未インポートならチェックON
          initialMonths[f.file_path] = !f.already_imported;
        });
      });

      setSymbolNames(initialNames);
      setGroupPaths(initialGroups);
      setSelectedMonths(initialMonths);

      if (groups.length === 0) {
        setErrorMessage("指定されたフォルダ内に ZIP データが見つかりませんでした。");
      }
    } catch (e: any) {
      setErrorMessage("フォルダ走査中にエラーが発生しました: " + (e?.message || e));
    } finally {
      setIsScanning(false);
    }
  };

  const handleScan = () => {
    handleScanWithDir(rootDir);
  };

  // 全業者リスト
  const allBrokers = useMemo(() => {
    const set = new Set<string>();
    scannedGroups.forEach(g => {
      const b = getGroupBroker(g);
      if (b) set.add(b);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [scannedGroups]);

  // 全年度リスト
  const allYears = useMemo(() => {
    const set = new Set<string>();
    scannedGroups.forEach(g => {
      const y = getGroupYear(g);
      if (y) set.add(y);
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [scannedGroups]);

  // 各年度のインポート統計
  const yearStatsMap = useMemo(() => {
    const map: { [year: string]: { totalFiles: number; importedFiles: number; totalGroups: number; completedGroups: number } } = {};
    scannedGroups.forEach(g => {
      const y = getGroupYear(g) || "Other";
      if (!map[y]) {
        map[y] = { totalFiles: 0, importedFiles: 0, totalGroups: 0, completedGroups: 0 };
      }
      map[y].totalGroups++;
      map[y].totalFiles += g.files.length;
      const importedInGroup = g.files.filter(f => f.already_imported).length;
      map[y].importedFiles += importedInGroup;
      if (importedInGroup === g.files.length && g.files.length > 0) {
        map[y].completedGroups++;
      }
    });
    return map;
  }, [scannedGroups]);

  // フィルタリング適用後のグループ
  const filteredGroups = useMemo(() => {
    return scannedGroups.filter(g => {
      const b = getGroupBroker(g);
      const y = getGroupYear(g);
      if (selectedBrokerFilter !== "ALL" && b !== selectedBrokerFilter) return false;
      if (selectedYearFilter !== "ALL" && y !== selectedYearFilter) return false;
      
      const totalFiles = g.files.length;
      const importedFiles = g.files.filter(f => f.already_imported).length;
      const isComplete = importedFiles === totalFiles && totalFiles > 0;
      
      if (selectedStatusFilter === "unimported_only" && isComplete) return false;
      if (selectedStatusFilter === "imported_only" && !isComplete) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.trim().toUpperCase();
        const key = getGroupKey(g);
        const symName = symbolNames[key] || g.suggested_symbol_name || "";
        if (
          !g.pair_name.toUpperCase().includes(q) &&
          !symName.toUpperCase().includes(q) &&
          !b.toUpperCase().includes(q) &&
          !y.includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [scannedGroups, selectedBrokerFilter, selectedYearFilter, selectedStatusFilter, searchQuery, symbolNames]);

  // フィルタ後のファイル一覧
  const visibleFiles = useMemo(() => {
    const list: ScannedZipFile[] = [];
    filteredGroups.forEach(g => {
      g.files.forEach(f => list.push(f));
    });
    return list;
  }, [filteredGroups]);

  const visibleSelectedCount = useMemo(() => {
    return visibleFiles.filter(f => selectedMonths[f.file_path]).length;
  }, [visibleFiles, selectedMonths]);

  // 表示中の一括選択・解除
  const handleSelectVisibleFiles = (mode: "all" | "none" | "unimported") => {
    setSelectedMonths(prev => {
      const next = { ...prev };
      filteredGroups.forEach(g => {
        g.files.forEach(f => {
          if (mode === "all") {
            next[f.file_path] = true;
          } else if (mode === "none") {
            next[f.file_path] = false;
          } else if (mode === "unimported") {
            next[f.file_path] = !f.already_imported;
          }
        });
      });
      return next;
    });
  };

  // 特定の年グループ単位の一括選択・解除
  const handleSelectYearGroups = (groupsInYear: ScannedPairGroup[], mode: "all" | "none" | "unimported") => {
    setSelectedMonths(prev => {
      const next = { ...prev };
      groupsInYear.forEach(g => {
        g.files.forEach(f => {
          if (mode === "all") {
            next[f.file_path] = true;
          } else if (mode === "none") {
            next[f.file_path] = false;
          } else if (mode === "unimported") {
            next[f.file_path] = !f.already_imported;
          }
        });
      });
      return next;
    });
  };

  // 単一ペア単位の一括選択・解除
  const handleSelectGroupFiles = (files: ScannedZipFile[], mode: "all" | "none" | "unimported") => {
    setSelectedMonths(prev => {
      const next = { ...prev };
      files.forEach(f => {
        if (mode === "all") {
          next[f.file_path] = true;
        } else if (mode === "none") {
          next[f.file_path] = false;
        } else if (mode === "unimported") {
          next[f.file_path] = !f.already_imported;
        }
      });
      return next;
    });
  };

  const handleStopImport = () => {
    cancelImportRef.current = true;
  };

  const handleStartImport = async () => {
    if (!terminalPath) {
      setErrorMessage("MT5ターミナルが選択されていません。セットアップ画面でターミナルを選択してください。");
      return;
    }

    // 事前に MT5 接続状態をチェック
    const isConnected = await checkMt5Connection();
    if (!isConnected) {
      setErrorMessage("MetaTrader 5 (EA) が起動・接続されていません。MT5を起動し、EAが通信可能な状態にしてからインポートを開始してください。");
      return;
    }

    // インポート対象のファイルをリストアップ
    const itemsToImport: {
      pairName: string;
      symbolName: string;
      groupPath: string;
      filePath: string;
      yearMonth: string;
    }[] = [];

    const importedSymbolSet = new Set<string>();

    scannedGroups.forEach(g => {
      const key = getGroupKey(g);
      const symName = symbolNames[key] || g.suggested_symbol_name || `${g.pair_name}_Custom`;
      const grpPath = groupPaths[key] || g.group_path || (g.category && g.category !== "Custom" ? g.category : "Custom");

      g.files.forEach(f => {
        if (selectedMonths[f.file_path]) {
          itemsToImport.push({
            pairName: g.pair_name,
            symbolName: symName,
            groupPath: grpPath,
            filePath: f.file_path,
            yearMonth: f.year_month
          });
          importedSymbolSet.add(symName);
        }
      });
    });

    if (itemsToImport.length === 0) {
      setErrorMessage("インポート対象のデータが選択されていません。");
      return;
    }

    cancelImportRef.current = false;
    setIsImporting(true);
    setImportCompletedSuccessfully(false);
    setErrorMessage("");
    setLogs([]);
    setImportProgress({ current: 0, total: itemsToImport.length, currentLabel: "", ticksCount: 0 });

    let successCount = 0;
    let totalTicksTotal = 0;

    for (let i = 0; i < itemsToImport.length; i++) {
      if (cancelImportRef.current) {
        setLogs(prev => [...prev, "⏹️ [中断] ユーザーによってインポート処理が停止されました。"]);
        break;
      }

      const item = itemsToImport[i];
      const label = `${item.symbolName} (${item.yearMonth})`;
      setImportProgress({
        current: i + 1,
        total: itemsToImport.length,
        currentLabel: label,
        ticksCount: totalTicksTotal
      });

      try {
        const tickCount = await invoke<number>("import_custom_symbol_chunk", {
          symbolName: item.symbolName,
          groupPath: item.groupPath,
          baseSymbol: item.pairName,
          zipPath: item.filePath,
          yearMonth: item.yearMonth,
          terminalPath
        });

        totalTicksTotal += tickCount;
        successCount++;
        setLogs(prev => [...prev, `✅ [成功] ${label}: ${tickCount.toLocaleString()} ティックをインポートしました`]);
      } catch (err: any) {
        setLogs(prev => [...prev, `❌ [失敗] ${label}: ${err?.message || err}`]);
      }
    }

    setIsImporting(false);
    if (!cancelImportRef.current && successCount > 0) {
      setImportCompletedSuccessfully(true);
      setLastImportedSymbols(Array.from(importedSymbolSet));
      setLastImportedMonths(itemsToImport.map(it => it.yearMonth).filter(Boolean).sort());
      setLogs(prev => [...prev, `🎉 インポート完了! 合計 ${successCount}/${itemsToImport.length} 件 (${totalTicksTotal.toLocaleString()} ティック)`]);
    }

    if (onImportComplete) {
      onImportComplete();
    }
  };

  // インポート完了シンボルをリプレイ設定に反映
  const handleApplyToReplay = () => {
    if (!onApplyToReplay || lastImportedSymbols.length === 0) return;

    let primary = lastImportedSymbols.find(s => s.toUpperCase().includes("USDJPY")) || lastImportedSymbols[0];
    let syncList = lastImportedSymbols.filter(s => s !== primary);

    const matchYear = primary.match(/_(\d{4})$/);
    let dateRange: { start: string; end: string } | undefined = undefined;

    if (lastImportedMonths.length > 0) {
      // 最初にインポートされた月をデフォルトの1ヶ月期間として設定 (例: "2024.05" -> 2024年5月1日〜5月31日)
      const firstYM = lastImportedMonths[0];
      const match = firstYM.match(/^(\d{4})[._-]?(\d{2})/);
      if (match) {
        const y = parseInt(match[1]);
        const m = parseInt(match[2]);
        dateRange = getMonthRange(y, m);
      }
    }

    if (!dateRange && matchYear) {
      const year = parseInt(matchYear[1]);
      dateRange = getMonthRange(year, 1);
    }

    onApplyToReplay(primary, syncList, dateRange);
    onClose();
  };

  // ブローカー > 年度 > ペア一覧の階層構造を作成
  interface BrokerSection {
    broker: string;
    years: {
      year: string;
      groups: ScannedPairGroup[];
      totalFiles: number;
      importedFiles: number;
      isAllCompleted: boolean;
    }[];
    totalFiles: number;
    importedFiles: number;
  }

  const brokerSections: BrokerSection[] = useMemo(() => {
    const brokerMap: { [broker: string]: { [year: string]: ScannedPairGroup[] } } = {};
    filteredGroups.forEach(g => {
      const b = getGroupBroker(g);
      const y = getGroupYear(g) || "Custom";
      if (!brokerMap[b]) brokerMap[b] = {};
      if (!brokerMap[b][y]) brokerMap[b][y] = [];
      brokerMap[b][y].push(g);
    });

    const sections: BrokerSection[] = [];
    Object.keys(brokerMap).sort((a, b) => a.localeCompare(b)).forEach(b => {
      const yearMap = brokerMap[b];
      const yearsList: { year: string; groups: ScannedPairGroup[]; totalFiles: number; importedFiles: number; isAllCompleted: boolean }[] = [];
      let bTotal = 0;
      let bImported = 0;

      Object.keys(yearMap).sort((a, b) => {
        const isYearA = /^\d{4}$/.test(a);
        const isYearB = /^\d{4}$/.test(b);
        if (isYearA && isYearB) return b.localeCompare(a); // 降順
        if (isYearA) return -1;
        if (isYearB) return 1;
        return a.localeCompare(b);
      }).forEach(y => {
        const groups = yearMap[y];
        const totalFiles = groups.reduce((acc, g) => acc + g.files.length, 0);
        const importedFiles = groups.reduce((acc, g) => acc + g.files.filter(f => f.already_imported).length, 0);
        const isAllCompleted = importedFiles === totalFiles && totalFiles > 0;
        bTotal += totalFiles;
        bImported += importedFiles;
        yearsList.push({ year: y, groups, totalFiles, importedFiles, isAllCompleted });
      });

      sections.push({
        broker: b,
        years: yearsList,
        totalFiles: bTotal,
        importedFiles: bImported
      });
    });

    return sections;
  }, [filteredGroups]);

  const totalScannedFilesCount = scannedGroups.reduce((acc, g) => acc + g.files.length, 0);
  const totalScannedImportedCount = scannedGroups.reduce((acc, g) => acc + g.files.filter(f => f.already_imported).length, 0);

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 2000
      }}
    >
      <div
        className="pro-panel"
        style={{
          width: "860px",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "var(--surface-charcoal)",
          border: "1px solid var(--outline-variant)",
          borderRadius: "var(--radius-lg, 12px)",
          boxShadow: "var(--shadow-modal)",
          overflow: "hidden"
        }}
      >
        {/* Header */}
        <div className="pro-panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 18px", borderBottom: "1px solid var(--outline-variant)", flexShrink: 0 }}>
          <h3 className="pro-panel-title" style={{ display: "flex", alignItems: "center", gap: "8px", margin: 0, fontSize: "15px" }}>
            <span className="material-symbols-outlined icon-accent">database_upload</span>
            カスタムシンボル構築・一括インポート
          </h3>
          <button
            type="button"
            className="pro-btn"
            onClick={onClose}
            disabled={isImporting}
            style={{ padding: "4px 8px", minWidth: "auto" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>close</span>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "14px 18px", flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px" }}>
          
          {/* MT5 接続ステータス表示 */}
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 12px",
            borderRadius: "6px",
            fontSize: "12px",
            backgroundColor: mt5Connected ? "var(--status-success-bg)" : "var(--status-danger-bg)",
            border: "1px solid " + (mt5Connected ? "var(--status-success)" : "var(--status-danger)"),
            color: mt5Connected ? "var(--status-success)" : "var(--status-danger)",
            fontWeight: 500,
            flexShrink: 0
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
              <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                {mt5Connected ? "power" : "power_off"}
              </span>
              <span>
                {mt5Connected
                  ? "MetaTrader 5 (EA) 通信接続中: インポート実行可能"
                  : "MetaTrader 5 (EA) 未接続: MT5を起動しEAをセットアップしてください"}
              </span>
              {terminalName && (
                <span style={{ fontSize: "11px", opacity: 0.85, marginLeft: "4px", backgroundColor: "var(--surface-container-high)", padding: "1px 6px", borderRadius: "4px" }}>
                  対象: {terminalName}
                </span>
              )}
            </div>
            <button
              type="button"
              className="pro-btn"
              onClick={checkMt5Connection}
              disabled={isImporting}
              style={{ padding: "2px 8px", fontSize: "11px", height: "22px", flexShrink: 0 }}
              title="MT5接続状態を再チェック"
            >
              再チェック
            </button>
          </div>

          {/* フォルダ指定とスキャン */}
          <div className="form-group" style={{ marginBottom: 0, flexShrink: 0 }}>
            <label className="form-label" style={{ fontSize: "11px" }}>データ格納ディレクトリパス (業者フォルダや年別ZIPフォルダ)</label>
            <div className="input-with-button-container">
              <input
                type="text"
                className="pro-input input-with-button"
                value={rootDir}
                onChange={(e) => updateRootDir(e.target.value)}
                placeholder="e.g. D:\TickData または D:\TickData\OANDA"
                disabled={isImporting}
                style={{ fontSize: "12px" }}
              />
              <button
                type="button"
                className="pro-btn"
                onClick={handleBrowseFolder}
                disabled={isScanning || isImporting}
                style={{ padding: "0 10px", height: "30px", fontSize: "11px", display: "flex", alignItems: "center", gap: "4px" }}
                title="OSのフォルダ選択ダイアログを開く"
              >
                <span className="material-symbols-outlined" style={{ fontSize: "15px" }}>folder_open</span>
                参照...
              </button>
              <button
                type="button"
                className="pro-btn pro-btn-primary"
                onClick={handleScan}
                disabled={isScanning || isImporting}
                style={{ padding: "0 14px", height: "30px", fontSize: "11px" }}
              >
                {isScanning ? "スキャン中..." : "スキャン"}
              </button>
            </div>
          </div>

          {errorMessage && (
            <div style={{ padding: "8px 12px", borderRadius: "6px", backgroundColor: "var(--status-danger-bg)", border: "1px solid var(--status-danger)", color: "var(--status-danger)", fontSize: "12px" }}>
              {errorMessage}
            </div>
          )}

          {/* フィルタコントロールバー（スキャン結果が存在する場合に表示） */}
          {scannedGroups.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                padding: "10px 12px",
                backgroundColor: "var(--surface-container-low)",
                borderRadius: "8px",
                border: "1px solid var(--outline-variant)",
                flexShrink: 0
              }}
            >
              {/* 業者 ＆ 状態 ＆ 検索 */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                {/* 業者フィルタ */}
                {allBrokers.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "11px", color: "var(--on-surface-variant)", fontWeight: 600 }}>業者:</span>
                    <button
                      type="button"
                      onClick={() => setSelectedBrokerFilter("ALL")}
                      style={{
                        padding: "2px 8px",
                        fontSize: "11px",
                        borderRadius: "4px",
                        border: `1px solid ${selectedBrokerFilter === "ALL" ? "var(--primary-color)" : "var(--outline-variant)"}`,
                        backgroundColor: selectedBrokerFilter === "ALL" ? "rgba(var(--primary-rgb), 0.15)" : "var(--btn-default-bg)",
                        color: selectedBrokerFilter === "ALL" ? "var(--primary-color)" : "var(--btn-default-color)",
                        cursor: "pointer",
                        fontWeight: selectedBrokerFilter === "ALL" ? 700 : "normal"
                      }}
                    >
                      全業者 ({scannedGroups.length})
                    </button>
                    {allBrokers.map(b => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => setSelectedBrokerFilter(b)}
                        style={{
                          padding: "2px 8px",
                          fontSize: "11px",
                          borderRadius: "4px",
                          border: `1px solid ${selectedBrokerFilter === b ? "var(--primary-color)" : "var(--outline-variant)"}`,
                          backgroundColor: selectedBrokerFilter === b ? "rgba(var(--primary-rgb), 0.15)" : "var(--btn-default-bg)",
                          color: selectedBrokerFilter === b ? "var(--primary-color)" : "var(--btn-default-color)",
                          cursor: "pointer",
                          fontWeight: selectedBrokerFilter === b ? 700 : "normal"
                        }}
                      >
                        🏢 {b}
                      </button>
                    ))}
                  </div>
                )}

                {/* 状態フィルタ ＆ 検索バー */}
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "auto" }}>
                  <div style={{ display: "flex", backgroundColor: "var(--surface-variant)", borderRadius: "4px", padding: "2px", border: "1px solid var(--outline-variant)" }}>
                    <button
                      type="button"
                      onClick={() => setSelectedStatusFilter("ALL")}
                      style={{
                        padding: "2px 6px",
                        fontSize: "10px",
                        border: "none",
                        borderRadius: "3px",
                        cursor: "pointer",
                        backgroundColor: selectedStatusFilter === "ALL" ? "var(--primary-color)" : "transparent",
                        color: selectedStatusFilter === "ALL" ? "var(--on-primary, #fff)" : "var(--on-surface-variant)"
                      }}
                    >
                      すべて
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedStatusFilter("unimported_only")}
                      style={{
                        padding: "2px 6px",
                        fontSize: "10px",
                        border: "none",
                        borderRadius: "3px",
                        cursor: "pointer",
                        backgroundColor: selectedStatusFilter === "unimported_only" ? "var(--status-warning)" : "transparent",
                        color: selectedStatusFilter === "unimported_only" ? "#1c1b1f" : "var(--on-surface-variant)",
                        fontWeight: selectedStatusFilter === "unimported_only" ? 700 : 400
                      }}
                      title="未完了のデータを含むシンボルのみ表示"
                    >
                      未完了のみ
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedStatusFilter("imported_only")}
                      style={{
                        padding: "2px 6px",
                        fontSize: "10px",
                        border: "none",
                        borderRadius: "3px",
                        cursor: "pointer",
                        backgroundColor: selectedStatusFilter === "imported_only" ? "var(--status-success)" : "transparent",
                        color: selectedStatusFilter === "imported_only" ? "#fff" : "var(--on-surface-variant)",
                        fontWeight: selectedStatusFilter === "imported_only" ? 700 : 400
                      }}
                      title="全月インポート完了済みのシンボルのみ表示"
                    >
                      完了のみ
                    </button>
                  </div>

                  <div style={{ position: "relative", width: "150px" }}>
                    <input
                      type="text"
                      className="pro-input"
                      placeholder="ペア・シンボル検索..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      style={{
                        width: "100%",
                        height: "24px",
                        fontSize: "11px",
                        paddingLeft: "22px",
                        paddingRight: searchQuery ? "20px" : "6px",
                        boxSizing: "border-box"
                      }}
                    />
                    <span
                      className="material-symbols-outlined"
                      style={{
                        position: "absolute",
                        left: "4px",
                        top: "4px",
                        fontSize: "14px",
                        color: "var(--on-surface-variant)",
                        pointerEvents: "none"
                      }}
                    >
                      search
                    </span>
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery("")}
                        style={{
                          position: "absolute",
                          right: "2px",
                          top: "2px",
                          background: "none",
                          border: "none",
                          color: "var(--on-surface-variant)",
                          cursor: "pointer",
                          padding: "2px"
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>close</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* 年度ピルバー (全年度・個別年ボタン) */}
              {allYears.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap", borderTop: "1px dashed var(--outline-variant)", paddingTop: "6px" }}>
                  <span style={{ fontSize: "11px", color: "var(--on-surface-variant)", fontWeight: 600 }}>年度:</span>
                  <button
                    type="button"
                    onClick={() => setSelectedYearFilter("ALL")}
                    style={{
                      padding: "2px 8px",
                      fontSize: "11px",
                      borderRadius: "4px",
                      border: `1px solid ${selectedYearFilter === "ALL" ? "var(--primary-color)" : "var(--outline-variant)"}`,
                      backgroundColor: selectedYearFilter === "ALL" ? "rgba(var(--primary-rgb), 0.15)" : "var(--btn-default-bg)",
                      color: selectedYearFilter === "ALL" ? "var(--primary-color)" : "var(--btn-default-color)",
                      cursor: "pointer",
                      fontWeight: selectedYearFilter === "ALL" ? 700 : "normal"
                    }}
                  >
                    全年度
                  </button>
                  {allYears.map(y => {
                    const stats = yearStatsMap[y];
                    const isAllDone = stats && stats.totalFiles > 0 && stats.importedFiles === stats.totalFiles;
                    const isPartial = stats && stats.importedFiles > 0 && stats.importedFiles < stats.totalFiles;

                    return (
                      <button
                        key={y}
                        type="button"
                        onClick={() => setSelectedYearFilter(y)}
                        style={{
                          padding: "2px 8px",
                          fontSize: "11px",
                          borderRadius: "4px",
                          border: `1px solid ${
                            selectedYearFilter === y
                              ? "var(--primary-color)"
                              : isAllDone
                              ? "var(--status-success)"
                              : isPartial
                              ? "var(--status-warning)"
                              : "var(--outline-variant)"
                          }`,
                          backgroundColor:
                            selectedYearFilter === y
                              ? "rgba(var(--primary-rgb), 0.18)"
                              : isAllDone
                              ? "rgba(var(--status-success-rgb, 74, 222, 128), 0.12)"
                              : "var(--btn-default-bg)",
                          color:
                            selectedYearFilter === y
                              ? "var(--primary-color)"
                              : isAllDone
                              ? "var(--status-success)"
                              : "var(--btn-default-color)",
                          cursor: "pointer",
                          fontWeight: selectedYearFilter === y ? 700 : "normal",
                          display: "flex",
                          alignItems: "center",
                          gap: "4px"
                        }}
                        title={stats ? `${y}年: ${stats.importedFiles}/${stats.totalFiles} ファイルインポート済` : y}
                      >
                        {isAllDone && <span style={{ fontSize: "11px" }}>✓</span>}
                        {isPartial && <span style={{ fontSize: "10px", color: "var(--status-warning)" }}>⏳</span>}
                        <span>{y}年</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 一括操作バー */}
          {scannedGroups.length > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 12px", backgroundColor: "var(--surface-variant)", borderRadius: "6px", border: "1px solid var(--outline-variant)", flexShrink: 0 }}>
              <div style={{ fontSize: "12px", color: "var(--on-surface-variant)", display: "flex", alignItems: "center", gap: "12px" }}>
                <span>
                  表示中: <strong>{filteredGroups.length}</strong> シンボル / <strong>{visibleFiles.length}</strong> ファイル
                  <span style={{ fontSize: "11px", opacity: 0.8, marginLeft: "4px" }}>(全スキャン: {totalScannedFilesCount}件中 {totalScannedImportedCount}件済)</span>
                </span>
                <span style={{ color: "var(--primary-color)", fontWeight: 600 }}>
                  選択中: <strong>{visibleSelectedCount}</strong> 件
                </span>
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  type="button"
                  className="pro-btn"
                  onClick={() => handleSelectVisibleFiles("all")}
                  disabled={isImporting || visibleFiles.length === 0}
                  style={{ padding: "2px 8px", fontSize: "11px", height: "24px" }}
                  title="現在フィルタ表示されている全ファイルを選択"
                >
                  表示中全選択
                </button>
                <button
                  type="button"
                  className="pro-btn"
                  onClick={() => handleSelectVisibleFiles("unimported")}
                  disabled={isImporting || visibleFiles.length === 0}
                  style={{ padding: "2px 8px", fontSize: "11px", height: "24px" }}
                  title="現在フィルタ表示されている未インポートのみ選択"
                >
                  未インポートのみ
                </button>
                <button
                  type="button"
                  className="pro-btn"
                  onClick={() => handleSelectVisibleFiles("none")}
                  disabled={isImporting || visibleFiles.length === 0}
                  style={{ padding: "2px 8px", fontSize: "11px", height: "24px" }}
                  title="現在フィルタ表示されている選択を解除"
                >
                  解除
                </button>
              </div>
            </div>
          )}

          {/* スキャン結果一覧（業者 > 年度 > 通貨ペアシンボル表示） */}
          {isScanning ? (
            <div style={{ padding: "40px 20px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
              <span className="material-symbols-outlined" style={{ fontSize: "36px", color: "var(--primary-color)", animation: "spin-clockwise 1s linear infinite" }}>
                progress_activity
              </span>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--on-surface)" }}>
                フォルダ内のティックデータをスキャン中...
              </div>
              <div style={{ fontSize: "11px", color: "var(--on-surface-variant)" }}>
                {rootDir}
              </div>
            </div>
          ) : brokerSections.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {brokerSections.map(sec => (
                <div
                  key={sec.broker}
                  style={{
                    borderRadius: "8px",
                    backgroundColor: "var(--surface-variant)",
                    border: "1px solid var(--outline-variant)",
                    overflow: "hidden"
                  }}
                >
                  {/* ブローカーヘッダー */}
                  <div
                    style={{
                      padding: "8px 12px",
                      backgroundColor: "var(--surface-container)",
                      borderBottom: "1px solid var(--outline-variant)",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span className="material-symbols-outlined" style={{ fontSize: "18px", color: "var(--primary-color)" }}>
                        account_balance
                      </span>
                      <strong style={{ fontSize: "13px", color: "var(--on-surface)" }}>
                        ブローカー / 分類: {sec.broker}
                      </strong>
                      <span style={{ fontSize: "11px", color: "var(--on-surface-variant)" }}>
                        ({sec.years.length} 年度 / {sec.totalFiles} ファイル中 {sec.importedFiles} 件済)
                      </span>
                    </div>

                    <div style={{ display: "flex", gap: "4px" }}>
                      <button
                        type="button"
                        className="pro-btn"
                        onClick={() => {
                          const allG = sec.years.flatMap(y => y.groups);
                          handleSelectYearGroups(allG, "all");
                        }}
                        disabled={isImporting}
                        style={{ padding: "2px 8px", fontSize: "11px", height: "22px" }}
                      >
                        この業者全選択
                      </button>
                      <button
                        type="button"
                        className="pro-btn"
                        onClick={() => {
                          const allG = sec.years.flatMap(y => y.groups);
                          handleSelectYearGroups(allG, "unimported");
                        }}
                        disabled={isImporting}
                        style={{ padding: "2px 8px", fontSize: "11px", height: "22px" }}
                      >
                        未インポート
                      </button>
                      <button
                        type="button"
                        className="pro-btn"
                        onClick={() => {
                          const allG = sec.years.flatMap(y => y.groups);
                          handleSelectYearGroups(allG, "none");
                        }}
                        disabled={isImporting}
                        style={{ padding: "2px 8px", fontSize: "11px", height: "22px" }}
                      >
                        解除
                      </button>
                    </div>
                  </div>

                  {/* 年度ごとのサブセクション */}
                  <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "12px" }}>
                    {sec.years.map(ySec => (
                      <div
                        key={ySec.year}
                        style={{
                          borderRadius: "6px",
                          backgroundColor: "var(--surface-container-lowest, rgba(0,0,0,0.2))",
                          border: `1px solid ${ySec.isAllCompleted ? "rgba(74, 222, 128, 0.3)" : "var(--outline-variant)"}`,
                          overflow: "hidden"
                        }}
                      >
                        {/* 年度サブヘッダー */}
                        <div
                          style={{
                            padding: "6px 10px",
                            backgroundColor: "var(--surface-container-high)",
                            borderBottom: "1px solid var(--outline-variant)",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center"
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span className="material-symbols-outlined" style={{ fontSize: "16px", color: ySec.isAllCompleted ? "var(--status-success)" : "var(--primary-color)" }}>
                              {/^\d{4}$/.test(ySec.year) ? "calendar_today" : "folder"}
                            </span>
                            <strong style={{ fontSize: "12.5px", color: "var(--on-surface)" }}>
                              {/^\d{4}$/.test(ySec.year) ? `${ySec.year}年` : ySec.year}
                            </strong>
                            <span style={{ fontSize: "11px", color: "var(--on-surface-variant)" }}>
                              ({ySec.groups.length} 通貨ペア / {ySec.totalFiles} ファイル)
                            </span>

                            {/* 年度全体の完了ステータスバッジ */}
                            {ySec.isAllCompleted ? (
                              <span style={{ fontSize: "10px", fontWeight: 700, padding: "1px 6px", borderRadius: "4px", backgroundColor: "var(--status-success-bg)", color: "var(--status-success)", border: "1px solid var(--status-success)" }}>
                                ✅ インポート完了
                              </span>
                            ) : ySec.importedFiles > 0 ? (
                              <span style={{ fontSize: "10px", fontWeight: 600, padding: "1px 6px", borderRadius: "4px", backgroundColor: "var(--status-warning-bg)", color: "var(--status-warning)", border: "1px solid var(--status-warning)" }}>
                                ⏳ 一部済 ({ySec.importedFiles}/{ySec.totalFiles})
                              </span>
                            ) : (
                              <span style={{ fontSize: "10px", fontWeight: 500, padding: "1px 6px", borderRadius: "4px", backgroundColor: "var(--surface-container)", color: "var(--on-surface-variant)", border: "1px solid var(--outline-variant)" }}>
                                🆕 未インポート
                              </span>
                            )}
                          </div>

                          {/* 年別一括選択ボタン */}
                          <div style={{ display: "flex", gap: "4px" }}>
                            <button
                              type="button"
                              className="pro-btn"
                              onClick={() => handleSelectYearGroups(ySec.groups, "all")}
                              disabled={isImporting}
                              style={{ padding: "1px 6px", fontSize: "10px", height: "20px" }}
                              title={`${ySec.year}年の全ファイルを選択`}
                            >
                              この年を全選択
                            </button>
                            <button
                              type="button"
                              className="pro-btn"
                              onClick={() => handleSelectYearGroups(ySec.groups, "unimported")}
                              disabled={isImporting}
                              style={{ padding: "1px 6px", fontSize: "10px", height: "20px" }}
                              title={`${ySec.year}年の未インポートのみ選択`}
                            >
                              未のみ
                            </button>
                            <button
                              type="button"
                              className="pro-btn"
                              onClick={() => handleSelectYearGroups(ySec.groups, "none")}
                              disabled={isImporting}
                              style={{ padding: "1px 6px", fontSize: "10px", height: "20px" }}
                            >
                              解除
                            </button>
                          </div>
                        </div>

                        {/* 各通貨ペアカード */}
                        <div style={{ padding: "8px", display: "flex", flexDirection: "column", gap: "8px" }}>
                          {ySec.groups.map(group => {
                            const key = getGroupKey(group);
                            const symName = symbolNames[key] || group.suggested_symbol_name;
                            const grpPath = groupPaths[key] || group.group_path || (group.category && group.category !== "Custom" ? group.category : "Custom");

                            const totalF = group.files.length;
                            const importedF = group.files.filter(f => f.already_imported).length;
                            const isComplete = importedF === totalF && totalF > 0;
                            const isPartial = importedF > 0 && importedF < totalF;

                            return (
                              <div
                                key={key}
                                style={{
                                  padding: "8px 10px",
                                  borderRadius: "5px",
                                  backgroundColor: isComplete
                                    ? "rgba(var(--status-success-rgb, 74, 222, 128), 0.04)"
                                    : "var(--surface-container-low)",
                                  border: `1px solid ${
                                    isComplete
                                      ? "rgba(74, 222, 128, 0.4)"
                                      : isPartial
                                      ? "rgba(255, 183, 77, 0.4)"
                                      : "var(--outline-variant)"
                                  }`
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                    <strong style={{ fontSize: "13px", color: "var(--on-surface)" }}>{group.pair_name}</strong>
                                    
                                    {/* シンボル名完全一致・インポート状態バッジ */}
                                    {isComplete ? (
                                      <span style={{ fontSize: "10px", fontWeight: 700, padding: "1px 6px", borderRadius: "4px", backgroundColor: "var(--status-success-bg)", color: "var(--status-success)", border: "1px solid var(--status-success)" }}>
                                        ✅ インポート完了 (全{totalF}ヶ月済)
                                      </span>
                                    ) : isPartial ? (
                                      <span style={{ fontSize: "10px", fontWeight: 600, padding: "1px 6px", borderRadius: "4px", backgroundColor: "var(--status-warning-bg)", color: "var(--status-warning)", border: "1px solid var(--status-warning)" }}>
                                        ⏳ 一部済 ({importedF}/{totalF}ヶ月)
                                      </span>
                                    ) : group.already_exists_in_mt5 ? (
                                      <span style={{ fontSize: "10px", fontWeight: 600, padding: "1px 6px", borderRadius: "4px", backgroundColor: "rgba(56, 189, 248, 0.15)", color: "#38bdf8", border: "1px solid rgba(56, 189, 248, 0.4)" }}>
                                        🏛️ MT5登録済 (データ未込 0/{totalF}ヶ月)
                                      </span>
                                    ) : (
                                      <span style={{ fontSize: "10px", fontWeight: 500, padding: "1px 6px", borderRadius: "4px", backgroundColor: "var(--surface-container)", color: "var(--on-surface-variant)", border: "1px solid var(--outline-variant)" }}>
                                        🆕 未インポート (0/{totalF}ヶ月)
                                      </span>
                                    )}

                                    <span style={{ fontSize: "11px", color: "var(--on-surface-variant)", opacity: 0.8 }}>
                                      ({totalF} ファイル)
                                    </span>
                                  </div>

                                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                    <button
                                      type="button"
                                      className="pro-btn"
                                      onClick={() => handleSelectGroupFiles(group.files, "all")}
                                      disabled={isImporting}
                                      style={{ padding: "1px 5px", fontSize: "9.5px", height: "18px" }}
                                    >
                                      全選
                                    </button>
                                    <button
                                      type="button"
                                      className="pro-btn"
                                      onClick={() => handleSelectGroupFiles(group.files, "unimported")}
                                      disabled={isImporting}
                                      style={{ padding: "1px 5px", fontSize: "9.5px", height: "18px" }}
                                    >
                                      未選
                                    </button>
                                    <button
                                      type="button"
                                      className="pro-btn"
                                      onClick={() => handleSelectGroupFiles(group.files, "none")}
                                      disabled={isImporting}
                                      style={{ padding: "1px 5px", fontSize: "9.5px", height: "18px" }}
                                    >
                                      解除
                                    </button>
                                  </div>
                                </div>

                                {/* シンボル設定フォーム */}
                                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "8px", marginBottom: "6px" }}>
                                  <div>
                                    <label className="form-label" style={{ fontSize: "9.5px", marginBottom: "2px" }}>作成カスタムシンボル名</label>
                                    <input
                                      type="text"
                                      className="pro-input"
                                      value={symName}
                                      onChange={(e) => setSymbolNames({ ...symbolNames, [key]: e.target.value })}
                                      disabled={isImporting}
                                      style={{ fontSize: "11.5px", padding: "3px 6px", height: "24px" }}
                                    />
                                  </div>
                                  <div>
                                    <label className="form-label" style={{ fontSize: "9.5px", marginBottom: "2px" }}>MT5グループパス</label>
                                    <input
                                      type="text"
                                      className="pro-input"
                                      value={grpPath}
                                      onChange={(e) => setGroupPaths({ ...groupPaths, [key]: e.target.value })}
                                      disabled={isImporting}
                                      style={{ fontSize: "11.5px", padding: "3px 6px", height: "24px" }}
                                    />
                                  </div>
                                </div>

                                {/* 月別・ファイル別チェックリスト */}
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(105px, 1fr))", gap: "4px", maxHeight: "95px", overflowY: "auto", paddingRight: "2px" }}>
                                  {group.files.map(f => {
                                    const isChecked = !!selectedMonths[f.file_path];
                                    return (
                                      <label
                                        key={f.file_path}
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: "4px",
                                          padding: "2px 5px",
                                          borderRadius: "3px",
                                          backgroundColor: f.already_imported ? "var(--status-success-bg)" : "var(--surface-container-high)",
                                          border: "1px solid " + (f.already_imported ? "var(--status-success)" : "var(--outline-variant)"),
                                          cursor: "pointer",
                                          fontSize: "10.5px",
                                          color: "var(--on-surface)"
                                        }}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          disabled={isImporting}
                                          onChange={(e) => setSelectedMonths({ ...selectedMonths, [f.file_path]: e.target.checked })}
                                          style={{ width: "12px", height: "12px", margin: 0 }}
                                        />
                                        <span style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }} title={f.year_month}>
                                          {f.year_month}
                                        </span>
                                        {f.already_imported ? (
                                          <span style={{ fontSize: "9px", fontWeight: 700, color: "var(--status-success)", marginLeft: "auto" }}>済</span>
                                        ) : (
                                          <span style={{ fontSize: "9px", fontWeight: 500, color: "var(--on-surface-variant)", marginLeft: "auto" }}>未</span>
                                        )}
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : scannedGroups.length > 0 ? (
            <div style={{ padding: "32px", textAlign: "center", color: "var(--on-surface-variant)", fontSize: "12px" }}>
              現在のフィルタ条件に一致するシンボルデータがありません。フィルタを緩和してください。
            </div>
          ) : !errorMessage && (
            <div style={{ padding: "36px 20px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", border: "1px dashed var(--outline-variant)", borderRadius: "8px", backgroundColor: "var(--surface-container-low)" }}>
              <span className="material-symbols-outlined" style={{ fontSize: "40px", color: "var(--primary-color)", opacity: 0.85 }}>
                folder_zip
              </span>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--on-surface)" }}>
                ZIPティックデータのスキャン
              </div>
              <div style={{ fontSize: "11.5px", color: "var(--on-surface-variant)", maxWidth: "440px", lineHeight: "1.5" }}>
                上のデータ格納ディレクトリ（例: <code>D:\TickData</code>）を指定し、「スキャン」ボタンをクリックして業者・年度ごとのティックデータを読み込んでください。
              </div>
              <button
                type="button"
                className="pro-btn pro-btn-primary"
                onClick={handleScan}
                style={{ marginTop: "4px", padding: "6px 16px", fontSize: "12px", display: "flex", alignItems: "center", gap: "6px" }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>search</span>
                スキャンを開始
              </button>
            </div>
          )}

          {/* インポート完了クイック反映カード */}
          {importCompletedSuccessfully && lastImportedSymbols.length > 0 && (
            <div style={{
              padding: "12px 16px",
              borderRadius: "8px",
              backgroundColor: "var(--status-success-bg)",
              border: "1px solid var(--status-success)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexShrink: 0
            }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: "13px", color: "var(--status-success)", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>check_circle</span>
                  インポートが正常に完了しました!
                </div>
                <div style={{ fontSize: "11px", color: "var(--on-surface-variant)", marginTop: "2px" }}>
                  インポート済み: {lastImportedSymbols.join(", ")}
                </div>
              </div>
              {onApplyToReplay && (
                <button
                  type="button"
                  className="pro-btn pro-btn-primary"
                  onClick={handleApplyToReplay}
                  style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 14px", fontSize: "12px", backgroundColor: "var(--status-success)", borderColor: "var(--status-success)", color: "#fff" }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>auto_awesome</span>
                  リプレイ設定に即時反映
                </button>
              )}
            </div>
          )}

          {/* 進捗バー */}
          {isImporting && (
            <div style={{ padding: "12px", borderRadius: "8px", backgroundColor: "var(--surface-variant)", border: "1px solid var(--outline-variant)", flexShrink: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "6px" }}>
                <span>インポート処理中: {importProgress.currentLabel}</span>
                <span>{importProgress.current} / {importProgress.total} 件 ({importProgress.ticksCount.toLocaleString()} ティック)</span>
              </div>
              <div style={{ width: "100%", height: "8px", backgroundColor: "var(--surface-container-high)", borderRadius: "4px", overflow: "hidden", marginBottom: "8px" }}>
                <div
                  style={{
                    width: `${(importProgress.current / (importProgress.total || 1)) * 100}%`,
                    height: "100%",
                    backgroundColor: "var(--primary-color)",
                    transition: "width 0.3s ease"
                  }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="pro-btn"
                  onClick={handleStopImport}
                  style={{ padding: "4px 12px", fontSize: "11px", backgroundColor: "var(--status-danger)", color: "#fff", border: "none" }}
                >
                  インポート停止
                </button>
              </div>
            </div>
          )}

          {/* ログ */}
          {logs.length > 0 && (
            <div style={{ maxHeight: "120px", overflowY: "auto", padding: "8px", borderRadius: "6px", backgroundColor: "var(--surface-container-low)", border: "1px solid var(--outline-variant)", color: "var(--on-surface)", fontSize: "11px", fontFamily: "var(--font-data, monospace)", display: "flex", flexDirection: "column", gap: "2px", flexShrink: 0 }}>
              {logs.map((log, i) => (
                <div key={i}>{log}</div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--outline-variant)", display: "flex", justifyContent: "flex-end", gap: "10px", flexShrink: 0 }}>
          <button
            type="button"
            className="pro-btn"
            onClick={onClose}
            disabled={isImporting}
          >
            閉じる
          </button>
          {isImporting ? (
            <button
              type="button"
              className="pro-btn"
              onClick={handleStopImport}
              style={{ padding: "0 20px", backgroundColor: "var(--status-danger)", color: "#fff", border: "none" }}
            >
              インポート停止
            </button>
          ) : (
            <button
              type="button"
              className="pro-btn pro-btn-primary"
              onClick={handleStartImport}
              disabled={scannedGroups.length === 0 || visibleSelectedCount === 0}
              style={{ padding: "0 20px" }}
            >
              {visibleSelectedCount > 0 ? `選択した ${visibleSelectedCount} 件をインポート開始` : "インポート開始"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

