import React, { useState, useEffect, useRef } from "react";

export interface SpeedPresetsModalProps {
  isOpen: boolean;
  timePresets: number[];
  tickPresets: number[];
  onSave: (timePresets: number[], tickPresets: number[]) => void | Promise<void>;
  onClose: () => void;
}

export const SpeedPresetsModal: React.FC<SpeedPresetsModalProps> = React.memo(({
  isOpen,
  timePresets,
  tickPresets,
  onSave,
  onClose,
}) => {
  const [editingTimePresets, setEditingTimePresets] = useState<number[]>(timePresets);
  const [editingTickPresets, setEditingTickPresets] = useState<number[]>(tickPresets);
  const [modalNewTimePreset, setModalNewTimePreset] = useState<string>("");
  const [modalNewTickPreset, setModalNewTickPreset] = useState<string>("");
  const prevIsOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setEditingTimePresets([...timePresets]);
      setEditingTickPresets([...tickPresets]);
      setModalNewTimePreset("");
      setModalNewTickPreset("");
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, timePresets, tickPresets]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container" style={{ maxWidth: "420px" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span className="material-symbols-outlined icon-accent" style={{ color: "var(--primary-color)" }}>
              tune
            </span>
            速度プリセット設定
          </h3>
          <button className="modal-close-btn" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="modal-body" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
          {/* Time Presets */}
          <div>
            <div className="form-label" style={{ marginBottom: "4px" }}>
              時間比率モード (倍率):
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "6px" }}>
              {editingTimePresets.map((val, idx) => (
                <span
                  key={idx}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "3px",
                    background: "#161922",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: "12px",
                    padding: "2px 8px",
                    fontSize: "11px",
                  }}
                >
                  {val}x
                  <button
                    type="button"
                    style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", padding: 0 }}
                    onClick={() => setEditingTimePresets(editingTimePresets.filter((_, i) => i !== idx))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: "4px" }}>
              <input
                type="number"
                step="0.1"
                className="input-compact"
                placeholder="例: 15.0"
                value={modalNewTimePreset}
                onChange={(e) => setModalNewTimePreset(e.target.value)}
              />
              <button
                type="button"
                className="pro-btn primary"
                onClick={() => {
                  const num = parseFloat(modalNewTimePreset);
                  if (!isNaN(num) && num > 0 && !editingTimePresets.includes(num)) {
                    setEditingTimePresets([...editingTimePresets, num].sort((a, b) => a - b));
                    setModalNewTimePreset("");
                  }
                }}
              >
                追加
              </button>
            </div>
          </div>

          {/* Tick Presets */}
          <div>
            <div className="form-label" style={{ marginBottom: "4px" }}>
              ティック数モード (枚数):
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "6px" }}>
              {editingTickPresets.map((val, idx) => (
                <span
                  key={idx}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "3px",
                    background: "#161922",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: "12px",
                    padding: "2px 8px",
                    fontSize: "11px",
                  }}
                >
                  {val}T
                  <button
                    type="button"
                    style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", padding: 0 }}
                    onClick={() => setEditingTickPresets(editingTickPresets.filter((_, i) => i !== idx))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: "4px" }}>
              <input
                type="number"
                step="1"
                className="input-compact"
                placeholder="例: 20"
                value={modalNewTickPreset}
                onChange={(e) => setModalNewTickPreset(e.target.value)}
              />
              <button
                type="button"
                className="pro-btn primary"
                onClick={() => {
                  const num = parseInt(modalNewTickPreset);
                  if (!isNaN(num) && num > 0 && !editingTickPresets.includes(num)) {
                    setEditingTickPresets([...editingTickPresets, num].sort((a, b) => a - b));
                    setModalNewTickPreset("");
                  }
                }}
              >
                追加
              </button>
            </div>
          </div>
        </div>

        <div className="modal-footer" style={{ padding: "10px 16px", display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button className="pro-btn" onClick={onClose}>
            キャンセル
          </button>
          <button
            className="pro-btn primary"
            onClick={async () => {
              await onSave(editingTimePresets, editingTickPresets);
              onClose();
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
});
