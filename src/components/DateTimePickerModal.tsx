import React, { useState, useEffect } from "react";
import { parseDateTimeStr, formatDateTimeStr } from "../utils/dateUtils";

export interface DateTimePickerModalProps {
  fieldLabel: string;
  value: string;
  onChange: (val: string) => void;
  onClose: () => void;
}

export const DateTimePickerModal: React.FC<DateTimePickerModalProps> = ({
  fieldLabel,
  value,
  onChange,
  onClose
}) => {
  const parsed = parseDateTimeStr(value);
  const [tempYear, setTempYear] = useState(parsed.year);
  const [tempMonth, setTempMonth] = useState(parsed.month); // 1-12
  const [tempDay, setTempDay] = useState(parsed.day);
  const [tempHour, setTempHour] = useState(parsed.hour);
  const [tempMinute, setTempMinute] = useState(parsed.minute);

  const getDaysInMonth = (y: number, m: number) => {
    return new Date(y, m, 0).getDate();
  };

  useEffect(() => {
    const maxDays = getDaysInMonth(tempYear, tempMonth);
    if (tempDay > maxDays) {
      setTempDay(maxDays);
    }
  }, [tempYear, tempMonth]);

  const handleApply = () => {
    const formatted = formatDateTimeStr(tempYear, tempMonth, tempDay, tempHour, tempMinute);
    onChange(formatted);
    onClose();
  };

  // Days calculations
  const firstDayIndex = new Date(tempYear, tempMonth - 1, 1).getDay();
  const totalDays = getDaysInMonth(tempYear, tempMonth);
  const blanks = Array(firstDayIndex).fill(null);
  const days = Array.from({ length: totalDays }, (_, i) => i + 1);
  const gridCells = [...blanks, ...days];

  const timePresetsList = [
    { label: "00:00", h: 0, m: 0 },
    { label: "09:00 東京", h: 9, m: 0 },
    { label: "16:00 欧州", h: 16, m: 0 },
    { label: "22:00 ＮＹ", h: 22, m: 0 }
  ];

  const pad = (n: number) => n.toString().padStart(2, '0');

  return (
    <div className="datetime-modal-overlay" onClick={onClose}>
      <div className="datetime-modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="datetime-modal-header">
          <h3 className="datetime-modal-title">
            <span className="material-symbols-outlined icon-accent" style={{ fontSize: "16px" }}>calendar_today</span>
            {fieldLabel} の設定
          </h3>
          <button className="modal-close-btn" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="datetime-modal-body">
          <div className="datetime-display-box">
            <div className="datetime-display-value">
              {tempYear}-{pad(tempMonth)}-{pad(tempDay)} {pad(tempHour)}:{pad(tempMinute)}:00
            </div>
          </div>

          <div>
            <div className="picker-section-title">年</div>
            <div className="picker-grid-years">
              {[2023, 2024, 2025, 2026, 2027].map((y) => (
                <button
                  key={y}
                  type="button"
                  className={`picker-btn-grid ${tempYear === y ? 'active' : ''}`}
                  onClick={() => setTempYear(y)}
                >
                  {y}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="picker-section-title">月</div>
            <div className="picker-grid-months">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`picker-btn-grid ${tempMonth === m ? 'active' : ''}`}
                  onClick={() => setTempMonth(m)}
                >
                  {m}月
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <div className="picker-section-title" style={{ margin: 0 }}>日</div>
              <div style={{ display: "flex", gap: "4px" }}>
                <button
                  type="button"
                  className="picker-btn-grid"
                  style={{ padding: "1px 6px", fontSize: "10px" }}
                  onClick={() => setTempDay(1)}
                  title="1日（月初）にセット"
                >
                  月初 (1日)
                </button>
                <button
                  type="button"
                  className="picker-btn-grid"
                  style={{ padding: "1px 6px", fontSize: "10px" }}
                  onClick={() => setTempDay(totalDays)}
                  title={`最終日 (${totalDays}日) にセット`}
                >
                  月末 ({totalDays}日)
                </button>
              </div>
            </div>
            <div className="picker-calendar-grid">
              {["日", "月", "火", "水", "木", "金", "土"].map(d => (
                <div key={d} className="calendar-header-cell">{d}</div>
              ))}
              {gridCells.map((day, idx) => {
                if (day === null) {
                  return <div key={`blank-${idx}`} className="calendar-cell blank"></div>;
                }
                const isSelected = tempDay === day;
                return (
                  <button
                    key={`day-${day}`}
                    type="button"
                    className={`calendar-cell day-btn ${isSelected ? 'active' : ''}`}
                    onClick={() => setTempDay(day)}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="picker-section-title">時間調整 & 市場開始プリセット (JST)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div className="picker-time-controls">
                <div className="time-spinner-group">
                  <button
                    type="button"
                    className="time-spinner-btn"
                    onClick={() => setTempHour(prev => (prev - 1 + 24) % 24)}
                  >
                    -
                  </button>
                  <div className="time-spinner-value">{pad(tempHour)}</div>
                  <button
                    type="button"
                    className="time-spinner-btn"
                    onClick={() => setTempHour(prev => (prev + 1) % 24)}
                  >
                    +
                  </button>
                </div>

                <div className="time-spinner-colon">:</div>

                <div className="time-spinner-group">
                  <button
                    type="button"
                    className="time-spinner-btn"
                    onClick={() => setTempMinute(prev => (prev - 1 + 60) % 60)}
                  >
                    -
                  </button>
                  <div className="time-spinner-value">{pad(tempMinute)}</div>
                  <button
                    type="button"
                    className="time-spinner-btn"
                    onClick={() => setTempMinute(prev => (prev + 1) % 60)}
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="picker-time-presets">
                {timePresetsList.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="picker-btn-grid"
                    onClick={() => {
                      setTempHour(preset.h);
                      setTempMinute(preset.m);
                    }}
                    style={{ fontSize: "10px" }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="datetime-modal-footer">
          <button className="pro-btn" onClick={onClose} style={{ padding: "6px 12px", fontSize: "11px" }}>
            キャンセル
          </button>
          <button className="pro-btn primary" onClick={handleApply} style={{ padding: "6px 12px", fontSize: "11px" }}>
            決定
          </button>
        </div>
      </div>
    </div>
  );
};
