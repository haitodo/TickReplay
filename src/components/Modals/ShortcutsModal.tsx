import React from "react";

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
  hotkeys: Record<string, string>;
  metadata: Record<string, { name: string; desc: string }>;
  formatShortcut: (sc: string) => string;
  onKeyRecord?: (actionKey: string) => void;
  recordingKey?: string | null;
}

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({
  isOpen,
  onClose,
  hotkeys,
  metadata,
  formatShortcut,
  onKeyRecord,
  recordingKey
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content shortcuts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>キーボードショートカット一覧 (Global Hotkeys)</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <table className="shortcuts-table">
            <thead>
              <tr>
                <th>操作</th>
                <th>ショートカット</th>
                <th>説明</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(hotkeys).map((key) => (
                <tr key={key}>
                  <td className="shortcut-name">{metadata[key]?.name || key}</td>
                  <td className="shortcut-key">
                    <button
                      className={`key-badge-btn ${recordingKey === key ? "recording" : ""}`}
                      onClick={() => onKeyRecord && onKeyRecord(key)}
                    >
                      {recordingKey === key ? "キー入力待機中..." : formatShortcut(hotkeys[key])}
                    </button>
                  </td>
                  <td className="shortcut-desc">{metadata[key]?.desc || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
