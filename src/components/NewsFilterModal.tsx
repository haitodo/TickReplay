import React from "react";
import { NewsFilters, DEFAULT_NEWS_FILTERS } from "../constants/newsFilters";

export interface NewsFilterModalProps {
  isOpen: boolean;
  newsFilters: NewsFilters;
  onUpdateFilters: (filters: NewsFilters) => void;
  onClose: () => void;
  onReset: () => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}

export const NewsFilterModal: React.FC<NewsFilterModalProps> = React.memo(({
  isOpen,
  newsFilters,
  onUpdateFilters,
  onClose,
  onReset,
  onSelectAll,
  onClearAll
}) => {
  if (!isOpen) return null;

  const handleToggle = (ccy: string, key: "low" | "medium" | "high" | "veryHigh") => {
    const currentCcyFilter = newsFilters[ccy] || { low: false, medium: false, high: false, veryHigh: false };
    const updated = {
      ...newsFilters,
      [ccy]: {
        ...currentCcyFilter,
        [key]: !currentCcyFilter[key]
      }
    };
    onUpdateFilters(updated);
  };

  return (
    <div className="datetime-modal-overlay" onClick={onClose}>
      <div className="datetime-modal-container" style={{ maxWidth: "560px" }} onClick={(e) => e.stopPropagation()}>
        <div className="datetime-modal-header">
          <h3 className="datetime-modal-title">
            <span className="material-symbols-outlined icon-accent" style={{ fontSize: "16px" }}>filter_alt</span>
            表示指標のフィルター設定
          </h3>
          <button className="modal-close-btn" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="datetime-modal-body" style={{ gap: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>表示したい通貨および重要度にチェックを入れてください</span>
            <div style={{ display: "flex", gap: "6px" }}>
              <button type="button" className="pro-btn" style={{ padding: "2px 6px", fontSize: "10px" }} onClick={onSelectAll}>
                全選択
              </button>
              <button type="button" className="pro-btn" style={{ padding: "2px 6px", fontSize: "10px" }} onClick={onClearAll}>
                全解除
              </button>
              <button type="button" className="pro-btn" style={{ padding: "2px 6px", fontSize: "10px" }} onClick={onReset}>
                デフォルトに戻す
              </button>
            </div>
          </div>

          <div className="dashboard-table-wrapper" style={{ maxHeight: "320px", overflowY: "auto" }}>
            <table className="dashboard-table" style={{ fontSize: "11px" }}>
              <thead>
                <tr>
                  <th>通貨</th>
                  <th style={{ textAlign: "center" }}>低 (★)</th>
                  <th style={{ textAlign: "center" }}>中 (★★)</th>
                  <th style={{ textAlign: "center" }}>高 (★★★)</th>
                  <th style={{ textAlign: "center" }}>極高 (★4)</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(DEFAULT_NEWS_FILTERS).map((ccy) => {
                  const f = newsFilters[ccy] || { low: false, medium: false, high: false, veryHigh: false };
                  return (
                    <tr key={ccy}>
                      <td style={{ fontWeight: 600, color: "var(--primary-color)" }}>{ccy}</td>
                      <td style={{ textAlign: "center" }}>
                        <input type="checkbox" checked={f.low} onChange={() => handleToggle(ccy, "low")} />
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <input type="checkbox" checked={f.medium} onChange={() => handleToggle(ccy, "medium")} />
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <input type="checkbox" checked={f.high} onChange={() => handleToggle(ccy, "high")} />
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <input type="checkbox" checked={f.veryHigh} onChange={() => handleToggle(ccy, "veryHigh")} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="datetime-modal-footer">
          <button className="pro-btn primary" onClick={onClose} style={{ padding: "6px 16px", fontSize: "11px" }}>
            完了
          </button>
        </div>
      </div>
    </div>
  );
});
