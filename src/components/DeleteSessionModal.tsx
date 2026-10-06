import React from "react";

interface DeleteSessionModalProps {
  isOpen: boolean;
  message?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export const DeleteSessionModal: React.FC<DeleteSessionModalProps> = React.memo(({
  isOpen,
  message,
  onConfirm,
  onClose
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container" style={{ maxWidth: "400px" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span className="material-symbols-outlined" style={{ color: "var(--status-danger)" }}>delete</span>
            セッションデータの削除
          </h3>
          <button className="modal-close-btn" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="modal-body" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "12px", lineHeight: "1.6" }}>
          <div style={{ fontSize: "12px", textAlign: "center" }}>
            {message || "このセッションデータを完全に削除してもよろしいですか？この操作は取り消せません。"}
          </div>
        </div>
        <div className="modal-footer" style={{ padding: "12px 16px", display: "flex", gap: "8px", width: "100%", boxSizing: "border-box" }}>
          <button className="pro-btn" style={{ flex: 1 }} onClick={onClose}>
            キャンセル
          </button>
          <button className="pro-btn danger-filled" style={{ flex: 1 }} onClick={onConfirm}>
            削除
          </button>
        </div>
      </div>
    </div>
  );
});
