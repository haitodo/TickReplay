import React from "react";

export interface SaveSessionModalProps {
  isOpen: boolean;
  sessionSaveType: "manual" | "terminate";
  currentSessionId: string | null;
  currentSessionName: string;
  saveSessionName: string;
  setSaveSessionName: (val: string) => void;
  saveAsNewSnapshot: boolean;
  setSaveAsNewSnapshot: (val: boolean) => void;
  onSave: () => void | Promise<void>;
  onTerminateWithoutSaving?: () => void | Promise<void>;
  onClose: () => void;
}

export const SaveSessionModal: React.FC<SaveSessionModalProps> = React.memo(({
  isOpen,
  sessionSaveType,
  currentSessionId,
  currentSessionName,
  saveSessionName,
  setSaveSessionName,
  saveAsNewSnapshot,
  setSaveAsNewSnapshot,
  onSave,
  onTerminateWithoutSaving,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container" style={{ maxWidth: "400px" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span className="material-symbols-outlined icon-accent" style={{ color: "var(--primary-color)" }}>
              save
            </span>
            {sessionSaveType === "terminate" ? "セッションを保存して終了" : "現在の状態を保存"}
          </h3>
          <button className="modal-close-btn" onClick={onClose}>
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
          {sessionSaveType === "terminate" && onTerminateWithoutSaving && (
            <button
              className="pro-btn danger"
              style={{ marginRight: "auto" }}
              onClick={onTerminateWithoutSaving}
            >
              保存せず終了
            </button>
          )}
          <button className="pro-btn" onClick={onClose}>
            キャンセル
          </button>
          <button
            className="pro-btn primary"
            disabled={!saveSessionName.trim()}
            onClick={onSave}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
});
