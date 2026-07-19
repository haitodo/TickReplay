import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface ScannedZipFile {
  year_month: string;
  file_path: string;
  already_imported: boolean;
}

export interface ScannedPairGroup {
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
  onImportComplete?: () => void;
}

export const CustomSymbolImportModal: React.FC<CustomSymbolImportModalProps> = ({
  isOpen,
  onClose,
  terminalPath,
  onImportComplete
}) => {
  const [rootDir, setRootDir] = useState("D:\\2025");
  const [scannedGroups, setScannedGroups] = useState<ScannedPairGroup[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [symbolNames, setSymbolNames] = useState<{ [pair: string]: string }>({});
  const [groupPaths, setGroupPaths] = useState<{ [pair: string]: string }>({});
  const [selectedMonths, setSelectedMonths] = useState<{ [filePath: string]: boolean }>({});
  
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, currentLabel: "", ticksCount: 0 });
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState("");

  if (!isOpen) return null;

  const handleBrowseFolder = async () => {
    try {
      const selected = await invoke<string | null>("select_folder");
      if (selected) {
        setRootDir(selected);
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
    setErrorMessage("");
    setIsScanning(true);
    try {
      const groups = await invoke<ScannedPairGroup[]>("scan_custom_symbol_files", {
        rootDir: targetDir,
        terminalPath
      });
      setScannedGroups(groups);

      // 初期値設定
      const initialNames: { [pair: string]: string } = {};
      const initialGroups: { [pair: string]: string } = {};
      const initialMonths: { [filePath: string]: boolean } = {};

      groups.forEach(g => {
        initialNames[g.pair_name] = g.suggested_symbol_name; // デフォルト: EURJPY_Custom
        initialGroups[g.pair_name] = g.group_path || "Custom";

        g.files.forEach(f => {
          // すでにインポート済みの場合はデフォルトチェックOFF (スキップ)、未インポートならチェックON
          initialMonths[f.file_path] = !f.already_imported;
        });
      });

      setSymbolNames(initialNames);
      setGroupPaths(initialGroups);
      setSelectedMonths(initialMonths);

      if (groups.length === 0) {
        setErrorMessage("指定されたフォルダ内に OANDA ZIP データ (ticks_*.zip) が見つかりませんでした。");
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

  const handleStartImport = async () => {
    if (!terminalPath) {
      setErrorMessage("MT5ターミナルが選択されていません。セットアップ画面でターミナルを選択してください。");
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

    scannedGroups.forEach(g => {
      const symName = symbolNames[g.pair_name] || `${g.pair_name}_Custom`;
      const grpPath = groupPaths[g.pair_name] || "Custom";

      g.files.forEach(f => {
        if (selectedMonths[f.file_path]) {
          itemsToImport.push({
            pairName: g.pair_name,
            symbolName: symName,
            groupPath: grpPath,
            filePath: f.file_path,
            yearMonth: f.year_month
          });
        }
      });
    });

    if (itemsToImport.length === 0) {
      setErrorMessage("インポート対象の月データが選択されていません。");
      return;
    }

    setIsImporting(true);
    setErrorMessage("");
    setLogs([]);
    setImportProgress({ current: 0, total: itemsToImport.length, currentLabel: "", ticksCount: 0 });

    let successCount = 0;
    let totalTicksTotal = 0;

    for (let i = 0; i < itemsToImport.length; i++) {
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
    setLogs(prev => [...prev, `🎉 インポート完了! 合計 ${successCount}/${itemsToImport.length} 件 (${totalTicksTotal.toLocaleString()} ティック)`]);

    if (onImportComplete) {
      onImportComplete();
    }
  };

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
          width: "720px",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "var(--surface-container-high, #18181c)",
          border: "1px solid var(--outline-variant, #333)",
          borderRadius: "var(--radius-lg, 12px)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
          overflow: "hidden"
        }}
      >
        {/* Header */}
        <div className="pro-panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid var(--outline-variant)" }}>
          <h3 className="pro-panel-title" style={{ display: "flex", alignItems: "center", gap: "8px", margin: 0, fontSize: "15px" }}>
            <span className="material-symbols-outlined icon-accent">database_upload</span>
            OANDA JAPAN CSV カスタムシンボル構築・インポート
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
          {/* フォルダ指定とスキャン */}
          <div className="form-group">
            <label className="form-label">データ格納ディレクトリパス (ZIP保存先フォルダ)</label>
            <div className="input-with-button-container">
              <input
                type="text"
                className="pro-input input-with-button"
                value={rootDir}
                onChange={(e) => setRootDir(e.target.value)}
                placeholder="e.g. D:\2025"
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
            <div style={{ padding: "8px 12px", borderRadius: "6px", backgroundColor: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.4)", color: "#f87171", fontSize: "12px" }}>
              {errorMessage}
            </div>
          )}

          {/* スキャン結果一覧 */}
          {scannedGroups.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {scannedGroups.map(group => {
                const symName = symbolNames[group.pair_name] || `${group.pair_name}_Custom`;
                const grpPath = groupPaths[group.pair_name] || "Custom";

                return (
                  <div
                    key={group.pair_name}
                    style={{
                      padding: "12px",
                      borderRadius: "8px",
                      backgroundColor: "var(--surface-container, rgba(255,255,255,0.03))",
                      border: "1px solid var(--outline-variant, #2d2d35)"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span className="material-symbols-outlined" style={{ color: "var(--primary, #a8c7fa)" }}>folder_zip</span>
                        <strong style={{ fontSize: "14px" }}>{group.pair_name}</strong>
                        <span style={{ fontSize: "11px", color: "var(--text-muted, #888)" }}>({group.files.length} ヶ月分のZIP検出)</span>
                        {group.already_exists_in_mt5 && (
                          <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "4px", backgroundColor: "rgba(245, 158, 11, 0.2)", color: "#fbbf24", border: "1px solid rgba(245, 158, 11, 0.4)" }}>
                            ⚠️ MT5に既存
                          </span>
                        )}
                      </div>
                    </div>

                    {/* カスタムシンボル設定フォーム */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "10px" }}>
                      <div>
                        <label className="form-label" style={{ fontSize: "10px" }}>作成カスタムシンボル名 (デフォルト: サフィックス付)</label>
                        <input
                          type="text"
                          className="pro-input"
                          value={symName}
                          onChange={(e) => setSymbolNames({ ...symbolNames, [group.pair_name]: e.target.value })}
                          disabled={isImporting}
                          style={{ fontSize: "12px", padding: "4px 8px", height: "28px" }}
                        />
                      </div>
                      <div>
                        <label className="form-label" style={{ fontSize: "10px" }}>MT5グループパス</label>
                        <input
                          type="text"
                          className="pro-input"
                          value={grpPath}
                          onChange={(e) => setGroupPaths({ ...groupPaths, [group.pair_name]: e.target.value })}
                          disabled={isImporting}
                          style={{ fontSize: "12px", padding: "4px 8px", height: "28px" }}
                        />
                      </div>
                    </div>

                    {/* 月別チェックリスト */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px", maxHeight: "120px", overflowY: "auto", paddingRight: "4px" }}>
                      {group.files.map(f => {
                        const isChecked = !!selectedMonths[f.file_path];
                        return (
                          <label
                            key={f.file_path}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                              padding: "4px 8px",
                              borderRadius: "4px",
                              backgroundColor: f.already_imported ? "rgba(34, 197, 94, 0.08)" : "rgba(255,255,255,0.02)",
                              border: "1px solid " + (f.already_imported ? "rgba(34, 197, 94, 0.2)" : "rgba(255,255,255,0.05)"),
                              cursor: "pointer",
                              fontSize: "11px"
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              disabled={isImporting}
                              onChange={(e) => setSelectedMonths({ ...selectedMonths, [f.file_path]: e.target.checked })}
                            />
                            <span>{f.year_month}</span>
                            {f.already_imported ? (
                              <span style={{ fontSize: "9px", color: "#4ade80", marginLeft: "auto" }}>済</span>
                            ) : (
                              <span style={{ fontSize: "9px", color: "#94a3b8", marginLeft: "auto" }}>未</span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 進捗とログ */}
          {isImporting && (
            <div style={{ padding: "12px", borderRadius: "8px", backgroundColor: "rgba(0,0,0,0.3)", border: "1px solid var(--outline-variant)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "6px" }}>
                <span>インポート処理中: {importProgress.currentLabel}</span>
                <span>{importProgress.current} / {importProgress.total} 月データ</span>
              </div>
              <div style={{ width: "100%", height: "8px", backgroundColor: "rgba(255,255,255,0.1)", borderRadius: "4px", overflow: "hidden" }}>
                <div
                  style={{
                    width: `${(importProgress.current / (importProgress.total || 1)) * 100}%`,
                    height: "100%",
                    backgroundColor: "var(--primary, #4a90e2)",
                    transition: "width 0.3s ease"
                  }}
                />
              </div>
            </div>
          )}

          {logs.length > 0 && (
            <div style={{ maxHeight: "100px", overflowY: "auto", padding: "8px", borderRadius: "6px", backgroundColor: "#0f0f13", fontSize: "11px", fontFamily: "monospace", display: "flex", flexDirection: "column", gap: "2px" }}>
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
          <button
            type="button"
            className="pro-btn pro-btn-primary"
            onClick={handleStartImport}
            disabled={isImporting || scannedGroups.length === 0}
            style={{ padding: "0 20px" }}
          >
            {isImporting ? "インポート中..." : "1月ずつインポート開始"}
          </button>
        </div>
      </div>
    </div>
  );
};
