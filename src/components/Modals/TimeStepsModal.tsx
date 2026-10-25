import React, { useState, useEffect, useRef } from "react";
import type { TimeStepItem } from "../../types/replay";
import {
  DEFAULT_TIME_STEPS,
  formatSecondsToLabel,
  MAX_TIME_STEPS,
  PRESET_TIME_OPTIONS,
} from "../../domain/timeSteps";

export interface TimeStepsModalProps {
  isOpen: boolean;
  timeSteps: TimeStepItem[];
  onApply: (steps: TimeStepItem[]) => void;
  onClose: () => void;
}

export const TimeStepsModal: React.FC<TimeStepsModalProps> = React.memo(({
  isOpen,
  timeSteps,
  onApply,
  onClose,
}) => {
  const [editingTimeSteps, setEditingTimeSteps] = useState<TimeStepItem[]>(timeSteps);
  const prevIsOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setEditingTimeSteps(timeSteps);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, timeSteps]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container" style={{ maxWidth: "420px" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span className="material-symbols-outlined icon-accent" style={{ color: "var(--primary-color)" }}>
              tune
            </span>
            Time Steps 設定 (最大{MAX_TIME_STEPS}枠)
          </h3>
          <button className="modal-close-btn" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="modal-body" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <div className="form-label" style={{ marginBottom: "4px" }}>
              プリセットから追加:
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
              {PRESET_TIME_OPTIONS.map((preset) => {
                const isAlreadyAdded = editingTimeSteps.some((item) => item.seconds === preset.seconds);
                const isMax = editingTimeSteps.length >= MAX_TIME_STEPS;
                return (
                  <button
                    key={preset.label}
                    className="chip-btn"
                    disabled={isAlreadyAdded || isMax}
                    style={{
                      opacity: isAlreadyAdded || isMax ? 0.4 : 1,
                      cursor: isAlreadyAdded || isMax ? "not-allowed" : "pointer",
                    }}
                    onClick={() => {
                      if (editingTimeSteps.length < MAX_TIME_STEPS && !isAlreadyAdded) {
                        const updated = [
                          ...editingTimeSteps,
                          { id: `ts-${Date.now()}-${Math.random()}`, seconds: preset.seconds, label: preset.label },
                        ].sort((a, b) => a.seconds - b.seconds);
                        setEditingTimeSteps(updated);
                      }
                    }}
                  >
                    + {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="form-label" style={{ marginBottom: "6px" }}>
              設定中のステップ ({editingTimeSteps.length}/{MAX_TIME_STEPS}):
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {editingTimeSteps.map((step, index) => (
                <div
                  key={step.id || index}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    backgroundColor: "#161922",
                    padding: "4px 8px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid rgba(255, 255, 255, 0.06)",
                  }}
                >
                  <span className="font-data" style={{ fontSize: "11px", color: "var(--on-surface-variant)", width: "16px" }}>
                    #{index + 1}
                  </span>
                  <input
                    type="number"
                    className="input-compact"
                    style={{ width: "65px", textAlign: "right" }}
                    value={step.seconds}
                    min={1}
                    max={86400}
                    onChange={(e) => {
                      const val = Math.max(1, parseInt(e.target.value) || 1);
                      const updated = [...editingTimeSteps];
                      updated[index] = {
                        ...updated[index],
                        seconds: val,
                        label: formatSecondsToLabel(val),
                      };
                      setEditingTimeSteps(updated);
                    }}
                  />
                  <span style={{ fontSize: "10px", color: "var(--on-surface-variant)" }}>秒</span>
                  <input
                    type="text"
                    className="input-compact"
                    style={{ width: "50px", fontWeight: 700, marginLeft: "auto" }}
                    value={step.label}
                    onChange={(e) => {
                      const updated = [...editingTimeSteps];
                      updated[index] = { ...updated[index], label: e.target.value };
                      setEditingTimeSteps(updated);
                    }}
                  />
                  <button
                    className="btn-danger-compact"
                    style={{ width: "22px", height: "22px", padding: 0, justifyContent: "center" }}
                    disabled={editingTimeSteps.length <= 1}
                    onClick={() => {
                      if (editingTimeSteps.length > 1) {
                        setEditingTimeSteps(editingTimeSteps.filter((_, i) => i !== index));
                      }
                    }}
                  >
                    <span className="material-symbols-outlined text-[12px]">delete</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="modal-footer" style={{ padding: "10px 16px", display: "flex", gap: "8px", justifyContent: "space-between" }}>
          <button
            className="pro-btn"
            onClick={() => setEditingTimeSteps([...DEFAULT_TIME_STEPS].sort((a, b) => a.seconds - b.seconds))}
          >
            初期化
          </button>
          <div style={{ display: "flex", gap: "6px" }}>
            <button className="pro-btn" onClick={onClose}>
              キャンセル
            </button>
            <button
              className="pro-btn primary"
              onClick={() => {
                onApply(editingTimeSteps);
                onClose();
              }}
            >
              反映
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
