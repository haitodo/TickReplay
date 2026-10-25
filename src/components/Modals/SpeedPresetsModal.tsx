import React, { useState, useEffect, useRef } from "react";

export interface SpeedPresetsModalProps {
  isOpen: boolean;
  timePresets: number[];
  tickPresets: number[];
  onSave: (timePresets: number[], tickPresets: number[]) => void | Promise<void>;
  onClose: () => void;
}

interface PresetEditorProps {
  label: string;
  unit: string;
  presets: number[];
  inputValue: string;
  inputStep: number;
  placeholder: string;
  parseValue: (value: string) => number;
  onInputChange: (value: string) => void;
  onPresetsChange: (presets: number[]) => void;
}

const PresetEditor: React.FC<PresetEditorProps> = ({
  label,
  unit,
  presets,
  inputValue,
  inputStep,
  placeholder,
  parseValue,
  onInputChange,
  onPresetsChange,
}) => {
  const handleAddPreset = () => {
    const value = parseValue(inputValue);
    if (!isNaN(value) && value > 0 && !presets.includes(value)) {
      onPresetsChange([...presets, value].sort((a, b) => a - b));
      onInputChange("");
    }
  };

  return (
    <div>
      <div className="form-label" style={{ marginBottom: "4px" }}>
        {label}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "6px" }}>
        {presets.map((value, index) => (
          <span
            key={index}
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
            {value}{unit}
            <button
              type="button"
              style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", padding: 0 }}
              onClick={() => onPresetsChange(presets.filter((_, presetIndex) => presetIndex !== index))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: "4px" }}>
        <input
          type="number"
          step={inputStep}
          className="input-compact"
          placeholder={placeholder}
          value={inputValue}
          onChange={(event) => onInputChange(event.target.value)}
        />
        <button type="button" className="pro-btn primary" onClick={handleAddPreset}>
          追加
        </button>
      </div>
    </div>
  );
};

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
          <PresetEditor
            label="時間比率モード (倍率):"
            unit="x"
            presets={editingTimePresets}
            inputValue={modalNewTimePreset}
            inputStep={0.1}
            placeholder="例: 15.0"
            parseValue={parseFloat}
            onInputChange={setModalNewTimePreset}
            onPresetsChange={setEditingTimePresets}
          />
          <PresetEditor
            label="ティック数モード (枚数):"
            unit="T"
            presets={editingTickPresets}
            inputValue={modalNewTickPreset}
            inputStep={1}
            placeholder="例: 20"
            parseValue={parseInt}
            onInputChange={setModalNewTickPreset}
            onPresetsChange={setEditingTickPresets}
          />
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
