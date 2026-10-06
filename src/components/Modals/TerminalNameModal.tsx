import React, { useState, useEffect, useRef } from "react";
import { TerminalInfo } from "../../types/terminal";

interface TerminalNameModalProps {
  isOpen: boolean;
  terminal: TerminalInfo | null;
  onSave: (terminalPath: string, customName: string) => Promise<void> | void;
  onReset: (terminalPath: string) => Promise<void> | void;
  onClose: () => void;
}

export const TerminalNameModal: React.FC<TerminalNameModalProps> = React.memo(({
  isOpen,
  terminal,
  onSave,
  onReset,
  onClose
}) => {
  const [nameInput, setNameInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && terminal) {
      setNameInput(terminal.custom_name || "");
      // モーダルオープン時に入力欄へフォーカス
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 50);
    }
  }, [isOpen, terminal]);

  if (!isOpen || !terminal) return null;

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isSaving) return;

    setIsSaving(true);
    try {
      await onSave(terminal.path, nameInput.trim());
      onClose();
    } catch (err) {
      console.error("Failed to save terminal name:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    if (isSaving) return;

    setIsSaving(true);
    try {
      await onReset(terminal.path);
      setNameInput("");
      onClose();
    } catch (err) {
      console.error("Failed to reset terminal name:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
      <div
        className="modal-container"
        style={{ maxWidth: "480px", width: "90%" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span className="material-symbols-outlined" style={{ color: "var(--primary-color)" }}>edit_note</span>
            MT5ターミナル名の設定
          </h3>
          <button className="modal-close-btn" onClick={onClose} title="閉じる">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <form onSubmit={handleSave}>
          <div className="modal-body" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
            {/* 検出情報カード */}
            <div
              style={{
                backgroundColor: "var(--surface-container-low)",
                border: "1px solid var(--outline-variant)",
                borderRadius: "var(--radius-sm)",
                padding: "10px 12px",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                fontSize: "11px"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--on-surface-variant)" }}>検出名 (デフォルト):</span>
                <span style={{ fontWeight: 600, color: "var(--on-surface)" }}>
                  {terminal.default_name || terminal.name}
                </span>
              </div>
              {terminal.origin_path && (
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ color: "var(--on-surface-variant)" }}>インストール元:</span>
                  <span
                    style={{
                      fontFamily: "monospace",
                      fontSize: "10px",
                      color: "var(--on-surface)",
                      wordBreak: "break-all",
                      opacity: 0.85
                    }}
                  >
                    {terminal.origin_path}
                  </span>
                </div>
              )}
              {terminal.id && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "var(--on-surface-variant)" }}>データフォルダID:</span>
                  <span style={{ fontFamily: "monospace", fontSize: "10px", color: "var(--on-surface)", opacity: 0.75 }}>
                    {terminal.id}
                  </span>
                </div>
              )}
            </div>

            {/* カスタム名入力フィールド */}
            <div className="form-group" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label className="form-label" style={{ marginBottom: 0, fontWeight: 600 }}>
                表示名（ニックネーム）
              </label>
              <input
                ref={inputRef}
                type="text"
                className="pro-input"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder={terminal.default_name || "例: Axiory 検証用 / デモ口座"}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "8px 12px",
                  fontSize: "13px"
                }}
              />
              <span style={{ fontSize: "10px", color: "var(--on-surface-variant)", lineHeight: 1.4 }}>
                ※ 接続設定のドロップダウンやセッション一覧で表示される名前を設定できます。空にして保存するとデフォルト名に戻ります。
              </span>
            </div>
          </div>

          <div
            className="modal-footer"
            style={{
              padding: "12px 16px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderTop: "1px solid var(--outline-variant)"
            }}
          >
            <div>
              {terminal.custom_name && (
                <button
                  type="button"
                  className="pro-btn"
                  style={{ fontSize: "11px", padding: "6px 12px" }}
                  onClick={handleReset}
                  disabled={isSaving}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>restart_alt</span>
                  デフォルトに戻す
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                className="pro-btn"
                onClick={onClose}
                disabled={isSaving}
                style={{ fontSize: "12px", padding: "6px 14px" }}
              >
                キャンセル
              </button>
              <button
                type="submit"
                className="pro-btn primary-filled"
                disabled={isSaving}
                style={{ fontSize: "12px", padding: "6px 16px" }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: "15px" }}>check</span>
                保存
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
});
