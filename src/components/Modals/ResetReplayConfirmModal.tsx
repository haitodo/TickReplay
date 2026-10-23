import React from "react";

export interface ResetReplayConfirmModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export const ResetReplayConfirmModal: React.FC<ResetReplayConfirmModalProps> = React.memo(({
  isOpen,
  onConfirm,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container" style={{ maxWidth: "400px" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span className="material-symbols-outlined text-accent" style={{ color: "var(--primary-color)" }}>
              restart_alt
            </span>
            リプレイ設定のリセット
          </h3>
          <button className="modal-close-btn" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="modal-body" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "12px", lineHeight: "1.6" }}>
          <div style={{ fontSize: "12px", textAlign: "center" }}>
            リプレイ設定をデフォルト値にリセットしますか？
          </div>
        </div>
        <div className="modal-footer" style={{ padding: "12px 16px", display: "flex", gap: "8px", width: "100%", boxSizing: "border-box" }}>
          <button className="pro-btn" style={{ flex: 1 }} onClick={onClose}>
            キャンセル
          </button>
          <button className="pro-btn primary" style={{ flex: 1 }} onClick={onConfirm}>
            リセット
          </button>
        </div>
      </div>
    </div>
  );
});
