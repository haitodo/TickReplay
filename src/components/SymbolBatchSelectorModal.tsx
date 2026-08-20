import React, { useState, useEffect, useMemo } from "react";
import { SymbolItem } from "./SymbolCombobox";
import {
  parseSymbolName,
  groupSymbolsByCategory,
  isJpyPair,
  isUsdStraight,
  getDualFeedCandidates,
  getAllBrokers,
  getAllYears
} from "../utils/symbolUtils";

export interface SymbolBatchSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableSymbols: (SymbolItem | string)[];
  currentSourceSymbol: string;
  currentSubSourceSymbol?: string;
  currentEnableDualFeed?: boolean;
  currentAdditionalSymbols: string;
  onApply: (
    sourceSymbol: string,
    subSourceSymbol: string,
    enableDualFeed: boolean,
    syncSymbols: string[],
    dateRange?: { start: string; end: string }
  ) => void;
}

export const SymbolBatchSelectorModal: React.FC<SymbolBatchSelectorModalProps> = ({
  isOpen,
  onClose,
  availableSymbols,
  currentSourceSymbol,
  currentSubSourceSymbol = "",
  currentEnableDualFeed = false,
  currentAdditionalSymbols,
  onApply
}) => {
  // モード: "single" (通常リプレイ) | "dual" (デュアルフィード比較リプレイ)
  const [replayMode, setReplayMode] = useState<"single" | "dual">("single");

  // フィルタ状態
  const [selectedYear, setSelectedYear] = useState<string>("ALL");
  const [selectedBroker, setSelectedBroker] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("" );

  // Single モード用
  const [selectedSource, setSelectedSource] = useState<string>(currentSourceSymbol);
  const [selectedSync, setSelectedSync] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("Standard");

  // Dual モード用
  const [dualMainSymbol, setDualMainSymbol] = useState<string>(currentSourceSymbol);
  const [dualSubSymbol, setDualSubSymbol] = useState<string>(currentSubSourceSymbol);

  // オプション
  const [autoApplyDateRange, setAutoApplyDateRange] = useState<boolean>(true);

  const categoryInfo = useMemo(() => groupSymbolsByCategory(availableSymbols), [availableSymbols]);
  const allYears = useMemo(() => getAllYears(availableSymbols), [availableSymbols]);
  const allBrokers = useMemo(() => getAllBrokers(availableSymbols), [availableSymbols]);
  const dualCandidates = useMemo(() => getDualFeedCandidates(availableSymbols), [availableSymbols]);

  // モーダルオープン時の初期化
  useEffect(() => {
    if (isOpen) {
      setReplayMode(currentEnableDualFeed ? "dual" : "single");
      setSelectedSource(currentSourceSymbol);
      setDualMainSymbol(currentSourceSymbol);
      setDualSubSymbol(currentSubSourceSymbol);

      // 同期他通貨のパース
      const syncList = currentAdditionalSymbols
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
      setSelectedSync(syncList);

      // ソースシンボルのカテゴリ・年度をアクティブに
      const parsed = parseSymbolName(currentSourceSymbol);
      if (parsed.year && allYears.includes(parsed.year)) {
        setSelectedYear(parsed.year);
      } else {
        setSelectedYear("ALL");
      }

      if (parsed.broker && allBrokers.includes(parsed.broker)) {
        setSelectedBroker(parsed.broker);
      } else {
        setSelectedBroker("ALL");
      }

      if (parsed.category && categoryInfo.allCategories.includes(parsed.category)) {
        setActiveCategory(parsed.category);
      } else if (categoryInfo.allCategories.length > 0) {
        setActiveCategory(categoryInfo.allCategories[0]);
      }
    }
  }, [isOpen, currentSourceSymbol, currentSubSourceSymbol, currentEnableDualFeed, currentAdditionalSymbols, allYears, allBrokers, categoryInfo]);

  if (!isOpen) return null;

  // --- フィルタリング ---
  const filteredDualCandidates = dualCandidates.filter(c => {
    if (selectedYear !== "ALL" && c.year !== selectedYear) return false;
    if (selectedBroker !== "ALL" && !c.brokers.some(b => b.broker.toUpperCase() === selectedBroker.toUpperCase())) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toUpperCase();
      if (!c.basePair.toUpperCase().includes(q) && !c.year.includes(q)) return false;
    }
    return true;
  });

  // Single モードのフィルタ済みシンボル一覧
  const currentCategorySymbols: SymbolItem[] = (categoryInfo.categories[activeCategory] || []).map(item => {
    return typeof item === "string" ? { name: item, source_type: "custom", group_name: activeCategory } : item;
  });

  const isCurrentCategoryYear = /^\d{4}$/.test(activeCategory);

  // カテゴリ切り替え時
  const handleSelectCategory = (cat: string) => {
    setActiveCategory(cat);
    const catSymbols = categoryInfo.categories[cat] || [];
    if (catSymbols.length > 0) {
      const currentParsed = parseSymbolName(selectedSource);
      if (currentParsed.category !== cat) {
        const preferred = catSymbols.find(s => s.name.toUpperCase().includes("USDJPY")) || catSymbols[0];
        setSelectedSource(preferred.name);

        const newSync = catSymbols
          .filter(s => s.name !== preferred.name)
          .map(s => s.name);
        setSelectedSync(newSync);
      }
    }
  };

  // Single: 主通貨（ソース）の変更
  const handleSetSource = (symName: string) => {
    setSelectedSource(symName);
    setSelectedSync(prev => prev.filter(s => s !== symName));
  };

  // Single: 同期通貨のトグル
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

  // プリセット系
  const handleSelectAllJpy = () => {
    const jpySymbols = currentCategorySymbols
      .filter(s => isJpyPair(s.name) && s.name !== selectedSource)
      .map(s => s.name);
    setSelectedSync(prev => Array.from(new Set([...prev, ...jpySymbols])));
  };

  const handleSelectAllUsd = () => {
    const usdSymbols = currentCategorySymbols
      .filter(s => isUsdStraight(s.name) && s.name !== selectedSource)
      .map(s => s.name);
    setSelectedSync(prev => Array.from(new Set([...prev, ...usdSymbols])));
  };

  const handleSelectAllInCat = () => {
    const allInCat = currentCategorySymbols
      .filter(s => s.name !== selectedSource)
      .map(s => s.name);
    setSelectedSync(prev => Array.from(new Set([...prev, ...allInCat])));
  };

  const handleClearSync = () => {
    const inCatSet = new Set(currentCategorySymbols.map(s => s.name));
    setSelectedSync(prev => prev.filter(s => !inCatSet.has(s)));
  };

  // Dual: ペア・ブローカー選択
  const handleSetDualPair = (mainSym: string, subSym: string) => {
    setDualMainSymbol(mainSym);
    setDualSubSymbol(subSym);
  };

  const handleSwapDual = () => {
    const temp = dualMainSymbol;
    setDualMainSymbol(dualSubSymbol);
    setDualSubSymbol(temp);
  };

  // 適用
  const handleApply = () => {
    const isDual = replayMode === "dual";
    const src = isDual ? dualMainSymbol : selectedSource;
    const sub = isDual ? dualSubSymbol : "";

    let dateRange: { start: string; end: string } | undefined = undefined;
    if (autoApplyDateRange) {
      const parsed = parseSymbolName(src);
      const targetYear = parsed.year || (isCurrentCategoryYear ? activeCategory : "");
      if (targetYear && /^\d{4}$/.test(targetYear)) {
        dateRange = {
          start: `${targetYear}-01-01 00:00:00`,
          end: `${targetYear}-12-31 23:59:59`
        };
      }
    }

    onApply(src, sub, isDual, isDual ? [] : selectedSync, dateRange);
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
        backgroundColor: "rgba(0, 0, 0, 0.78)",
        backdropFilter: "blur(6px)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 2100
      }}
    >
      <div
        className="pro-panel"
        style={{
          width: "820px",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "var(--surface-container-high, #18181c)",
          border: "1px solid var(--outline-variant, #333)",
          borderRadius: "var(--radius-lg, 12px)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.65)",
          overflow: "hidden"
        }}
      >
        {/* Header */}
        <div
          className="pro-panel-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "14px 20px",
            borderBottom: "1px solid var(--outline-variant)",
            backgroundColor: "rgba(0,0,0,0.2)"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span className="material-symbols-outlined icon-accent" style={{ fontSize: "22px", color: "var(--primary, #6366f1)" }}>
              tune
            </span>
            <div>
              <h3 className="pro-panel-title" style={{ margin: 0, fontSize: "15px", fontWeight: 700 }}>
                シンボル ＆ 比較ペア選択セレクター
              </h3>
              <div style={{ fontSize: "11px", color: "var(--on-surface-variant)" }}>
                検証したい年度・ブローカー・通貨ペアを視覚的かつ確実に設定します
              </div>
            </div>
          </div>
          <button
            type="button"
            className="pro-btn"
            onClick={onClose}
            style={{ padding: "4px 8px", minWidth: "auto", borderRadius: "6px" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>close</span>
          </button>
        </div>

        {/* Mode Switcher Banner */}
        <div style={{ padding: "12px 20px 0 20px" }}>
          <div style={{
            display: "flex",
            backgroundColor: "var(--surface-container)",
            padding: "3px",
            borderRadius: "8px",
            border: "1px solid var(--outline-variant)"
          }}>
            <button
              type="button"
              onClick={() => setReplayMode("single")}
              style={{
                flex: 1,
                padding: "8px 12px",
                fontSize: "12px",
                fontWeight: 600,
                borderRadius: "6px",
                border: "none",
                cursor: "pointer",
                backgroundColor: replayMode === "single" ? "var(--primary, #6366f1)" : "transparent",
                color: replayMode === "single" ? "#fff" : "var(--on-surface-variant)",
                transition: "all 0.15s ease",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px"
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>show_chart</span>
              通常リプレイ (単一シンボル ＆ マルチ通貨同期)
            </button>
            <button
              type="button"
              onClick={() => setReplayMode("dual")}
              style={{
                flex: 1,
                padding: "8px 12px",
                fontSize: "12px",
                fontWeight: 600,
                borderRadius: "6px",
                border: "none",
                cursor: "pointer",
                backgroundColor: replayMode === "dual" ? "var(--primary, #6366f1)" : "transparent",
                color: replayMode === "dual" ? "#fff" : "var(--on-surface-variant)",
                transition: "all 0.15s ease",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px"
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>compare_arrows</span>
              デュアルフィード比較リプレイ (OTC vs ECN等)
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 20px", flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "14px" }}>
          
          {/* ========================================================= */}
          {/* DUAL FEED MODE UI                                         */}
          {/* ========================================================= */}
          {replayMode === "dual" && (
            <>
              {/* 現在の比較スロットプレビュー */}
              <div style={{
                padding: "12px 16px",
                borderRadius: "8px",
                backgroundColor: "rgba(99, 102, 241, 0.08)",
                border: "1px solid rgba(99, 102, 241, 0.3)",
                display: "flex",
                flexDirection: "column",
                gap: "10px"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--primary, #a8c7fa)" }}>
                    現在選択中の比較ペア
                  </span>
                  <button
                    type="button"
                    className="pro-btn"
                    onClick={handleSwapDual}
                    title="MainとSubを入れ替え"
                    style={{ padding: "2px 10px", fontSize: "11px", height: "24px", display: "flex", alignItems: "center", gap: "4px" }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>swap_horiz</span>
                    Main / Sub 入替
                  </button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "10px", alignItems: "center" }}>
                  {/* Main Card */}
                  <div style={{
                    padding: "10px",
                    borderRadius: "6px",
                    backgroundColor: "rgba(0,0,0,0.3)",
                    border: "1px solid var(--primary, #6366f1)"
                  }}>
                    <div style={{ fontSize: "10.5px", color: "var(--primary, #6366f1)", fontWeight: 700, marginBottom: "3px" }}>
                      MAIN (メインチャートに表示)
                    </div>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--on-surface)" }}>
                      {dualMainSymbol || "(未選択)"}
                    </div>
                    {dualMainSymbol && (
                      <div style={{ fontSize: "10.5px", color: "var(--on-surface-variant)", marginTop: "2px" }}>
                        通貨: {parseSymbolName(dualMainSymbol).basePair} | 業者: {parseSymbolName(dualMainSymbol).broker || "通常"} | 年: {parseSymbolName(dualMainSymbol).year || "全期"}
                      </div>
                    )}
                  </div>

                  <span className="material-symbols-outlined" style={{ color: "var(--on-surface-variant)", fontSize: "20px" }}>
                    compare_arrows
                  </span>

                  {/* Sub Card */}
                  <div style={{
                    padding: "10px",
                    borderRadius: "6px",
                    backgroundColor: "rgba(0,0,0,0.3)",
                    border: "1px solid var(--tertiary, #a8c7fa)"
                  }}>
                    <div style={{ fontSize: "10.5px", color: "var(--tertiary, #a8c7fa)", fontWeight: 700, marginBottom: "3px" }}>
                      SUB (目印インジケーターのあるチャートに表示)
                    </div>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--on-surface)" }}>
                      {dualSubSymbol || "(未選択)"}
                    </div>
                    {dualSubSymbol && (
                      <div style={{ fontSize: "10.5px", color: "var(--on-surface-variant)", marginTop: "2px" }}>
                        通貨: {parseSymbolName(dualSubSymbol).basePair} | 業者: {parseSymbolName(dualSubSymbol).broker || "通常"} | 年: {parseSymbolName(dualSubSymbol).year || "全期"}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ fontSize: "11px", color: "var(--on-surface-variant)", lineHeight: 1.4 }}>
                  💡 <strong>ヒント</strong>: 下の候補リストからワンクリックで2社比較ペアをセットできます。プロファイル内のサブチャートに「<code>TickReplayRoleMarker</code>」インジケーターを適用してください。
                </div>
              </div>

              {/* 年フィルター ＆ 業者フィルター ＆ 検索バー */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "10px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {/* 年度フィルター */}
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "11px", color: "var(--on-surface-variant)", fontWeight: 600 }}>年度:</span>
                    <button
                      type="button"
                      className={`pro-btn ${selectedYear === "ALL" ? "active-loop" : ""}`}
                      onClick={() => setSelectedYear("ALL")}
                      style={{ padding: "2px 8px", fontSize: "11px", height: "22px" }}
                    >
                      全年度
                    </button>
                    {allYears.map(y => (
                      <button
                        key={y}
                        type="button"
                        className={`pro-btn ${selectedYear === y ? "active-loop" : ""}`}
                        onClick={() => setSelectedYear(y)}
                        style={{ padding: "2px 8px", fontSize: "11px", height: "22px" }}
                      >
                        {y}年
                      </button>
                    ))}
                  </div>

                  {/* 業者フィルター */}
                  {allBrokers.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "11px", color: "var(--on-surface-variant)", fontWeight: 600 }}>業者:</span>
                      <button
                        type="button"
                        className={`pro-btn ${selectedBroker === "ALL" ? "active-loop" : ""}`}
                        onClick={() => setSelectedBroker("ALL")}
                        style={{ padding: "2px 8px", fontSize: "10.5px", height: "22px" }}
                      >
                        全業者
                      </button>
                      {allBrokers.map(b => (
                        <button
                          key={b}
                          type="button"
                          className={`pro-btn ${selectedBroker === b ? "active-loop" : ""}`}
                          onClick={() => setSelectedBroker(b)}
                          style={{ padding: "2px 8px", fontSize: "10.5px", height: "22px" }}
                        >
                          {b}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ position: "relative", width: "200px" }}>
                  <input
                    type="text"
                    className="pro-input"
                    placeholder="通貨ペア検索..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ fontSize: "12px", height: "28px", paddingLeft: "26px" }}
                  />
                  <span className="material-symbols-outlined" style={{ position: "absolute", left: "6px", top: "6px", fontSize: "16px", color: "var(--on-surface-variant)" }}>
                    search
                  </span>
                </div>
              </div>

              {/* 比較ペア候補マトリクス */}
              <div>
                <label className="form-label" style={{ fontSize: "11px", marginBottom: "6px" }}>
                  利用可能な比較ペア候補 ({filteredDualCandidates.length} 組)
                </label>

                {filteredDualCandidates.length === 0 ? (
                  <div style={{ padding: "24px", textAlign: "center", color: "var(--on-surface-variant)", fontSize: "12px", backgroundColor: "rgba(255,255,255,0.02)", borderRadius: "8px" }}>
                    一致するシンボルが見つかりませんでした。別の年度を選択するか、カスタムシンボルをインポートしてください。
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "10px" }}>
                    {filteredDualCandidates.map(c => {
                      const hasTwoBrokers = c.brokers.length >= 2;
                      const isSelectedPair = (dualMainSymbol.includes(c.basePair) && (c.year ? dualMainSymbol.includes(c.year) : true));

                      return (
                        <div
                          key={`${c.basePair}_${c.year}`}
                          style={{
                            padding: "12px",
                            borderRadius: "8px",
                            backgroundColor: isSelectedPair ? "rgba(99, 102, 241, 0.12)" : "rgba(255,255,255,0.02)",
                            border: `1px solid ${isSelectedPair ? "var(--primary, #6366f1)" : "var(--outline-variant)"}`,
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px"
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <strong style={{ fontSize: "14px", color: "var(--on-surface)" }}>
                                {c.basePair}
                              </strong>
                              {c.year && (
                                <span style={{ fontSize: "11px", padding: "1px 6px", borderRadius: "4px", backgroundColor: "rgba(96, 165, 250, 0.15)", color: "#60a5fa", fontWeight: 600 }}>
                                  {c.year}年
                                </span>
                              )}
                              <span style={{ fontSize: "10.5px", color: hasTwoBrokers ? "#4ade80" : "var(--on-surface-variant)" }}>
                                ({c.brokers.length}社データ)
                              </span>
                            </div>

                            {hasTwoBrokers && (
                              <button
                                type="button"
                                className="pro-btn"
                                onClick={() => handleSetDualPair(c.brokers[0].symbolName, c.brokers[1].symbolName)}
                                style={{ padding: "2px 8px", fontSize: "10.5px", height: "22px", backgroundColor: "rgba(99, 102, 241, 0.2)", borderColor: "var(--primary, #6366f1)", color: "#fff" }}
                              >
                                この2社をセット
                              </button>
                            )}
                          </div>

                          {/* ブローカー一覧 */}
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            {c.brokers.map(b => {
                              const isMain = dualMainSymbol === b.symbolName;
                              const isSub = dualSubSymbol === b.symbolName;

                              return (
                                <div
                                  key={b.symbolName}
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    padding: "5px 8px",
                                    borderRadius: "5px",
                                    backgroundColor: isMain ? "rgba(99, 102, 241, 0.2)" : isSub ? "rgba(168, 199, 250, 0.15)" : "rgba(255,255,255,0.03)",
                                    border: `1px solid ${isMain ? "var(--primary, #6366f1)" : isSub ? "var(--tertiary, #a8c7fa)" : "transparent"}`
                                  }}
                                >
                                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                    <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--on-surface)" }}>
                                      {b.broker}
                                    </span>
                                    <span style={{ fontSize: "10px", color: "var(--on-surface-variant)" }}>
                                      ({b.symbolName})
                                    </span>
                                  </div>

                                  <div style={{ display: "flex", gap: "4px" }}>
                                    <button
                                      type="button"
                                      onClick={() => setDualMainSymbol(b.symbolName)}
                                      style={{
                                        padding: "1px 6px",
                                        fontSize: "10px",
                                        borderRadius: "3px",
                                        border: "1px solid",
                                        cursor: "pointer",
                                        borderColor: isMain ? "var(--primary, #6366f1)" : "var(--outline-variant)",
                                        backgroundColor: isMain ? "var(--primary, #6366f1)" : "transparent",
                                        color: isMain ? "#fff" : "var(--on-surface-variant)"
                                      }}
                                    >
                                      Main
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setDualSubSymbol(b.symbolName)}
                                      style={{
                                        padding: "1px 6px",
                                        fontSize: "10px",
                                        borderRadius: "3px",
                                        border: "1px solid",
                                        cursor: "pointer",
                                        borderColor: isSub ? "var(--tertiary, #a8c7fa)" : "var(--outline-variant)",
                                        backgroundColor: isSub ? "var(--tertiary, #a8c7fa)" : "transparent",
                                        color: isSub ? "#000" : "var(--on-surface-variant)"
                                      }}
                                    >
                                      Sub
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ========================================================= */}
          {/* SINGLE REPLAY MODE UI                                     */}
          {/* ========================================================= */}
          {replayMode === "single" && (
            <>
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
                      <span className="material-symbols-outlined" style={{ fontSize: "15px" }}>account_balance</span>
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
                      <span className="material-symbols-outlined" style={{ fontSize: "15px" }}>show_chart</span>
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
                gridTemplateColumns: "1fr 2fr",
                gap: "12px",
                alignItems: "center"
              }}>
                <div>
                  <span style={{ fontSize: "10.5px", color: "var(--primary, #a8c7fa)", fontWeight: 700, display: "block" }}>
                    主通貨（リプレイ対象）
                  </span>
                  <strong style={{ fontSize: "14px", color: "var(--on-surface)" }}>
                    {selectedSource || "(未選択)"}
                  </strong>
                </div>
                <div>
                  <span style={{ fontSize: "10.5px", color: "var(--tertiary, #a8c7fa)", fontWeight: 700, display: "block" }}>
                    同期他通貨 ({selectedSync.length} 件選択中)
                  </span>
                  <div style={{ fontSize: "12px", color: "var(--on-surface-variant)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {selectedSync.length > 0 ? selectedSync.join(", ") : "同期なし"}
                  </div>
                </div>
              </div>

              {/* 一括同期プリセット操作バー */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
                <span style={{ fontSize: "11px", color: "var(--on-surface-variant)", fontWeight: 600 }}>
                  クイック同期プリセット:
                </span>
                <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                  <button type="button" className="pro-btn" onClick={handleSelectAllJpy} style={{ padding: "2px 8px", fontSize: "10.5px", height: "22px" }}>
                    JPYクロス全選択
                  </button>
                  <button type="button" className="pro-btn" onClick={handleSelectAllUsd} style={{ padding: "2px 8px", fontSize: "10.5px", height: "22px" }}>
                    ドルストレート全選択
                  </button>
                  <button type="button" className="pro-btn" onClick={handleSelectAllInCat} style={{ padding: "2px 8px", fontSize: "10.5px", height: "22px" }}>
                    この年の全銘柄同期
                  </button>
                  <button type="button" className="pro-btn" onClick={handleClearSync} style={{ padding: "2px 8px", fontSize: "10.5px", height: "22px" }}>
                    同期解除
                  </button>
                </div>
              </div>

              {/* シンボルマトリクス一覧 */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "8px" }}>
                {currentCategorySymbols.map(sym => {
                  const isSource = sym.name === selectedSource;
                  const isSync = selectedSync.includes(sym.name);
                  const parsed = parseSymbolName(sym.name);

                  return (
                    <div
                      key={sym.name}
                      style={{
                        padding: "8px 10px",
                        borderRadius: "6px",
                        backgroundColor: isSource ? "rgba(99, 102, 241, 0.2)" : isSync ? "rgba(168, 199, 250, 0.1)" : "rgba(255,255,255,0.02)",
                        border: `1px solid ${isSource ? "var(--primary, #6366f1)" : isSync ? "var(--tertiary, #a8c7fa)" : "var(--outline-variant)"}`,
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <strong style={{ fontSize: "13px", color: isSource ? "var(--primary, #a8c7fa)" : "var(--on-surface)" }}>
                          {parsed.basePair}
                        </strong>
                        {parsed.broker && (
                          <span style={{ fontSize: "10px", padding: "1px 5px", borderRadius: "3px", backgroundColor: "rgba(255,255,255,0.05)", color: "var(--on-surface-variant)" }}>
                            {parsed.broker}
                          </span>
                        )}
                      </div>

                      <div style={{ display: "flex", gap: "4px" }}>
                        <button
                          type="button"
                          onClick={() => handleSetSource(sym.name)}
                          style={{
                            flex: 1,
                            padding: "3px 6px",
                            fontSize: "10.5px",
                            borderRadius: "4px",
                            border: "1px solid",
                            cursor: "pointer",
                            borderColor: isSource ? "var(--primary, #6366f1)" : "var(--outline-variant)",
                            backgroundColor: isSource ? "var(--primary, #6366f1)" : "transparent",
                            color: isSource ? "#fff" : "var(--on-surface-variant)"
                          }}
                        >
                          {isSource ? "★ 主通貨" : "主通貨に設定"}
                        </button>

                        {!isSource && (
                          <button
                            type="button"
                            onClick={() => handleToggleSync(sym.name)}
                            style={{
                              flex: 1,
                              padding: "3px 6px",
                              fontSize: "10.5px",
                              borderRadius: "4px",
                              border: "1px solid",
                              cursor: "pointer",
                              borderColor: isSync ? "var(--tertiary, #a8c7fa)" : "var(--outline-variant)",
                              backgroundColor: isSync ? "rgba(168, 199, 250, 0.2)" : "transparent",
                              color: isSync ? "var(--tertiary, #a8c7fa)" : "var(--on-surface-variant)"
                            }}
                          >
                            {isSync ? "✓ 同期中" : "+ 同期追加"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* 自動期間設定チェックボックス */}
          <div style={{ marginTop: "4px", padding: "8px 12px", backgroundColor: "rgba(0,0,0,0.2)", borderRadius: "6px", border: "1px solid var(--outline-variant)" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", margin: 0, fontSize: "12px", color: "var(--on-surface)" }}>
              <input
                type="checkbox"
                checked={autoApplyDateRange}
                onChange={(e) => setAutoApplyDateRange(e.target.checked)}
                style={{ width: "15px", height: "15px", accentColor: "var(--primary, #6366f1)" }}
              />
              <span>選択した年度の全期間 (YYYY-01-01 〜 YYYY-12-31) をリプレイ日時設定に自動反映する</span>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--outline-variant)",
            backgroundColor: "rgba(0,0,0,0.2)",
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: "10px"
          }}
        >
          <button
            type="button"
            className="pro-btn"
            onClick={onClose}
            style={{ padding: "6px 14px", fontSize: "12px" }}
          >
            キャンセル
          </button>
          <button
            type="button"
            className="pro-btn primary-action"
            onClick={handleApply}
            style={{
              padding: "6px 18px",
              fontSize: "12px",
              fontWeight: 700,
              backgroundColor: "var(--primary, #6366f1)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              borderRadius: "6px"
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>check_circle</span>
            選択内容をリプレイ設定に適用
          </button>
        </div>
      </div>
    </div>
  );
};
