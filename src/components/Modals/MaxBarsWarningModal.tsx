import React from "react";
import type { MaxBarsInfo } from "../../utils/hotkeyUtils";

export interface MaxBarsWarningModalProps {
  isOpen: boolean;
  maxBarsInfo: MaxBarsInfo | null;
  onProceed: () => void;
  onClose: () => void;
}

export const MaxBarsWarningModal: React.FC<MaxBarsWarningModalProps> = React.memo(({
  isOpen,
  maxBarsInfo,
  onProceed,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container" style={{ maxWidth: "400px" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "6px", color: "#ffb74d" }}>
            <span className="material-symbols-outlined" style={{ color: "#ffb74d" }}>
              warning
            </span>
            チャート最大バー数の確認
          </h3>
          <button className="modal-close-btn" onClick={onClose}>
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
          <button type="button" className="pro-btn" style={{ flex: 1 }} onClick={onClose}>
            戻る
          </button>
          <button
            type="button"
            className="pro-btn primary"
            style={{ flex: 1, backgroundColor: "#ffb74d", color: "#1c1b1f", fontWeight: "bold" }}
            onClick={onProceed}
          >
            開始する
          </button>
        </div>
      </div>
    </div>
  );
});
