import React, { useState, useEffect, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SymbolItem } from "./SymbolCombobox";
import {
  parseSymbolName,
  groupSymbolsByCategory,
  isJpyPair,
  isUsdStraight,
  getDualFeedCandidates,
  getAllBrokers,
  getAllYears,
  getAllCompanionsForSource,
  switchSymbolSuffix
} from "../utils/symbolUtils";
import { useTheme } from "../hooks/useTheme";

export const SymbolSelectorWindowContent: React.FC = () => {
  useTheme();

  // シンボル一覧
  const [availableSymbols, setAvailableSymbols] = useState<SymbolItem[]>([]);

  // モード: "single" (通常・マルチ通貨同期) | "dual" (デュアルフィード比較)
  const [replayMode, setReplayMode] = useState<"single" | "dual">("single");

  // フィルタ状態
  const [activeCategory, setActiveCategory] = useState<string>("Standard");
  const [selectedYear, setSelectedYear] = useState<string>("ALL");
  const [selectedBroker, setSelectedBroker] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Single モード用
  const [selectedSource, setSelectedSource] = useState<string>("USDJPY");
  const [selectedSync, setSelectedSync] = useState<string[]>([]);

  // Dual モード用
  const [dualMainSymbol, setDualMainSymbol] = useState<string>("USDJPY");
  const [dualSubSymbol, setDualSubSymbol] = useState<string>("");

  // オプション
  const [autoApplyDateRange, setAutoApplyDateRange] = useState<boolean>(true);

  // 初期ロード・メインウィンドウとの同期
  const loadSymbols = useCallback(async () => {
    try {
      // 1. ローカルストレージまたはTauriから現在の設定を取得
      const savedStateStr = localStorage.getItem("symbol-selector-current-state");
      if (savedStateStr) {
        try {
          const parsed = JSON.parse(savedStateStr);
          if (parsed.sourceSymbol) setSelectedSource(parsed.sourceSymbol);
          if (parsed.subSourceSymbol) setDualSubSymbol(parsed.subSourceSymbol);
          if (parsed.sourceSymbol) setDualMainSymbol(parsed.sourceSymbol);
          if (parsed.enableDualFeed !== undefined) setReplayMode(parsed.enableDualFeed ? "dual" : "single");
          if (parsed.additionalSymbols) {
            const syncs = parsed.additionalSymbols.split(",").map((s: string) => s.trim()).filter(Boolean);
            setSelectedSync(syncs);
          }
          if (Array.isArray(parsed.availableSymbols) && parsed.availableSymbols.length > 0) {
            setAvailableSymbols(parsed.availableSymbols);
          }
        } catch (e) {
          console.error("Failed to parse symbol-selector-current-state:", e);
        }
      }

      // 2. MT5から直接シンボル一覧を取得（端末パスがある場合）
      const terminalPath = localStorage.getItem("selected-terminal-path") || "";
      const list = await invoke<SymbolItem[]>("get_available_symbols", { terminalPath });
      if (Array.isArray(list) && list.length > 0) {
        setAvailableSymbols(list);
      }
    } catch (err) {
      console.error("Failed to load symbols in selector window:", err);
    }
  }, []);

  useEffect(() => {
    loadSymbols();

    // メインウィンドウからの初期化・更新イベントを受信
    const unlistenInit = listen<any>("symbol-selector-init", (event) => {
      const data = event.payload;
      if (data.sourceSymbol) {
        setSelectedSource(data.sourceSymbol);
        setDualMainSymbol(data.sourceSymbol);
      }
      if (data.subSourceSymbol !== undefined) setDualSubSymbol(data.subSourceSymbol);
      if (data.enableDualFeed !== undefined) setReplayMode(data.enableDualFeed ? "dual" : "single");
      if (data.additionalSymbols !== undefined) {
        const syncs = data.additionalSymbols ? data.additionalSymbols.split(",").map((s: string) => s.trim()).filter(Boolean) : [];
        setSelectedSync(syncs);
      }
      if (Array.isArray(data.availableSymbols) && data.availableSymbols.length > 0) {
        setAvailableSymbols(data.availableSymbols);
      }
    });

    const unlistenVisible = listen<boolean>("window-visible", (event) => {
      if (event.payload) {
        loadSymbols();
      }
    });

    return () => {
      unlistenInit.then((fn) => fn());
      unlistenVisible.then((fn) => fn());
    };
  }, [loadSymbols]);

  const categoryInfo = useMemo(() => groupSymbolsByCategory(availableSymbols), [availableSymbols]);
  const allYears = useMemo(() => getAllYears(availableSymbols), [availableSymbols]);
  const allBrokers = useMemo(() => getAllBrokers(availableSymbols), [availableSymbols]);
  const dualCandidates = useMemo(() => getDualFeedCandidates(availableSymbols), [availableSymbols]);

  // Dualモード用：Mainシンボルに紐づく同期候補シンボル一覧
  const dualMainCompanions = useMemo(() => {
    return getAllCompanionsForSource(dualMainSymbol, availableSymbols);
  }, [dualMainSymbol, availableSymbols]);

  // アクティブカテゴリの自動初期化
  useEffect(() => {
    if (selectedSource) {
      const parsed = parseSymbolName(selectedSource);
      if (parsed.category && categoryInfo.allCategories.includes(parsed.category)) {
        setActiveCategory(parsed.category);
      } else if (categoryInfo.allCategories.length > 0 && !categoryInfo.allCategories.includes(activeCategory)) {
        setActiveCategory(categoryInfo.allCategories[0]);
      }
    }
  }, [selectedSource, categoryInfo]);

  // --- フィルタリング ---
  const currentCategorySymbols: SymbolItem[] = useMemo(() => {
    const raw = categoryInfo.categories[activeCategory] || [];
    const list: SymbolItem[] = raw.map((item) =>
      typeof item === "string" ? { name: item, source_type: "custom", group_name: activeCategory } : item
    );
    if (!searchQuery.trim()) return list;
    const q = searchQuery.trim().toUpperCase();
    return list.filter((s) => s.name.toUpperCase().includes(q));
  }, [categoryInfo, activeCategory, searchQuery]);

  const filteredDualCandidates = useMemo(() => {
    return dualCandidates.filter((c) => {
      if (selectedYear !== "ALL" && c.year !== selectedYear) return false;
      if (selectedBroker !== "ALL" && !c.brokers.some((b) => b.broker.toUpperCase() === selectedBroker.toUpperCase())) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toUpperCase();
        if (!c.basePair.toUpperCase().includes(q) && !c.year.includes(q)) return false;
      }
      return true;
    });
  }, [dualCandidates, selectedYear, selectedBroker, searchQuery]);

  const isCurrentCategoryYear = /^\d{4}$/.test(activeCategory);

  // カテゴリ切り替え
  const handleSelectCategory = (cat: string) => {
    setActiveCategory(cat);
    const catSymbols = categoryInfo.categories[cat] || [];
    if (catSymbols.length > 0) {
      const currentParsed = parseSymbolName(selectedSource);
      if (currentParsed.category !== cat) {
        const preferred = catSymbols.find((s) => s.name.toUpperCase().includes("USDJPY")) || catSymbols[0];
        setSelectedSource(preferred.name);
        const newSync = catSymbols.filter((s) => s.name !== preferred.name).map((s) => s.name);
        setSelectedSync(newSync);
      }
    }
  };

  // Single: 主通貨設定
  const handleSetSource = (symName: string) => {
    setSelectedSource(symName);
    setSelectedSync((prev) => prev.filter((s) => s !== symName));
  };

  // Single: 同期通貨トグル
  const handleToggleSync = (symName: string) => {
    if (symName === selectedSource) return;
    setSelectedSync((prev) => {
      if (prev.includes(symName)) {
        return prev.filter((s) => s !== symName);
      } else {
        return [...prev, symName];
      }
    });
  };

  // クイックプリセット (Single)
  const handleSelectAllJpy = () => {
    const jpySymbols = currentCategorySymbols
      .filter((s) => isJpyPair(s.name) && s.name !== selectedSource)
      .map((s) => s.name);
    setSelectedSync((prev) => Array.from(new Set([...prev, ...jpySymbols])));
  };

  const handleSelectAllUsd = () => {
    const usdSymbols = currentCategorySymbols
      .filter((s) => isUsdStraight(s.name) && s.name !== selectedSource)
      .map((s) => s.name);
    setSelectedSync((prev) => Array.from(new Set([...prev, ...usdSymbols])));
  };

  const handleSelectAllInCat = () => {
    const allInCat = currentCategorySymbols
      .filter((s) => s.name !== selectedSource)
      .map((s) => s.name);
    setSelectedSync((prev) => Array.from(new Set([...prev, ...allInCat])));
  };

  const handleClearSync = () => {
    const inCatSet = new Set(currentCategorySymbols.map((s) => s.name));
    setSelectedSync((prev) => prev.filter((s) => !inCatSet.has(s)));
  };

  // クイックプリセット (Dual)
  const handleDualSelectAllJpy = () => {
    const jpySymbols = dualMainCompanions
      .filter((s) => isJpyPair(s.name) && s.name !== dualMainSymbol)
      .map((s) => s.name);
    setSelectedSync((prev) => Array.from(new Set([...prev, ...jpySymbols])));
  };

  const handleDualSelectAllUsd = () => {
    const usdSymbols = dualMainCompanions
      .filter((s) => isUsdStraight(s.name) && s.name !== dualMainSymbol)
      .map((s) => s.name);
    setSelectedSync((prev) => Array.from(new Set([...prev, ...usdSymbols])));
  };

  const handleDualSelectAllInCat = () => {
    const allInCat = dualMainCompanions
      .filter((s) => s.name !== dualMainSymbol)
      .map((s) => s.name);
    setSelectedSync((prev) => Array.from(new Set([...prev, ...allInCat])));
  };

  const handleDualClearSync = () => {
    setSelectedSync([]);
  };

  const handleToggleSyncSymbol = (symName: string) => {
    if (symName === dualMainSymbol) return;
    setSelectedSync((prev) => {
      if (prev.includes(symName)) {
        return prev.filter((s) => s !== symName);
      } else {
        return [...prev, symName];
      }
    });
  };

  const handleRemoveSyncSymbol = (symName: string) => {
    setSelectedSync((prev) => prev.filter((s) => s !== symName));
  };

  // Dual: ペア・ブローカー選択
  const handleSetDualPair = (mainSym: string, subSym: string) => {
    const prevParsed = parseSymbolName(dualMainSymbol);
    const nextParsed = parseSymbolName(mainSym);
    if (prevParsed.suffix && nextParsed.suffix && prevParsed.suffix !== nextParsed.suffix) {
      setSelectedSync((prev) => switchSymbolSuffix(prev, prevParsed.suffix, nextParsed.suffix, availableSymbols));
    }
    setDualMainSymbol(mainSym);
    setDualSubSymbol(subSym);
  };

  const handleSetDualMainSymbol = (newMainSym: string) => {
    const prevParsed = parseSymbolName(dualMainSymbol);
    const nextParsed = parseSymbolName(newMainSym);
    if (prevParsed.suffix && nextParsed.suffix && prevParsed.suffix !== nextParsed.suffix) {
      setSelectedSync((prev) => switchSymbolSuffix(prev, prevParsed.suffix, nextParsed.suffix, availableSymbols));
    }
    setDualMainSymbol(newMainSym);
  };

  const handleSwapDual = () => {
    const temp = dualMainSymbol;
    const prevParsed = parseSymbolName(dualMainSymbol);
    const nextParsed = parseSymbolName(dualSubSymbol);
    if (prevParsed.suffix && nextParsed.suffix && prevParsed.suffix !== nextParsed.suffix) {
      setSelectedSync((prev) => switchSymbolSuffix(prev, prevParsed.suffix, nextParsed.suffix, availableSymbols));
    }
    setDualMainSymbol(dualSubSymbol);
    setDualSubSymbol(temp);
  };

  // ウィンドウを閉じる
  const handleClose = async () => {
    try {
      await invoke("close_symbol_selector_window");
    } catch {
      try {
        await getCurrentWindow().hide();
      } catch (e) {
        console.error("Failed to hide window:", e);
      }
    }
  };

  // 適用
  const handleApply = async () => {
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

    const payload = {
      sourceSymbol: src,
      subSourceSymbol: sub,
      enableDualFeed: isDual,
      syncSymbols: selectedSync,
      dateRange
    };

    // メインウィンドウへ適用イベント送信
    try {
      await emit("apply-symbol-selection", payload);
    } catch (e) {
      console.error("Failed to emit apply-symbol-selection:", e);
    }

    // ローカルストレージに最新状態をキャッシュ
    try {
      localStorage.setItem("symbol-selector-current-state", JSON.stringify({
        sourceSymbol: src,
        subSourceSymbol: sub,
        enableDualFeed: isDual,
        additionalSymbols: selectedSync.join(","),
        availableSymbols
      }));
    } catch (e) {
      console.error("Failed to cache symbol selector state:", e);
    }

    await handleClose();
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        backgroundColor: "var(--bg-color)",
        color: "var(--on-surface)",
        fontFamily: "var(--font-ui, sans-serif)",
        userSelect: "none",
        overflow: "hidden"
      }}
    >
      {/* 1. ミニマルヘッダー */}
      <header
        data-tauri-drag-region
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 14px",
          backgroundColor: "var(--surface-obsidian)",
          borderBottom: "1px solid var(--outline-variant)",
          flexShrink: 0
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }} data-tauri-drag-region>
          <span className="material-symbols-outlined icon-accent" style={{ fontSize: "18px", color: "var(--primary-color)" }} data-tauri-drag-region>
            tune
          </span>
          <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--on-surface)" }} data-tauri-drag-region>
            シンボル選択セレクター
          </span>
        </div>
        <button
          type="button"
          className="settings-close-btn"
          onClick={handleClose}
          title="閉じる"
          style={{ padding: "3px 6px", background: "none", border: "none", color: "var(--on-surface-variant)", cursor: "pointer" }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>close</span>
        </button>
      </header>

      {/* 2. コントロールバー（モード切替 & 検索 & フィルタ） */}
      <div
        style={{
          padding: "8px 14px",
          backgroundColor: "var(--surface-charcoal)",
          borderBottom: "1px solid var(--outline-variant)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "10px",
          flexWrap: "wrap",
          flexShrink: 0
        }}
      >
        {/* モード切替（セグメントボタン） */}
        <div style={{ display: "flex", backgroundColor: "var(--surface-variant)", borderRadius: "5px", padding: "2px", border: "1px solid var(--outline-variant)" }}>
          <button
            type="button"
            onClick={() => setReplayMode("single")}
            style={{
              padding: "4px 10px",
              fontSize: "11px",
              fontWeight: replayMode === "single" ? 600 : 400,
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              backgroundColor: replayMode === "single" ? "var(--primary-color)" : "transparent",
              color: replayMode === "single" ? "var(--on-primary, #fff)" : "var(--on-surface-variant)",
              display: "flex",
              alignItems: "center",
              gap: "4px"
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>show_chart</span>
            通常リプレイ (単一 ＆ 同期)
          </button>
          <button
            type="button"
            onClick={() => setReplayMode("dual")}
            style={{
              padding: "4px 10px",
              fontSize: "11px",
              fontWeight: replayMode === "dual" ? 600 : 400,
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              backgroundColor: replayMode === "dual" ? "var(--primary-color)" : "transparent",
              color: replayMode === "dual" ? "var(--on-primary, #fff)" : "var(--on-surface-variant)",
              display: "flex",
              alignItems: "center",
              gap: "4px"
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>compare_arrows</span>
            デュアルフィード比較 (2社)
          </button>
        </div>

        {/* 検索バー */}
        <div style={{ position: "relative", width: "180px" }}>
          <input
            type="text"
            className="pro-input"
            placeholder="銘柄・通貨検索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              height: "26px",
              fontSize: "11px",
              paddingLeft: "24px",
              paddingRight: searchQuery ? "22px" : "8px",
              boxSizing: "border-box"
            }}
          />
          <span
            className="material-symbols-outlined"
            style={{
              position: "absolute",
              left: "6px",
              top: "5px",
              fontSize: "15px",
              color: "var(--on-surface-variant)",
              pointerEvents: "none"
            }}
          >
            search
          </span>
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              style={{
                position: "absolute",
                right: "4px",
                top: "4px",
                background: "none",
                border: "none",
                color: "var(--on-surface-variant)",
                cursor: "pointer",
                padding: "2px"
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>close</span>
            </button>
          )}
        </div>
      </div>

      {/* 3. メインコンテンツエリア */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>
        {replayMode === "single" ? (
          /* ======================================================== */
          /* SINGLE MODE                                              */
          /* ======================================================== */
          <>
            {/* カテゴリ / 年別ピルバー */}
            <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: "11px", color: "var(--on-surface-variant)", marginRight: "4px", fontWeight: 600 }}>分類:</span>
              {categoryInfo.years.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => handleSelectCategory(y)}
                  style={{
                    padding: "3px 8px",
                    fontSize: "11px",
                    borderRadius: "4px",
                    border: `1px solid ${activeCategory === y ? "var(--primary-color)" : "var(--outline-variant)"}`,
                    backgroundColor: activeCategory === y ? "rgba(var(--primary-rgb), 0.15)" : "var(--btn-default-bg)",
                    color: activeCategory === y ? "var(--primary-color)" : "var(--btn-default-color)",
                    cursor: "pointer",
                    fontWeight: activeCategory === y ? 700 : "normal"
                  }}
                >
                  📅 {y}年
                </button>
              ))}
              {categoryInfo.tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleSelectCategory(t)}
                  style={{
                    padding: "3px 8px",
                    fontSize: "11px",
                    borderRadius: "4px",
                    border: `1px solid ${activeCategory === t ? "var(--tertiary)" : "var(--outline-variant)"}`,
                    backgroundColor: activeCategory === t ? "rgba(var(--tertiary-rgb, var(--primary-rgb)), 0.15)" : "var(--btn-default-bg)",
                    color: activeCategory === t ? "var(--tertiary)" : "var(--btn-default-color)",
                    cursor: "pointer",
                    fontWeight: activeCategory === t ? 700 : "normal"
                  }}
                >
                  🏷️ {t}
                </button>
              ))}
              {categoryInfo.hasStandard && (
                <button
                  type="button"
                  onClick={() => handleSelectCategory("Standard")}
                  style={{
                    padding: "3px 8px",
                    fontSize: "11px",
                    borderRadius: "4px",
                    border: `1px solid ${activeCategory === "Standard" ? "var(--secondary-color)" : "var(--outline-variant)"}`,
                    backgroundColor: activeCategory === "Standard" ? "rgba(var(--secondary-rgb, var(--primary-rgb)), 0.15)" : "var(--btn-default-bg)",
                    color: activeCategory === "Standard" ? "var(--secondary-color)" : "var(--btn-default-color)",
                    cursor: "pointer",
                    fontWeight: activeCategory === "Standard" ? 700 : "normal"
                  }}
                >
                  🏛️ 通常銘柄
                </button>
              )}
            </div>

            {/* 選択サマリー ＆ クイック操作バー */}
            <div
              style={{
                padding: "8px 12px",
                borderRadius: "6px",
                backgroundColor: "var(--surface-charcoal)",
                border: "1px solid var(--outline-variant)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "10px",
                flexWrap: "wrap"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "11.5px" }}>
                <div>
                  <span style={{ color: "var(--on-surface-variant)", marginRight: "6px" }}>主通貨:</span>
                  <strong style={{ color: "var(--primary-color)", fontSize: "12.5px" }}>
                    {selectedSource || "(未選択)"}
                  </strong>
                </div>
                <div style={{ borderLeft: "1px solid var(--outline-variant)", paddingLeft: "12px" }}>
                  <span style={{ color: "var(--on-surface-variant)", marginRight: "6px" }}>
                    同期 ({selectedSync.length}件):
                  </span>
                  <span style={{ color: "var(--on-surface)", fontSize: "11px" }}>
                    {selectedSync.length > 0 ? selectedSync.slice(0, 4).join(", ") + (selectedSync.length > 4 ? ` 他${selectedSync.length - 4}件` : "") : "なし"}
                  </span>
                </div>
              </div>

              {/* クイック同期プリセットボタン */}
              <div style={{ display: "flex", gap: "4px" }}>
                <button
                  type="button"
                  className="pro-btn"
                  onClick={handleSelectAllJpy}
                  style={{ padding: "2px 6px", fontSize: "10px", height: "22px" }}
                  title="JPYクロス通貨ペアを一括同期"
                >
                  JPYクロス
                </button>
                <button
                  type="button"
                  className="pro-btn"
                  onClick={handleSelectAllUsd}
                  style={{ padding: "2px 6px", fontSize: "10px", height: "22px" }}
                  title="ドルストレート通貨ペアを一括同期"
                >
                  ドルストレート
                </button>
                <button
                  type="button"
                  className="pro-btn"
                  onClick={handleSelectAllInCat}
                  style={{ padding: "2px 6px", fontSize: "10px", height: "22px" }}
                  title="この分類の全銘柄を一括同期"
                >
                  全同期
                </button>
                <button
                  type="button"
                  className="pro-btn"
                  onClick={handleClearSync}
                  style={{ padding: "2px 6px", fontSize: "10px", height: "22px" }}
                  title="同期選択をすべて解除"
                >
                  同期解除
                </button>
              </div>
            </div>

            {/* シンボル一覧コンパクトグリッド */}
            {currentCategorySymbols.length === 0 ? (
              <div style={{ padding: "24px", textAlign: "center", color: "var(--on-surface-variant)", fontSize: "11.5px" }}>
                該当するシンボルがありません
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "6px" }}>
                {currentCategorySymbols.map((sym) => {
                  const isSource = sym.name === selectedSource;
                  const isSync = selectedSync.includes(sym.name);
                  const parsed = parseSymbolName(sym.name);

                  return (
                    <div
                      key={sym.name}
                      style={{
                        padding: "6px 8px",
                        borderRadius: "5px",
                        backgroundColor: isSource
                          ? "rgba(var(--primary-rgb), 0.16)"
                          : isSync
                          ? "rgba(var(--secondary-rgb, var(--primary-rgb)), 0.14)"
                          : "var(--surface-charcoal)",
                        border: `1px solid ${
                          isSource
                            ? "var(--primary-color)"
                            : isSync
                            ? "var(--secondary-color)"
                            : "var(--outline-variant)"
                        }`,
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span
                          style={{
                            fontSize: "12px",
                            fontWeight: isSource || isSync ? 700 : 600,
                            color: isSource
                              ? "var(--primary-color)"
                              : isSync
                              ? "var(--secondary-color)"
                              : "var(--on-surface)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap"
                          }}
                          title={sym.name}
                        >
                          {parsed.basePair}
                        </span>
                        {parsed.broker && (
                          <span style={{ fontSize: "9px", color: "var(--on-surface-variant)", opacity: 0.85 }}>
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
                            padding: "2px 4px",
                            fontSize: "10px",
                            fontWeight: 600,
                            borderRadius: "3px",
                            border: "1px solid",
                            cursor: "pointer",
                            borderColor: isSource ? "var(--primary-color)" : "var(--outline-variant)",
                            backgroundColor: isSource ? "var(--primary-color)" : "var(--btn-default-bg)",
                            color: isSource ? "var(--on-primary, #fff)" : "var(--on-surface-variant)"
                          }}
                        >
                          {isSource ? "★ 主通貨" : "主通貨"}
                        </button>

                        {!isSource && (
                          <button
                            type="button"
                            onClick={() => handleToggleSync(sym.name)}
                            style={{
                              flex: 1,
                              padding: "2px 4px",
                              fontSize: "10px",
                              fontWeight: 600,
                              borderRadius: "3px",
                              border: "1px solid",
                              cursor: "pointer",
                              borderColor: isSync ? "var(--secondary-color)" : "var(--outline-variant)",
                              backgroundColor: isSync ? "var(--secondary-color)" : "var(--btn-default-bg)",
                              color: isSync ? "var(--on-primary, #fff)" : "var(--on-surface-variant)"
                            }}
                          >
                            {isSync ? "✓ 同期中" : "+ 同期"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          /* ======================================================== */
          /* DUAL FEED MODE                                           */
          /* ======================================================== */
          <>
            {/* 1. 現在の比較スロット */}
            <div
              style={{
                padding: "8px 12px",
                borderRadius: "6px",
                backgroundColor: "var(--surface-charcoal)",
                border: "1px solid var(--outline-variant)",
                display: "grid",
                gridTemplateColumns: "1fr auto 1fr",
                gap: "10px",
                alignItems: "center"
              }}
            >
              {/* Main Card */}
              <div style={{ padding: "6px 10px", borderRadius: "4px", backgroundColor: "var(--surface-variant)", border: "1px solid var(--primary-color)" }}>
                <div style={{ fontSize: "9.5px", color: "var(--primary-color)", fontWeight: 700 }}>
                  MAIN (メインチャート)
                </div>
                <div style={{ fontSize: "12px", fontWeight: 700, marginTop: "2px", color: "var(--on-surface)" }}>
                  {dualMainSymbol || "(未選択)"}
                </div>
                {dualMainSymbol && (
                  <div style={{ fontSize: "9.5px", color: "var(--on-surface-variant)", marginTop: "2px" }}>
                    業者: {parseSymbolName(dualMainSymbol).broker || "通常"} | 年: {parseSymbolName(dualMainSymbol).year || "全期"}
                  </div>
                )}
              </div>

              {/* Swap Button */}
              <button
                type="button"
                className="pro-btn"
                onClick={handleSwapDual}
                title="MainとSubを入れ替え"
                style={{ padding: "4px 8px", fontSize: "10.5px", height: "26px", display: "flex", alignItems: "center", gap: "2px" }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>swap_horiz</span>
                入替
              </button>

              {/* Sub Card */}
              <div style={{ padding: "6px 10px", borderRadius: "4px", backgroundColor: "var(--surface-variant)", border: "1px solid var(--secondary-color)" }}>
                <div style={{ fontSize: "9.5px", color: "var(--secondary-color)", fontWeight: 700 }}>
                  SUB (マーカーチャート)
                </div>
                <div style={{ fontSize: "12px", fontWeight: 700, marginTop: "2px", color: "var(--on-surface)" }}>
                  {dualSubSymbol || "(未選択)"}
                </div>
                {dualSubSymbol && (
                  <div style={{ fontSize: "9.5px", color: "var(--on-surface-variant)", marginTop: "2px" }}>
                    業者: {parseSymbolName(dualSubSymbol).broker || "通常"} | 年: {parseSymbolName(dualSubSymbol).year || "全期"}
                  </div>
                )}
              </div>
            </div>

            {/* 2. 同期他通貨 (マルチ通貨同期) 管理セクション */}
            <div
              style={{
                padding: "8px 12px",
                borderRadius: "6px",
                backgroundColor: "var(--surface-charcoal)",
                border: "1px solid var(--outline-variant)",
                display: "flex",
                flexDirection: "column",
                gap: "8px"
              }}
            >
              {/* ヘッダー & クイックプリセット */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--tertiary, var(--primary-color))" }}>
                    同期他通貨 (マルチ通貨同期)
                  </span>
                  <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "10px", backgroundColor: selectedSync.length > 0 ? "rgba(var(--tertiary-rgb, var(--primary-rgb)), 0.2)" : "var(--surface-variant)", color: selectedSync.length > 0 ? "var(--tertiary, var(--primary-color))" : "var(--on-surface-variant)", fontWeight: 700 }}>
                    {selectedSync.length} 件選択中
                  </span>
                </div>

                <div style={{ display: "flex", gap: "4px" }}>
                  <button
                    type="button"
                    className="pro-btn"
                    onClick={handleDualSelectAllJpy}
                    style={{ padding: "2px 6px", fontSize: "10px", height: "22px" }}
                    title="Main業者のJPYクロス通貨ペアを一括同期"
                  >
                    JPYクロス
                  </button>
                  <button
                    type="button"
                    className="pro-btn"
                    onClick={handleDualSelectAllUsd}
                    style={{ padding: "2px 6px", fontSize: "10px", height: "22px" }}
                    title="Main業者のドルストレート通貨ペアを一括同期"
                  >
                    ドルストレート
                  </button>
                  <button
                    type="button"
                    className="pro-btn"
                    onClick={handleDualSelectAllInCat}
                    style={{ padding: "2px 6px", fontSize: "10px", height: "22px" }}
                    title="Main業者の全通貨ペアを一括同期"
                  >
                    全同期
                  </button>
                  <button
                    type="button"
                    className="pro-btn"
                    onClick={handleDualClearSync}
                    style={{ padding: "2px 6px", fontSize: "10px", height: "22px" }}
                    title="同期選択をすべて解除"
                  >
                    同期解除
                  </button>
                </div>
              </div>

              {/* 選択中同期通貨のチップ一覧 */}
              {selectedSync.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", alignItems: "center" }}>
                  <span style={{ fontSize: "10px", color: "var(--on-surface-variant)", marginRight: "2px" }}>選択中:</span>
                  {selectedSync.map((sym) => {
                    const parsed = parseSymbolName(sym);
                    return (
                      <span
                        key={sym}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          padding: "1px 6px",
                          borderRadius: "4px",
                          fontSize: "10.5px",
                          fontWeight: 600,
                          backgroundColor: "rgba(var(--secondary-rgb, var(--primary-rgb)), 0.18)",
                          color: "var(--secondary-color, var(--primary-color))",
                          border: "1px solid var(--secondary-color, var(--primary-color))"
                        }}
                        title={sym}
                      >
                        {parsed.basePair} {parsed.broker ? `(${parsed.broker})` : ""}
                        <button
                          type="button"
                          onClick={() => handleRemoveSyncSymbol(sym)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "inherit",
                            cursor: "pointer",
                            padding: 0,
                            display: "flex",
                            alignItems: "center"
                          }}
                          title="削除"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>close</span>
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Main業者の同期可能通貨クイック追加チップ */}
              {dualMainCompanions.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <span style={{ fontSize: "10px", color: "var(--on-surface-variant)" }}>
                    Main業者 ({parseSymbolName(dualMainSymbol).broker || "通常"} {parseSymbolName(dualMainSymbol).year ? `${parseSymbolName(dualMainSymbol).year}年` : ""}) の同期可能通貨:
                  </span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                    {dualMainCompanions.map((comp) => {
                      const isSelected = selectedSync.includes(comp.name);
                      const parsed = parseSymbolName(comp.name);
                      return (
                        <button
                          key={comp.name}
                          type="button"
                          onClick={() => handleToggleSyncSymbol(comp.name)}
                          style={{
                            padding: "2px 6px",
                            fontSize: "10px",
                            fontWeight: isSelected ? 700 : 500,
                            borderRadius: "3px",
                            border: `1px solid ${isSelected ? "var(--secondary-color, var(--primary-color))" : "var(--outline-variant)"}`,
                            backgroundColor: isSelected ? "var(--secondary-color, var(--primary-color))" : "var(--btn-default-bg)",
                            color: isSelected ? "var(--on-primary, #fff)" : "var(--on-surface)",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "2px",
                            transition: "var(--transition-fast)"
                          }}
                          title={`${comp.name} を同期に追加 / 解除`}
                        >
                          <span>{isSelected ? "✓" : "+"}</span>
                          <span>{parsed.basePair}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: "10.5px", color: "var(--on-surface-variant)" }}>
                  Mainシンボルに紐づく他通貨候補が検出されませんでした。通常リプレイタブまたは設定パネルから直接入力も可能です。
                </div>
              )}
            </div>

            {/* 3. 年度・業者フィルタ */}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ fontSize: "10.5px", color: "var(--on-surface-variant)" }}>年度:</span>
                <button
                  type="button"
                  onClick={() => setSelectedYear("ALL")}
                  style={{
                    padding: "2px 6px",
                    fontSize: "10.5px",
                    borderRadius: "3px",
                    border: `1px solid ${selectedYear === "ALL" ? "var(--primary-color)" : "var(--outline-variant)"}`,
                    backgroundColor: selectedYear === "ALL" ? "rgba(var(--primary-rgb), 0.15)" : "var(--btn-default-bg)",
                    color: selectedYear === "ALL" ? "var(--primary-color)" : "var(--btn-default-color)",
                    cursor: "pointer",
                    fontWeight: selectedYear === "ALL" ? 700 : "normal"
                  }}
                >
                  全年度
                </button>
                {allYears.map((y) => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => setSelectedYear(y)}
                    style={{
                      padding: "2px 6px",
                      fontSize: "10.5px",
                      borderRadius: "3px",
                      border: `1px solid ${selectedYear === y ? "var(--primary-color)" : "var(--outline-variant)"}`,
                      backgroundColor: selectedYear === y ? "rgba(var(--primary-rgb), 0.15)" : "var(--btn-default-bg)",
                      color: selectedYear === y ? "var(--primary-color)" : "var(--btn-default-color)",
                      cursor: "pointer",
                      fontWeight: selectedYear === y ? 700 : "normal"
                    }}
                  >
                    {y}年
                  </button>
                ))}
              </div>

              {allBrokers.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ fontSize: "10.5px", color: "var(--on-surface-variant)" }}>業者:</span>
                  <button
                    type="button"
                    onClick={() => setSelectedBroker("ALL")}
                    style={{
                      padding: "2px 6px",
                      fontSize: "10.5px",
                      borderRadius: "3px",
                      border: `1px solid ${selectedBroker === "ALL" ? "var(--primary-color)" : "var(--outline-variant)"}`,
                      backgroundColor: selectedBroker === "ALL" ? "rgba(var(--primary-rgb), 0.15)" : "var(--btn-default-bg)",
                      color: selectedBroker === "ALL" ? "var(--primary-color)" : "var(--btn-default-color)",
                      cursor: "pointer",
                      fontWeight: selectedBroker === "ALL" ? 700 : "normal"
                    }}
                  >
                    全業者
                  </button>
                  {allBrokers.map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setSelectedBroker(b)}
                      style={{
                        padding: "2px 6px",
                        fontSize: "10.5px",
                        borderRadius: "3px",
                        border: `1px solid ${selectedBroker === b ? "var(--primary-color)" : "var(--outline-variant)"}`,
                        backgroundColor: selectedBroker === b ? "rgba(var(--primary-rgb), 0.15)" : "var(--btn-default-bg)",
                        color: selectedBroker === b ? "var(--primary-color)" : "var(--btn-default-color)",
                        cursor: "pointer",
                        fontWeight: selectedBroker === b ? 700 : "normal"
                      }}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 4. 比較ペア候補コンパクトリスト */}
            {filteredDualCandidates.length === 0 ? (
              <div style={{ padding: "24px", textAlign: "center", color: "var(--on-surface-variant)", fontSize: "11.5px" }}>
                該当する比較ペアがありません
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "6px" }}>
                {filteredDualCandidates.map((c) => {
                  const hasTwo = c.brokers.length >= 2;
                  const isSelected = dualMainSymbol.includes(c.basePair);

                  return (
                    <div
                      key={`${c.basePair}_${c.year}`}
                      style={{
                        padding: "8px",
                        borderRadius: "5px",
                        backgroundColor: isSelected ? "rgba(var(--primary-rgb), 0.12)" : "var(--surface-charcoal)",
                        border: `1px solid ${isSelected ? "var(--primary-color)" : "var(--outline-variant)"}`,
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                          <strong style={{ fontSize: "12.5px", color: "var(--on-surface)" }}>{c.basePair}</strong>
                          {c.year && (
                            <span style={{ fontSize: "10px", color: "var(--on-surface-variant)" }}>({c.year}年)</span>
                          )}
                        </div>
                        {hasTwo && (
                          <button
                            type="button"
                            className="pro-btn"
                            onClick={() => handleSetDualPair(c.brokers[0].symbolName, c.brokers[1].symbolName)}
                            style={{ padding: "1px 6px", fontSize: "10px", height: "20px" }}
                          >
                            2社セット
                          </button>
                        )}
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                        {c.brokers.map((b) => {
                          const isMain = dualMainSymbol === b.symbolName;
                          const isSub = dualSubSymbol === b.symbolName;

                          return (
                            <div
                              key={b.symbolName}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                padding: "3px 6px",
                                borderRadius: "3px",
                                backgroundColor: isMain
                                  ? "rgba(var(--primary-rgb), 0.18)"
                                  : isSub
                                  ? "rgba(var(--secondary-rgb, var(--primary-rgb)), 0.16)"
                                  : "var(--surface-variant)"
                              }}
                            >
                              <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--on-surface)" }}>{b.broker}</span>
                              <div style={{ display: "flex", gap: "2px" }}>
                                <button
                                  type="button"
                                  onClick={() => handleSetDualMainSymbol(b.symbolName)}
                                  style={{
                                    padding: "1px 5px",
                                    fontSize: "9.5px",
                                    fontWeight: 600,
                                    borderRadius: "2px",
                                    border: "1px solid",
                                    cursor: "pointer",
                                    borderColor: isMain ? "var(--primary-color)" : "var(--outline-variant)",
                                    backgroundColor: isMain ? "var(--primary-color)" : "var(--btn-default-bg)",
                                    color: isMain ? "var(--on-primary, #fff)" : "var(--on-surface-variant)"
                                  }}
                                >
                                  Main
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDualSubSymbol(b.symbolName)}
                                  style={{
                                    padding: "1px 5px",
                                    fontSize: "9.5px",
                                    fontWeight: 600,
                                    borderRadius: "2px",
                                    border: "1px solid",
                                    cursor: "pointer",
                                    borderColor: isSub ? "var(--secondary-color)" : "var(--outline-variant)",
                                    backgroundColor: isSub ? "var(--secondary-color)" : "var(--btn-default-bg)",
                                    color: isSub ? "var(--on-primary, #fff)" : "var(--on-surface-variant)"
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
          </>
        )}
      </div>

      {/* 4. フッター（期間設定 ＆ 適用・キャンセル） */}
      <footer
        style={{
          padding: "8px 14px",
          backgroundColor: "var(--surface-obsidian)",
          borderTop: "1px solid var(--outline-variant)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "11px", color: "var(--on-surface-variant)" }}>
          <input
            type="checkbox"
            checked={autoApplyDateRange}
            onChange={(e) => setAutoApplyDateRange(e.target.checked)}
            style={{ width: "13px", height: "13px", accentColor: "var(--primary-color)" }}
          />
          <span>選択した年度の全期間 (01/01〜12/31) をリプレイ日時に自動反映</span>
        </label>

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            className="pro-btn"
            onClick={handleClose}
            style={{ padding: "4px 12px", fontSize: "11px" }}
          >
            キャンセル
          </button>
          <button
            type="button"
            className="pro-btn primary"
            onClick={handleApply}
            style={{
              padding: "4px 16px",
              fontSize: "11px",
              fontWeight: 600,
              backgroundColor: "var(--primary-color)",
              color: "var(--on-primary, #fff)",
              display: "flex",
              alignItems: "center",
              gap: "4px"
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "15px" }}>check</span>
            リプレイ設定に適用
          </button>
        </div>
      </footer>
    </div>
  );
};
