import React, { useState, useRef, useEffect } from "react";

export interface CustomSelectOption<T = string | number> {
  value: T;
  label: React.ReactNode;
  triggerLabel?: React.ReactNode;
}

interface CustomSelectProps<T = string | number> {
  value: T;
  onChange: (value: T) => void;
  options: CustomSelectOption<T>[];
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}

export function CustomSelect<T = string | number>({
  value,
  onChange,
  options,
  placeholder = "選択してください...",
  className = "",
  style,
  disabled = false
}: CustomSelectProps<T>): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selectedOption = options.find(opt => opt.value === value);

  // ドロップダウンの外をクリックしたときに閉じる
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // 開いたときに現在選択されているオプションをハイライト位置にする
  useEffect(() => {
    if (isOpen) {
      const idx = options.findIndex(opt => opt.value === value);
      setHighlightedIndex(idx >= 0 ? idx : 0);
    }
  }, [isOpen, value, options]);

  // ハイライト項目がスクロール領域外に出たら自動スクロール
  useEffect(() => {
    if (isOpen && highlightedIndex >= 0 && listRef.current) {
      const listEl = listRef.current;
      const activeEl = listEl.children[highlightedIndex] as HTMLElement;
      if (activeEl) {
        const listHeight = listEl.clientHeight;
        const listScrollTop = listEl.scrollTop;
        const activeHeight = activeEl.clientHeight;
        const activeTop = activeEl.offsetTop;

        if (activeTop < listScrollTop) {
          listEl.scrollTop = activeTop;
        } else if (activeTop + activeHeight > listScrollTop + listHeight) {
          listEl.scrollTop = activeTop + activeHeight - listHeight;
        }
      }
    }
  }, [highlightedIndex, isOpen]);

  // キーボード操作のハンドリング
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === "Enter" || e.key === "ArrowDown" || e.key === "Space" || e.key === " ") {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case "Escape":
        setIsOpen(false);
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < options.length) {
          onChange(options[highlightedIndex].value);
          setIsOpen(false);
        }
        break;
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex(prev => (options.length > 0 ? (prev + 1) % options.length : -1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex(prev => (options.length > 0 ? (prev - 1 + options.length) % options.length : -1));
        break;
      case "Tab":
        setIsOpen(false);
        break;
      default:
        break;
    }
  };

  const currentDisplay = selectedOption ? (selectedOption.triggerLabel ?? selectedOption.label) : placeholder;
  const triggerTitle = typeof currentDisplay === "string" ? currentDisplay : undefined;

  return (
    <div
      className={`custom-select-container ${className} ${disabled ? "disabled" : ""} ${isOpen ? "open" : ""}`}
      style={style}
      ref={containerRef}
      onKeyDown={handleKeyDown}
      tabIndex={disabled ? -1 : 0}
    >
      <div
        className="custom-select-trigger"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        title={triggerTitle}
      >
        <span className="custom-select-value">
          {currentDisplay}
        </span>
        <span className="custom-select-arrow material-symbols-outlined">
          keyboard_arrow_down
        </span>
      </div>

      {isOpen && (
        <div className="custom-select-dropdown">
          <ul className="custom-select-options" ref={listRef}>
            {options.map((option, idx) => {
              const isSelected = option.value === value;
              const isHighlighted = idx === highlightedIndex;
              const optTitle = typeof option.label === "string" ? option.label : undefined;
              return (
                <li
                  key={idx}
                  className={`custom-select-option ${isSelected ? "selected" : ""} ${isHighlighted ? "highlighted" : ""}`}
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  title={optTitle}
                >
                  <span className="option-label">{option.label}</span>
                  {isSelected && (
                    <span className="selected-check material-symbols-outlined">
                      check
                    </span>
                  )}
                </li>
              );
            })}
            {options.length === 0 && (
              <li className="custom-select-option-empty">項目がありません</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
