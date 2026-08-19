import React, { useState, useEffect } from "react";
import { SymbolItem } from "./SymbolCombobox";
import {
  parseSymbolName,
  groupSymbolsByCategory,
  isJpyPair,
  isUsdStraight
} from "../utils/symbolUtils";

interface SymbolBatchSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableSymbols: (SymbolItem | string)[];
  currentSourceSymbol: string;
  currentAdditionalSymbols: string;
  onApply: (
    sourceSymbol: string,
    syncSymbols: string[],
    dateRange?: { start: string; end: string }
  ) => void;
}

export const SymbolBatchSelectorModal: React.FC<SymbolBatchSelectorModalProps> = ({
  isOpen,
  onClose,
  availableSymbols,
  currentSourceSymbol,
  currentAdditionalSymbols,
  onApply
}) => {
  const categoryInfo = groupSymbolsByCategory(availableSymbols);

  const [activeCategory, setActiveCategory] = useState<string>("Standard");
  const [selectedSource, setSelectedSource] = useState<string>(currentSourceSymbol);
  const [selectedSync, setSelectedSync] = useState<string[]>([]);
  const [autoApplyDateRange, setAutoApplyDateRange] = useState<boolean>(true);

  useEffect(() => {
    if (isOpen) {
      setSelectedSource(currentSourceSymbol);

      // 同期他通貨のパース
      const syncList = currentAdditionalSymbols
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
      setSelectedSync(syncList);

      // ソースシンボルのカテゴリをアクティブに
      const parsed = parseSymbolName(currentSourceSymbol);
      if (parsed.category && categoryInfo.allCategories.includes(parsed.category)) {
        setActiveCategory(parsed.category);
      } else if (categoryInfo.allCategories.length > 0) {
        setActiveCategory(categoryInfo.allCategories[0]);
      }
    }
  }, [isOpen, currentSourceSymbol, currentAdditionalSymbols]);

  if (!isOpen) return null;

  // 現在のアクティブカテゴリに属するシンボル一覧
  const currentCategorySymbols: SymbolItem[] = (categoryInfo.categories[activeCategory] || []).map(item => {
    return typeof item === "string" ? { name: item, source_type: "custom", group_name: activeCategory } : item;
  });

  const isCurrentCategoryYear = /^\d{4}$/.test(activeCategory);

  // カテゴリ切り替え時
  const handleSelectCategory = (cat: string) => {
    setActiveCategory(cat);
    const catSymbols = categoryInfo.categories[cat] || [];
    if (catSymbols.length > 0) {
      // ソースシンボルが現在のカテゴリにない場合、カテゴリ内のUSDJPYまたは先頭を自動選択
      const currentParsed = parseSymbolName(selectedSource);
      if (currentParsed.category !== cat) {
        const preferred = catSymbols.find(s => s.name.toUpperCase().includes("USDJPY")) || catSymbols[0];
        setSelectedSource(preferred.name);

        // 同期通貨も同一カテゴリのものにリセットまたは更新
        const newSync = catSymbols
          .filter(s => s.name !== preferred.name)
          .map(s => s.name);
        setSelectedSync(newSync);
      }
    }
  };

  // 主通貨（ソース）の変更
  const handleSetSource = (symName: string) => {
    setSelectedSource(symName);
    // ソースに選んだものは同期リストから除外
    setSelectedSync(prev => prev.filter(s => s !== symName));
  };

  // 同期通貨のトグル
  const handleToggleSync = (symName: string) => {
    if (symName === selectedSource) return;

    setSelectedSync(prev => {
      if (prev.includes(symName)) {
        return prev.filter(s => s !== symName);
      } else {
        return [...prev, symName];
      }
    });
  };

  // プリセット: JPYクロス全同期
  const handleSelectAllJpy = () => {
    const jpySymbols = currentCategorySymbols
      .filter(s => isJpyPair(s.name) && s.name !== selectedSource)
      .map(s => s.name);

    setSelectedSync(prev => {
      const set = new Set(prev);
      jpySymbols.forEach(j => set.add(j));
      return Array.from(set);
    });
  };

  // プリセット: ドルストレート全同期
  const handleSelectAllUsd = () => {
    const usdSymbols = currentCategorySymbols
      .filter(s => isUsdStraight(s.name) && s.name !== selectedSource)
      .map(s => s.name);

    setSelectedSync(prev => {
      const set = new Set(prev);
      usdSymbols.forEach(u => set.add(u));
      return Array.from(set);
    });
  };

  // プリセット: このカテゴリの全シンボル同期
  const handleSelectAllInCat = () => {
    const allInCat = currentCategorySymbols
      .filter(s => s.name !== selectedSource)
      .map(s => s.name);

    setSelectedSync(prev => {
      const set = new Set(prev);
      allInCat.forEach(a => set.add(a));
      return Array.from(set);
    });
  };

  // プリセット: 同期全解除
  const handleClearSync = () => {
    const inCatSet = new Set(currentCategorySymbols.map(s => s.name));
    setSelectedSync(prev => prev.filter(s => !inCatSet.has(s)));
  };

  // 適用
  const handleApply = () => {
    let dateRange: { start: string; end: string } | undefined = undefined;
    if (autoApplyDateRange && isCurrentCategoryYear) {
      dateRange = {
        start: `${activeCategory}-01-01 00:00:00`,
        end: `${activeCategory}-12-31 23:59:59`
      };
    }

    onApply(selectedSource, selectedSync, dateRange);
    onClose();
  };

  return (
    <div
      className="modal-overlay"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 2000
      }}
    >
      <div
        className="pro-panel"
        style={{
          width: "720px",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "var(--surface-container-high, #18181c)",
          border: "1px solid var(--outline-variant, #333)",
          borderRadius: "var(--radius-lg, 12px)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
          overflow: "hidden"
        }}
      >
        {/* Header */}
        <div className="pro-panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid var(--outline-variant)" }}>
          <h3 className="pro-panel-title" style={{ display: "flex", alignItems: "center", gap: "8px", margin: 0, fontSize: "15px" }}>
            <span className="material-symbols-outlined icon-accent">tune</span>
            シンボル ＆ マルチ通貨同期セレクター
          </h3>
          <button
            type="button"
            className="pro-btn"
            onClick={onClose}
            style={{ padding: "4px 8px", minWidth: "auto" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>close</span>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 18px", flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "14px" }}>
          
          {/* カテゴリ / 年別タブ */}
          <div>
            <label className="form-label" style={{ fontSize: "11px", marginBottom: "6px" }}>
              検証対象カテゴリ / 年分を選択
            </label>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {categoryInfo.years.map(y => (
                <button
                  key={y}
                  type="button"
                  onClick={() => handleSelectCategory(y)}
                  style={{
                    padding: "6px 12px",
                    fontSize: "12px",
                    borderRadius: "8px",
                    border: "1px solid " + (activeCategory === y ? "#60a5fa" : "var(--outline-variant, #333)"),
                    backgroundColor: activeCategory === y ? "rgba(96, 165, 250, 0.2)" : "rgba(255,255,255,0.03)",
                    color: activeCategory === y ? "#60a5fa" : "var(--on-surface)",
                    cursor: "pointer",
                    fontWeight: activeCategory === y ? 600 : "normal",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px"
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: "15px" }}>calendar_today</span>
                  {y}年
                </button>
              ))}
              {categoryInfo.tags.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleSelectCategory(t)}
                  style={{
                    padding: "6px 12px",
                    fontSize: "12px",
                    borderRadius: "8px",
                    border: "1px solid " + (activeCategory === t ? "var(--tertiary, #a8c7fa)" : "var(--outline-variant, #333)"),
                    backgroundColor: activeCategory === t ? "rgba(168, 199, 250, 0.2)" : "rgba(255,255,255,0.03)",
                    color: activeCategory === t ? "var(--tertiary, #a8c7fa)" : "var(--on-surface)",
                    cursor: "pointer",
                    fontWeight: activeCategory === t ? 600 : "normal",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px"
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: "15px" }}>label</span>
                  {t}
                </button>
              ))}
              {categoryInfo.hasStandard && (
                <button
                  type="button"
                  onClick={() => handleSelectCategory("Standard")}
                  style={{
                    padding: "6px 12px",
                    fontSize: "12px",
                    borderRadius: "8px",
                    border: "1px solid " + (activeCategory === "Standard" ? "var(--secondary, #9fcaff)" : "var(--outline-variant, #333)"),
                    backgroundColor: activeCategory === "Standard" ? "rgba(159, 202, 255, 0.2)" : "rgba(255,255,255,0.03)",
                    color: activeCategory === "Standard" ? "var(--secondary, #9fcaff)" : "var(--on-surface)",
                    cursor: "pointer",
                    fontWeight: activeCategory === "Standard" ? 600 : "normal",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px"
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: "15px" }}>account_balance</span>
                  通常銘柄
                </button>
              )}
            </div>
          </div>

          {/* 選択ステータスカード */}
          <div style={{
            padding: "10px 14px",
            borderRadius: "8px",
            backgroundColor: "rgba(0,0,0,0.25)",
            border: "1px solid var(--outline-variant)",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "12px"
          }}>
            <div>
              <div style={{ fontSize: "11px", color: "var(--on-surface-variant)", display: "flex", alignItems: "center", gap: "4px" }}>
                <span>👑</span> <strong>主通貨（ソースシンボル）</strong>
              </div>
              <div style={{ fontSize: "14px", fontWeight: "bold", color: "var(--primary, #a8c7fa)", marginTop: "2px" }}>
                {selectedSource || "未選択"}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "11px", color: "var(--on-surface-variant)", display: "flex", alignItems: "center", gap: "4px" }}>
                <span>🔄</span> <strong>同期他通貨シンボル ({selectedSync.length} 銘柄)</strong>
              </div>
              <div style={{ fontSize: "12px", color: "var(--on-surface)", marginTop: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={selectedSync.join(", ")}>
                {selectedSync.length > 0 ? selectedSync.join(", ") : "同期なし (単一通貨リプレイ)"}
              </div>
            </div>
          </div>

          {/* プリセット一括操作バー */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
            <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--on-surface-variant)" }}>
              {isCurrentCategoryYear ? `📅 ${activeCategory}年のシンボル一覧` : `🏷️ ${activeCategory} のシンボル一覧`} ({currentCategorySymbols.length} 銘柄)
            </div>
            <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
              <button
                type="button"
                className="pro-btn"
                onClick={handleSelectAllJpy}
                style={{ padding: "2px 8px", fontSize: "11px", height: "24px" }}
              >
                JPYクロス全同期
              </button>
              <button
                type="button"
                className="pro-btn"
                onClick={handleSelectAllUsd}
                style={{ padding: "2px 8px", fontSize: "11px", height: "24px" }}
              >
                ドルストレート全同期
              </button>
              <button
                type="button"
                className="pro-btn"
                onClick={handleSelectAllInCat}
                style={{ padding: "2px 8px", fontSize: "11px", height: "24px" }}
              >
                全同期
              </button>
              <button
                type="button"
                className="pro-btn"
                onClick={handleClearSync}
                style={{ padding: "2px 8px", fontSize: "11px", height: "24px" }}
              >
                同期解除
              </button>
            </div>
          </div>

          {/* 通貨ペアグリッド */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: "8px",
            maxHeight: "240px",
            overflowY: "auto",
            paddingRight: "4px"
          }}>
            {currentCategorySymbols.map(item => {
              const isSource = item.name === selectedSource;
              const isSync = selectedSync.includes(item.name);

              return (
                <div
                  key={item.name}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "6px",
                    backgroundColor: isSource
                      ? "rgba(168, 199, 250, 0.15)"
                      : isSync
                      ? "rgba(34, 197, 94, 0.08)"
                      : "rgba(255,255,255,0.02)",
                    border: "1px solid " + (
                      isSource
                        ? "var(--primary, #a8c7fa)"
                        : isSync
                        ? "rgba(34, 197, 94, 0.4)"
                        : "var(--outline-variant, rgba(255,255,255,0.06))"
                    ),
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <button
                      type="button"
                      onClick={() => handleSetSource(item.name)}
                      title="このシンボルを主通貨（ソース）に設定"
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        fontSize: "16px",
                        color: isSource ? "#fbbf24" : "var(--on-surface-variant)"
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
                        {isSource ? "stars" : "radio_button_unchecked"}
                      </span>
                    </button>
                    <div>
                      <div style={{ fontWeight: isSource ? "bold" : 600, fontSize: "13px", color: isSource ? "var(--primary, #a8c7fa)" : "var(--on-surface)" }}>
                        {item.name}
                      </div>
                      <div style={{ fontSize: "10px", color: "var(--on-surface-variant)" }}>
                        {isSource ? "👑 主通貨 (ソース)" : isSync ? "🔄 同期他通貨" : "非同期"}
                      </div>
                    </div>
                  </div>

                  {!isSource && (
                    <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={isSync}
                        onChange={() => handleToggleSync(item.name)}
                      />
                      <span>同期</span>
                    </label>
                  )}
                </div>
              );
            })}
          </div>

          {/* 期間連動オプション */}
          {isCurrentCategoryYear && (
            <div style={{
              padding: "8px 12px",
              borderRadius: "6px",
              backgroundColor: "rgba(255,255,255,0.02)",
              border: "1px solid var(--outline-variant)",
              display: "flex",
              alignItems: "center",
              gap: "8px"
            }}>
              <input
                type="checkbox"
                id="autoDateSync"
                checked={autoApplyDateRange}
                onChange={(e) => setAutoApplyDateRange(e.target.checked)}
              />
              <label htmlFor="autoDateSync" style={{ fontSize: "12px", cursor: "pointer", color: "var(--on-surface)" }}>
                リプレイ期間を <strong>{activeCategory}-01-01</strong> 〜 <strong>{activeCategory}-12-31</strong> に自動連動する
              </label>
            </div>
          )}

        </div>

        {/* Footer */}
        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--outline-variant)", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
          <button
            type="button"
            className="pro-btn"
            onClick={onClose}
          >
            キャンセル
          </button>
          <button
            type="button"
            className="pro-btn pro-btn-primary"
            onClick={handleApply}
            style={{ padding: "0 20px" }}
          >
            設定を反映して適用
          </button>
        </div>
      </div>
    </div>
  );
};
