import React, { useState, useRef, useEffect } from "react";
import { parseSymbolName, groupSymbolsByCategory } from "../utils/symbolUtils";

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
  dropdownAlign?: "left" | "right" | "auto";
}

export const SymbolCombobox: React.FC<SymbolComboboxProps> = ({
  value,
  onChange,
  availableSymbols,
  placeholder = "e.g. USDJPY",
  className = "",
  style,
  dropdownAlign = "auto"
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [filterText, setFilterText] = useState(value);
  const [selectedCategoryTab, setSelectedCategoryTab] = useState<string>("ALL");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    setFilterText(value);
  }, [value]);

  // カテゴリ分類データの作成
  const categoryInfo = groupSymbolsByCategory(availableSymbols);

  // SymbolItem 形式への正規化
  const normalizedItems: SymbolItem[] = availableSymbols.map(s => {
    if (typeof s === "string") {
      const parsed = parseSymbolName(s);
      return {
        name: s,
        source_type: parsed.suffix ? "custom" : "broker",
        group_name: parsed.category,
      };
    }
    return s;
  });

  // フィルタリング (テキスト検索 ＆ カテゴリタブ)
  const searchUpper = filterText.trim().toUpperCase();
  const filteredItems = normalizedItems.filter(item => {
    const parsed = parseSymbolName(item.name);
    const matchesSearch = item.name.toUpperCase().includes(searchUpper);
    if (!matchesSearch) return false;

    if (selectedCategoryTab === "ALL") return true;
    if (selectedCategoryTab === "Standard") {
      return parsed.category === "Standard" || !parsed.suffix;
    }
    return parsed.category.toLowerCase() === selectedCategoryTab.toLowerCase();
  });

  // グループ化 (カテゴリまたはグループ名)
  const groupsMap = new Map<string, SymbolItem[]>();
  filteredItems.forEach(item => {
    const parsed = parseSymbolName(item.name);
    let grp = parsed.category;
    if (parsed.isYear) {
      grp = `${parsed.category}年`;
    } else if (grp === "Standard" || !parsed.suffix) {
      grp = item.group_name || "Standard";
    }

    if (!groupsMap.has(grp)) {
      groupsMap.set(grp, []);
    }
    const list = groupsMap.get(grp)!;
    if (!list.some(i => i.name === item.name)) {
      list.push(item);
    }
  });

  // ソート
  const sortedGroupNames = Array.from(groupsMap.keys()).sort((a, b) => {
    const isYearA = /^\d{4}年?$/.test(a);
    const isYearB = /^\d{4}年?$/.test(b);
    if (isYearA && isYearB) return b.localeCompare(a);
    if (isYearA) return -1;
    if (isYearB) return 1;
    if (a.toLowerCase() === "custom") return -1;
    if (b.toLowerCase() === "custom") return 1;
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
    if (/^\d{4}年?$/.test(groupName)) return `📅 ${groupName}`;
    const lower = groupName.toLowerCase();
    if (lower === "custom") return "✨ カスタムシンボル";
    if (lower === "default" || lower === "standard") return "📊 通常・ブローカー銘柄";
    return `🏛️ ${groupName}`;
  };

  const getBadgeStyle = (item: SymbolItem) => {
    const parsed = parseSymbolName(item.name);
    if (parsed.isYear) {
      return {
        label: `${parsed.suffix}年`,
        bg: "rgba(59, 130, 246, 0.18)",
        color: "#60a5fa",
      };
    }
    if (parsed.suffix) {
      return {
        label: parsed.suffix,
        bg: "rgba(var(--tertiary-rgb, 168, 199, 250), 0.15)",
        color: "var(--tertiary, #a8c7fa)",
      };
    }
    return {
      label: "Broker",
      bg: "rgba(var(--secondary-rgb, 159, 202, 255), 0.15)",
      color: "var(--secondary-color, #9fcaff)",
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

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            ...(dropdownAlign === "right"
              ? { right: 0, left: "auto" }
              : dropdownAlign === "left"
              ? { left: 0, right: "auto" }
              : { left: 0, right: 0 }),
            minWidth: dropdownAlign !== "auto" ? "260px" : "100%",
            maxWidth: "340px",
            zIndex: 1050,
            maxHeight: "260px",
            display: "flex",
            flexDirection: "column",
            margin: "4px 0 0 0",
            backgroundColor: "var(--surface-container-high, #1e1e24)",
            border: "1px solid var(--outline-variant, #333)",
            borderRadius: "var(--radius-sm, 6px)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            overflow: "hidden"
          }}
        >
          {/* カテゴリ切り替えチップバー */}
          {categoryInfo.allCategories.length > 1 && (
            <div
              style={{
                display: "flex",
                gap: "4px",
                padding: "6px 8px",
                borderBottom: "1px solid var(--outline-variant, #333)",
                backgroundColor: "rgba(0,0,0,0.2)",
                overflowX: "auto",
                whiteSpace: "nowrap"
              }}
            >
              <button
                type="button"
                onClick={() => setSelectedCategoryTab("ALL")}
                style={{
                  padding: "2px 8px",
                  fontSize: "11px",
                  borderRadius: "12px",
                  border: "1px solid " + (selectedCategoryTab === "ALL" ? "var(--primary, #a8c7fa)" : "transparent"),
                  backgroundColor: selectedCategoryTab === "ALL" ? "rgba(168, 199, 250, 0.15)" : "transparent",
                  color: selectedCategoryTab === "ALL" ? "var(--primary, #a8c7fa)" : "var(--on-surface-variant)",
                  cursor: "pointer"
                }}
              >
                すべて
              </button>
              {categoryInfo.years.map(y => (
                <button
                  key={y}
                  type="button"
                  onClick={() => setSelectedCategoryTab(y)}
                  style={{
                    padding: "2px 8px",
                    fontSize: "11px",
                    borderRadius: "12px",
                    border: "1px solid " + (selectedCategoryTab === y ? "#60a5fa" : "transparent"),
                    backgroundColor: selectedCategoryTab === y ? "rgba(96, 165, 250, 0.2)" : "transparent",
                    color: selectedCategoryTab === y ? "#60a5fa" : "var(--on-surface-variant)",
                    cursor: "pointer"
                  }}
                >
                  📅 {y}年
                </button>
              ))}
              {categoryInfo.tags.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setSelectedCategoryTab(t)}
                  style={{
                    padding: "2px 8px",
                    fontSize: "11px",
                    borderRadius: "12px",
                    border: "1px solid " + (selectedCategoryTab === t ? "var(--tertiary, #a8c7fa)" : "transparent"),
                    backgroundColor: selectedCategoryTab === t ? "rgba(168, 199, 250, 0.2)" : "transparent",
                    color: selectedCategoryTab === t ? "var(--tertiary, #a8c7fa)" : "var(--on-surface-variant)",
                    cursor: "pointer"
                  }}
                >
                  🏷️ {t}
                </button>
              ))}
              {categoryInfo.hasStandard && (
                <button
                  type="button"
                  onClick={() => setSelectedCategoryTab("Standard")}
                  style={{
                    padding: "2px 8px",
                    fontSize: "11px",
                    borderRadius: "12px",
                    border: "1px solid " + (selectedCategoryTab === "Standard" ? "var(--secondary, #9fcaff)" : "transparent"),
                    backgroundColor: selectedCategoryTab === "Standard" ? "rgba(159, 202, 255, 0.2)" : "transparent",
                    color: selectedCategoryTab === "Standard" ? "var(--secondary, #9fcaff)" : "var(--on-surface-variant)",
                    cursor: "pointer"
                  }}
                >
                  🏛️ 通常
                </button>
              )}
            </div>
          )}

          {/* シンボル一覧 */}
          {allFilteredOptions.length === 0 ? (
            <div style={{ padding: "12px", fontSize: "12px", color: "var(--on-surface-variant)", textAlign: "center" }}>
              該当するシンボルが見つかりません
            </div>
          ) : (
            <ul
              ref={listRef}
              className="custom-select-dropdown"
              style={{
                flex: 1,
                overflowY: "auto",
                margin: 0,
                padding: "4px 0",
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
                        color: "var(--on-surface-variant)",
                        backgroundColor: "var(--surface-container-low, rgba(0,0,0,0.15))",
                        marginTop: grpIdx > 0 ? "4px" : 0
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
                            alignItems: "center"
                          }}
                        >
                          <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: "8px" }} title={item.name}>
                            {item.name}
                          </span>
                          <span
                            className="badge-chip"
                            style={{
                              fontSize: "10px",
                              padding: "1px 6px",
                              borderRadius: "4px",
                              backgroundColor: badge.bg,
                              color: badge.color,
                              flexShrink: 0
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
      )}
    </div>
  );
};
