import React, { useState, useRef, useEffect } from "react";

export interface SymbolItem {
  name: string;
  source_type: "custom" | "broker" | "default" | string;
  group_name: string;
}

interface SymbolComboboxProps {
  value: string;
  onChange: (value: string) => void;
  availableSymbols: (SymbolItem | string)[];
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const SymbolCombobox: React.FC<SymbolComboboxProps> = ({
  value,
  onChange,
  availableSymbols,
  placeholder = "e.g. USDJPY",
  className = "",
  style
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [filterText, setFilterText] = useState(value);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    setFilterText(value);
  }, [value]);

  // SymbolItem 形式への正規化
  const normalizedItems: SymbolItem[] = availableSymbols.map(s => {
    if (typeof s === "string") {
      const upper = s.toUpperCase();
      const isCustom = upper.endsWith("_CUSTOM") || upper.includes("REPLAY") || upper.endsWith(".CUSTOM");
      return {
        name: s,
        source_type: isCustom ? "custom" : "broker",
        group_name: isCustom ? "Custom" : "Standard",
      };
    }
    return s;
  });

  // フィルタリング
  const searchUpper = filterText.trim().toUpperCase();
  const filteredItems = normalizedItems.filter(item => item.name.toUpperCase().includes(searchUpper));

  // フォルダ（group_name）ごとのグループ化
  const groupsMap = new Map<string, SymbolItem[]>();
  filteredItems.forEach(item => {
    const grp = item.group_name || "Standard";
    if (!groupsMap.has(grp)) {
      groupsMap.set(grp, []);
    }
    // 重複除去 (同じ銘柄名が同一グループ内に複数入らないように)
    const list = groupsMap.get(grp)!;
    if (!list.some(i => i.name === item.name)) {
      list.push(item);
    }
  });

  // グループ表示順のソート: Custom -> ブローカー (OANDA等) -> Default
  const sortedGroupNames = Array.from(groupsMap.keys()).sort((a, b) => {
    if (a.toLowerCase() === "custom") return -1;
    if (b.toLowerCase() === "custom") return 1;
    if (a.toLowerCase() === "default") return 1;
    if (b.toLowerCase() === "default") return -1;
    return a.localeCompare(b);
  });

  // 全フィルター済みオプションのフラット配列（キーボード操作用）
  const allFilteredOptions: SymbolItem[] = [];
  sortedGroupNames.forEach(grp => {
    const items = groupsMap.get(grp) || [];
    allFilteredOptions.push(...items);
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen && (e.key === "ArrowDown" || e.key === "Enter")) {
      setIsOpen(true);
      return;
    }

    if (e.key === "Escape") {
      setIsOpen(false);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex(prev => (allFilteredOptions.length > 0 ? (prev + 1) % allFilteredOptions.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex(prev => (allFilteredOptions.length > 0 ? (prev - 1 + allFilteredOptions.length) % allFilteredOptions.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (allFilteredOptions.length > 0 && highlightedIndex >= 0 && highlightedIndex < allFilteredOptions.length) {
        const selected = allFilteredOptions[highlightedIndex];
        onChange(selected.name);
        setFilterText(selected.name);
        setIsOpen(false);
      }
    }
  };

  const handleSelect = (symName: string) => {
    onChange(symName);
    setFilterText(symName);
    setIsOpen(false);
  };

  const getGroupHeaderTitle = (groupName: string): string => {
    const lower = groupName.toLowerCase();
    if (lower === "custom") return "✨ 作成済みカスタムシンボル";
    if (lower === "default") return "📊 デフォルト銘柄";
    return `🏛️ ${groupName}`;
  };

  const getBadgeStyle = (item: SymbolItem) => {
    const lowerType = item.source_type.toLowerCase();
    const lowerGroup = item.group_name.toLowerCase();

    if (lowerType === "custom" || lowerGroup === "custom") {
      return {
        label: "Custom",
        bg: "rgba(168, 199, 250, 0.15)",
        color: "#a8c7fa",
      };
    }
    if (lowerType === "default" || lowerGroup === "default") {
      return {
        label: "Default",
        bg: "rgba(255, 255, 255, 0.08)",
        color: "#888",
      };
    }

    // ブローカーフォルダ名からのショートラベル (例: "OANDA-Japan MT5 Live" -> "OANDA")
    let label = item.group_name.split("-")[0].split(" ")[0];
    if (!label || label === "Standard") label = "Broker";

    return {
      label,
      bg: "rgba(109, 213, 237, 0.15)",
      color: "#6dd5ed",
    };
  };

  let globalCounter = 0;

  return (
    <div className={`symbol-combobox-container ${className}`} ref={containerRef} style={{ position: "relative", width: "100%", ...style }}>
      <div className="input-with-button-container" style={{ width: "100%" }}>
        <input
          type="text"
          className="pro-input input-with-button"
          value={filterText}
          onChange={(e) => {
            setFilterText(e.target.value);
            onChange(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          style={{ width: "100%" }}
        />
        <button
          type="button"
          className="input-inline-btn"
          onClick={() => setIsOpen(!isOpen)}
          title="シンボルの候補を表示"
        >
          <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
            {isOpen ? "expand_less" : "expand_more"}
          </span>
        </button>
      </div>

      {isOpen && allFilteredOptions.length > 0 && (
        <ul
          ref={listRef}
          className="custom-select-dropdown"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 1000,
            maxHeight: "240px",
            overflowY: "auto",
            margin: "4px 0 0 0",
            padding: "4px 0",
            backgroundColor: "var(--surface-container-high, #1e1e24)",
            border: "1px solid var(--outline-variant, #333)",
            borderRadius: "var(--radius-sm, 6px)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
            listStyle: "none"
          }}
        >
          {sortedGroupNames.map((grp, grpIdx) => {
            const items = groupsMap.get(grp) || [];
            if (items.length === 0) return null;

            return (
              <React.Fragment key={grp}>
                <li
                  className="select-group-header"
                  style={{
                    padding: "4px 10px",
                    fontSize: "11px",
                    fontWeight: "bold",
                    color: grp.toLowerCase() === "custom" ? "var(--tertiary, #a8c7fa)" : "var(--text-muted, #aaa)",
                    backgroundColor: "rgba(255,255,255,0.03)",
                    marginTop: grpIdx > 0 ? "6px" : 0
                  }}
                >
                  {getGroupHeaderTitle(grp)}
                </li>
                {items.map((item) => {
                  const globalIdx = globalCounter++;
                  const isSelected = item.name === value;
                  const isHighlighted = globalIdx === highlightedIndex;
                  const badge = getBadgeStyle(item);

                  return (
                    <li
                      key={`${grp}_${item.name}`}
                      className={`custom-select-option ${isHighlighted ? "highlighted" : ""} ${isSelected ? "selected" : ""}`}
                      onClick={() => handleSelect(item.name)}
                      onMouseEnter={() => setHighlightedIndex(globalIdx)}
                      style={{
                        padding: "6px 12px",
                        fontSize: "12px",
                        cursor: "pointer",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        backgroundColor: isHighlighted ? "rgba(255,255,255,0.08)" : isSelected ? "rgba(74, 144, 226, 0.2)" : "transparent"
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{item.name}</span>
                      <span
                        className="badge-chip"
                        style={{
                          fontSize: "10px",
                          padding: "1px 6px",
                          borderRadius: "4px",
                          backgroundColor: badge.bg,
                          color: badge.color
                        }}
                      >
                        {badge.label}
                      </span>
                    </li>
                  );
                })}
              </React.Fragment>
            );
          })}
        </ul>
      )}
    </div>
  );
};
