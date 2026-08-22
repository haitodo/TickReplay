import React, { useState, useRef } from "react";
import { decodeFileBuffer } from "../../domain/tradeAnalysis/encodingDetector";
import { parseBrokerTradeCsv } from "../../domain/tradeAnalysis/csvParsers";
import { ParsedTradeBatch, SavedTradeDataset } from "../../domain/tradeAnalysis/types";

interface CsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: (dataset: SavedTradeDataset) => void;
}

export const CsvImportModal: React.FC<CsvImportModalProps> = ({
  isOpen,
  onClose,
  onImportSuccess
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [parsedBatch, setParsedBatch] = useState<ParsedTradeBatch | null>(null);
  const [datasetName, setDatasetName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const processFile = async (file: File) => {
    setErrorMsg(null);
    try {
      const buffer = await file.arrayBuffer();
      const { text } = decodeFileBuffer(buffer);
      const batch = parseBrokerTradeCsv(text, file.name);

      if (batch.totalRecords === 0) {
        setErrorMsg("有効な約定・取引履歴レコードが見つかりませんでした。ヘッダーや形式をご確認ください。");
        setParsedBatch(null);
        return;
      }

      setParsedBatch(batch);
      // デフォルトのデータセット名: ファイル名（拡張子なし）
      const baseName = file.name.replace(/\.[^/.]+$/, "");
      setDatasetName(`${batch.brokerNameJa} - ${baseName}`);
    } catch (e: any) {
      console.error("Failed to parse trade CSV", e);
      setErrorMsg(`ファイル解析エラー: ${e.message || e}`);
      setParsedBatch(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  const handleConfirmImport = () => {
    if (!parsedBatch || parsedBatch.trades.length === 0) return;

    const dataset: SavedTradeDataset = {
      id: `dataset_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      name: datasetName.trim() || `${parsedBatch.brokerNameJa} (${parsedBatch.totalRecords}件)`,
      broker: parsedBatch.broker,
      brokerNameJa: parsedBatch.brokerNameJa,
      importedAt: new Date().toLocaleString(),
      tradeCount: parsedBatch.totalRecords,
      dateRange: parsedBatch.dateRange,
      trades: parsedBatch.trades
    };

    onImportSuccess(dataset);
    onClose();
  };

  return (
    <div className="trade-import-modal-overlay">
      <div className="trade-import-modal-container glass-panel">
        <div className="trade-import-modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span className="material-symbols-outlined icon-accent" style={{ fontSize: "20px" }}>
              upload_file
            </span>
            <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "var(--on-surface)" }}>
              取引履歴 CSVインポート
            </h3>
          </div>
          <button className="pro-btn-square" onClick={onClose} title="閉じる">
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>close</span>
          </button>
        </div>

        <div className="trade-import-modal-body">
          {/* ドロップゾーン */}
          <div
            className={`trade-csv-dropzone ${isDragging ? "dragging" : ""} ${parsedBatch ? "has-file" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: "none" }}
              accept=".csv,.txt,.tsv"
              onChange={handleFileSelect}
            />

            <span className="material-symbols-outlined text-[36px] dropzone-icon">
              {parsedBatch ? "check_circle" : "file_upload"}
            </span>

            <div className="dropzone-text-group">
              <span className="dropzone-main-text">
                {parsedBatch ? parsedBatch.sourceFileName : "CSVファイルをドラッグ＆ドロップ、またはクリックして選択"}
              </span>
              <span className="dropzone-sub-text">
                対応形式: GMOクリック証券 / DMM FX / SBI FX / MT4 / MT5 / 汎用CSV (Shift-JIS / UTF-8自動判定)
              </span>
            </div>
          </div>

          {errorMsg && (
            <div className="trade-import-error-banner">
              <span className="material-symbols-outlined text-[16px]">error</span>
              <span>{errorMsg}</span>
            </div>
          )}

          {/* 解析プレビュー */}
          {parsedBatch && (
            <div className="trade-import-preview-box">
              <div className="preview-meta-header">
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span className="preview-broker-badge">
                    {parsedBatch.brokerNameJa}
                  </span>
                  <span className="preview-stat-pill">
                    {parsedBatch.totalRecords} 件の取引
                  </span>
                  <span className="preview-stat-pill">
                    通貨: {parsedBatch.symbols.join(", ") || "不明"}
                  </span>
                </div>
                <div className="preview-date-range">
                  {parsedBatch.dateRange.start} 〜 {parsedBatch.dateRange.end}
                </div>
              </div>

              <div className="preview-form-group">
                <label className="preview-form-label">データセット名 (保存・管理用)</label>
                <input
                  type="text"
                  className="pro-input"
                  value={datasetName}
                  onChange={(e) => setDatasetName(e.target.value)}
                  placeholder="例: GMOクリック 2026年5月取引"
                />
              </div>

              {/* 最初の3件のサンプルテーブル */}
              <div className="preview-table-wrapper">
                <table className="preview-table">
                  <thead>
                    <tr>
                      <th>Ticket</th>
                      <th>通貨</th>
                      <th>売買</th>
                      <th>数量</th>
                      <th>エントリー日時</th>
                      <th>決済日時</th>
                      <th>獲得pips</th>
                      <th>損益</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedBatch.trades.slice(0, 5).map((t, idx) => (
                      <tr key={idx}>
                        <td>{t.ticket}</td>
                        <td>{t.symbol}</td>
                        <td>
                          <span className={`type-badge ${t.type.toLowerCase()}`}>
                            {t.type}
                          </span>
                        </td>
                        <td>{t.lots}</td>
                        <td>{t.open_time}</td>
                        <td>{t.close_time}</td>
                        <td className={t.pips >= 0 ? "text-profit" : "text-loss"}>
                          {t.pips >= 0 ? `+${t.pips}` : t.pips}
                        </td>
                        <td className={t.profit >= 0 ? "text-profit font-data" : "text-loss font-data"}>
                          {t.profit >= 0 ? `+¥${t.profit.toLocaleString()}` : `-¥${Math.abs(t.profit).toLocaleString()}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="trade-import-modal-footer">
          <button className="pro-btn" onClick={onClose}>
            キャンセル
          </button>
          <button
            className="pro-btn primary pro-glow"
            disabled={!parsedBatch || parsedBatch.trades.length === 0}
            onClick={handleConfirmImport}
          >
            <span className="material-symbols-outlined text-[14px]">analytics</span>
            <span>インポートして分析開始</span>
          </button>
        </div>
      </div>
    </div>
  );
};
