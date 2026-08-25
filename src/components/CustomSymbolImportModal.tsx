import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface ScannedZipFile {
  year_month: string;
  file_path: string;
  already_imported: boolean;
}

export interface ScannedPairGroup {
  category: string;
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
  
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, currentLabel: "", ticksCount: 0 });
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [mt5Connected, setMt5Connected] = useState<boolean | null>(null);
  const [lastImportedSymbols, setLastImportedSymbols] = useState<string[]>([]);
  const [importCompletedSuccessfully, setImportCompletedSuccessfully] = useState(false);

  const cancelImportRef = useRef(false);

  const getGroupKey = (g: { category?: string; pair_name: string; suggested_symbol_name?: string }) => {
    return g.suggested_symbol_name || `${g.category || "Custom"}_${g.pair_name}`;
  };

  // モーダル表示時に MT5 EA 接続状態を確認
  useEffect(() => {
    if (isOpen) {
      checkMt5Connection();
      setImportCompletedSuccessfully(false);
      setLastImportedSymbols([]);
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

  if (!isOpen) return null;

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

  // 全体一括選択・解除
  const handleSelectAllFiles = (mode: "all" | "none" | "unimported") => {
    setSelectedMonths(prev => {
      const next = { ...prev };
      scannedGroups.forEach(g => {
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

  // カテゴリ単位の一括選択・解除
  const handleSelectCategoryFiles = (categoryGroups: ScannedPairGroup[], mode: "all" | "none" | "unimported") => {
    setSelectedMonths(prev => {
      const next = { ...prev };
      categoryGroups.forEach(g => {
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
      setLogs(prev => [...prev, `🎉 インポート完了! 合計 ${successCount}/${itemsToImport.length} 件 (${totalTicksTotal.toLocaleString()} ティック)`]);
    }

    if (onImportComplete) {
      onImportComplete();
    }
  };

  // インポート完了シンボルをリプレイ設定に反映
  const handleApplyToReplay = () => {
    if (!onApplyToReplay || lastImportedSymbols.length === 0) return;

    // ソースシンボルの決定: USDJPYを含むものを優先、なければ先頭
    let primary = lastImportedSymbols.find(s => s.toUpperCase().includes("USDJPY")) || lastImportedSymbols[0];
    let syncList = lastImportedSymbols.filter(s => s !== primary);

    // 年サフィックスの抽出 (例: USDJPY_2016 -> 2016)
    const matchYear = primary.match(/_(\d{4})$/);
    let dateRange: { start: string; end: string } | undefined = undefined;
    if (matchYear) {
      const year = matchYear[1];
      dateRange = {
        start: `${year}-01-01 00:00:00`,
        end: `${year}-12-31 23:59:59`
      };
    }

    onApplyToReplay(primary, syncList, dateRange);
    onClose();
  };

  // カテゴリごとのグループマップを作成
  const categoryGroupsMap: { [cat: string]: ScannedPairGroup[] } = {};
  scannedGroups.forEach(g => {
    const cat = g.category || "Custom";
    if (!categoryGroupsMap[cat]) {
      categoryGroupsMap[cat] = [];
    }
    categoryGroupsMap[cat].push(g);
  });

  // カテゴリのソート順: 4桁西暦（降順） -> その他タグ（昇順） -> Custom
  const sortedCategories = Object.keys(categoryGroupsMap).sort((a, b) => {
    const isYearA = /^\d{4}$/.test(a);
    const isYearB = /^\d{4}$/.test(b);
    if (isYearA && isYearB) return b.localeCompare(a);
    if (isYearA) return -1;
    if (isYearB) return 1;
    if (a.toLowerCase() === "custom") return 1;
    if (b.toLowerCase() === "custom") return -1;
    return a.localeCompare(b);
  });

  const totalFilesCount = scannedGroups.reduce((acc, g) => acc + g.files.length, 0);
  const selectedFilesCount = Object.values(selectedMonths).filter(Boolean).length;

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
          width: "780px",
          maxHeight: "90vh",
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
        <div className="pro-panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid var(--outline-variant)" }}>
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
        <div style={{ padding: "16px 18px", flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "14px" }}>
          
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
            fontWeight: 500
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
              <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                {mt5Connected ? "power" : "power_off"}
              </span>
              <span>
                {mt5Connected
                  ? "MetaTrader 5 (EA) 通信接続中: インポート実行可能"
                  : "MetaTrader 5 (EA) 未接続: インポートを実行するにはMT5を起動してEAをアクティブにしてください"}
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
          <div className="form-group">
            <label className="form-label">データ格納ディレクトリパス (年別または通貨ペア別ZIPフォルダ)</label>
            <div className="input-with-button-container">
              <input
                type="text"
                className="pro-input input-with-button"
                value={rootDir}
                onChange={(e) => updateRootDir(e.target.value)}
                placeholder="e.g. D:\TickData または D:\TickData\2016"
                disabled={isImporting}
              />
              <button
                type="button"
                className="pro-btn"
                onClick={handleBrowseFolder}
                disabled={isScanning || isImporting}
                style={{ padding: "0 10px", height: "32px", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}
                title="OSのフォルダ選択ダイアログを開く"
              >
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>folder_open</span>
                参照...
              </button>
              <button
                type="button"
                className="pro-btn pro-btn-primary"
                onClick={handleScan}
                disabled={isScanning || isImporting}
                style={{ padding: "0 14px", height: "32px", fontSize: "12px" }}
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

          {/* 全体一括操作バー */}
          {scannedGroups.length > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", backgroundColor: "var(--surface-variant)", borderRadius: "6px", border: "1px solid var(--outline-variant)" }}>
              <div style={{ fontSize: "12px", color: "var(--on-surface-variant)" }}>
                <span>検出: <strong>{scannedGroups.length}</strong> シンボル / <strong>{totalFilesCount}</strong> ファイル</span>
                <span style={{ marginLeft: "12px", color: "var(--primary-color)" }}>選択中: <strong>{selectedFilesCount}</strong> 件</span>
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  type="button"
                  className="pro-btn"
                  onClick={() => handleSelectAllFiles("all")}
                  disabled={isImporting}
                  style={{ padding: "2px 8px", fontSize: "11px", height: "24px" }}
                >
                  全選択
                </button>
                <button
                  type="button"
                  className="pro-btn"
                  onClick={() => handleSelectAllFiles("unimported")}
                  disabled={isImporting}
                  style={{ padding: "2px 8px", fontSize: "11px", height: "24px" }}
                >
                  未インポートのみ
                </button>
                <button
                  type="button"
                  className="pro-btn"
                  onClick={() => handleSelectAllFiles("none")}
                  disabled={isImporting}
                  style={{ padding: "2px 8px", fontSize: "11px", height: "24px" }}
                >
                  全解除
                </button>
              </div>
            </div>
          )}

          {/* スキャン結果一覧（カテゴリ・年別グループ表示） */}
          {sortedCategories.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {sortedCategories.map(cat => {
                const catGroups = categoryGroupsMap[cat];
                const isYear = /^\d{4}$/.test(cat);
                const catTotalFiles = catGroups.reduce((acc, g) => acc + g.files.length, 0);

                return (
                  <div
                    key={cat}
                    style={{
                      borderRadius: "8px",
                      backgroundColor: "var(--surface-variant)",
                      border: "1px solid var(--outline-variant)",
                      overflow: "hidden"
                    }}
                  >
                    {/* カテゴリヘッダー */}
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
                          {isYear ? "calendar_today" : "account_balance"}
                        </span>
                        <strong style={{ fontSize: "13px", color: "var(--on-surface)" }}>
                          {isYear ? `${cat}年` : `ブローカー / 分類: ${cat}`}
                        </strong>
                        <span style={{ fontSize: "11px", color: "var(--on-surface-variant)" }}>
                          ({catGroups.length} シンボルグループ / {catTotalFiles} ファイル)
                        </span>
                      </div>

                      {/* カテゴリ単位の一括選択ボタン */}
                      <div style={{ display: "flex", gap: "4px" }}>
                        <button
                          type="button"
                          className="pro-btn"
                          onClick={() => handleSelectCategoryFiles(catGroups, "all")}
                          disabled={isImporting}
                          style={{ padding: "2px 8px", fontSize: "11px", height: "22px" }}
                        >
                          このグループ全選択
                        </button>
                        <button
                          type="button"
                          className="pro-btn"
                          onClick={() => handleSelectCategoryFiles(catGroups, "unimported")}
                          disabled={isImporting}
                          style={{ padding: "2px 8px", fontSize: "11px", height: "22px" }}
                        >
                          未インポート
                        </button>
                        <button
                          type="button"
                          className="pro-btn"
                          onClick={() => handleSelectCategoryFiles(catGroups, "none")}
                          disabled={isImporting}
                          style={{ padding: "2px 8px", fontSize: "11px", height: "22px" }}
                        >
                          解除
                        </button>
                      </div>
                    </div>

                    {/* カテゴリ内の通貨ペア一覧 */}
                    <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "10px" }}>
                      {catGroups.map(group => {
                        const key = getGroupKey(group);
                        const symName = symbolNames[key] || group.suggested_symbol_name;
                        const grpPath = groupPaths[key] || group.group_path || (group.category && group.category !== "Custom" ? group.category : "Custom");

                        return (
                          <div
                            key={key}
                            style={{
                              padding: "10px",
                              borderRadius: "6px",
                              backgroundColor: "var(--surface-container-low)",
                              border: "1px solid var(--outline-variant)"
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <strong style={{ fontSize: "13px", color: "var(--on-surface)" }}>{group.pair_name}</strong>
                                <span style={{ fontSize: "11px", color: "var(--on-surface-variant)" }}>({group.files.length} ファイル)</span>
                                {group.already_exists_in_mt5 && (
                                  <span style={{ fontSize: "10px", fontWeight: 600, padding: "1px 6px", borderRadius: "4px", backgroundColor: "var(--status-warning-bg)", color: "var(--status-warning)", border: "1px solid var(--status-warning)" }}>
                                    ⚠️ MT5に既存
                                  </span>
                                )}
                              </div>

                              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                <button
                                  type="button"
                                  className="pro-btn"
                                  onClick={() => handleSelectGroupFiles(group.files, "all")}
                                  disabled={isImporting}
                                  style={{ padding: "1px 6px", fontSize: "10px", height: "20px" }}
                                >
                                  全選択
                                </button>
                                <button
                                  type="button"
                                  className="pro-btn"
                                  onClick={() => handleSelectGroupFiles(group.files, "unimported")}
                                  disabled={isImporting}
                                  style={{ padding: "1px 6px", fontSize: "10px", height: "20px" }}
                                >
                                  未
                                </button>
                                <button
                                  type="button"
                                  className="pro-btn"
                                  onClick={() => handleSelectGroupFiles(group.files, "none")}
                                  disabled={isImporting}
                                  style={{ padding: "1px 6px", fontSize: "10px", height: "20px" }}
                                >
                                  解除
                                </button>
                              </div>
                            </div>

                            {/* シンボル設定フォーム */}
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                              <div>
                                <label className="form-label" style={{ fontSize: "10px" }}>作成カスタムシンボル名</label>
                                <input
                                  type="text"
                                  className="pro-input"
                                  value={symName}
                                  onChange={(e) => setSymbolNames({ ...symbolNames, [key]: e.target.value })}
                                  disabled={isImporting}
                                  style={{ fontSize: "12px", padding: "4px 8px", height: "26px" }}
                                />
                              </div>
                              <div>
                                <label className="form-label" style={{ fontSize: "10px" }}>MT5グループパス</label>
                                <input
                                  type="text"
                                  className="pro-input"
                                  value={grpPath}
                                  onChange={(e) => setGroupPaths({ ...groupPaths, [key]: e.target.value })}
                                  disabled={isImporting}
                                  style={{ fontSize: "12px", padding: "4px 8px", height: "26px" }}
                                />
                              </div>
                            </div>

                            {/* 月別・ファイル別チェックリスト */}
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px", maxHeight: "110px", overflowY: "auto", paddingRight: "4px" }}>
                              {group.files.map(f => {
                                const isChecked = !!selectedMonths[f.file_path];
                                return (
                                  <label
                                    key={f.file_path}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "6px",
                                      padding: "3px 6px",
                                      borderRadius: "4px",
                                      backgroundColor: f.already_imported ? "var(--status-success-bg)" : "var(--surface-container-high)",
                                      border: "1px solid " + (f.already_imported ? "var(--status-success)" : "var(--outline-variant)"),
                                      cursor: "pointer",
                                      fontSize: "11px",
                                      color: "var(--on-surface)"
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      disabled={isImporting}
                                      onChange={(e) => setSelectedMonths({ ...selectedMonths, [f.file_path]: e.target.checked })}
                                    />
                                    <span style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }} title={f.year_month}>
                                      {f.year_month}
                                    </span>
                                    {f.already_imported ? (
                                      <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--status-success)", marginLeft: "auto" }}>済</span>
                                    ) : (
                                      <span style={{ fontSize: "10px", fontWeight: 500, color: "var(--on-surface-variant)", marginLeft: "auto" }}>未</span>
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
                );
              })}
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
              alignItems: "center"
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

          {/* 進捗とログ */}
          {isImporting && (
            <div style={{ padding: "12px", borderRadius: "8px", backgroundColor: "var(--surface-variant)", border: "1px solid var(--outline-variant)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "6px" }}>
                <span>インポート処理中: {importProgress.currentLabel}</span>
                <span>{importProgress.current} / {importProgress.total} 件</span>
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

          {logs.length > 0 && (
            <div style={{ maxHeight: "120px", overflowY: "auto", padding: "8px", borderRadius: "6px", backgroundColor: "var(--surface-container-low)", border: "1px solid var(--outline-variant)", color: "var(--on-surface)", fontSize: "11px", fontFamily: "var(--font-data, monospace)", display: "flex", flexDirection: "column", gap: "2px" }}>
              {logs.map((log, i) => (
                <div key={i}>{log}</div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--outline-variant)", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
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
              disabled={scannedGroups.length === 0 || selectedFilesCount === 0}
              style={{ padding: "0 20px" }}
            >
              {selectedFilesCount > 0 ? `選択した ${selectedFilesCount} 件をインポート開始` : "インポート開始"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
