import { useState, useEffect, useCallback } from "react";
import { THEME_LIST, ThemeType, ThemeConfig } from "../constants/themePresets";
import { listen } from "@tauri-apps/api/event";

const THEME_STORAGE_KEY = "tickreplay_theme";
const VALID_THEMES: ThemeType[] = ["dark", "dim", "light", "sepia", "warm-sepia"];

function getInitialTheme(): ThemeType {
  try {
    const saved = (localStorage.getItem(THEME_STORAGE_KEY) ||
      localStorage.getItem("theme") ||
      localStorage.getItem("theme-mode") ||
      "dark") as ThemeType;
    if (VALID_THEMES.includes(saved)) {
      return saved;
    }
  } catch (e) {
    console.warn("Failed to read theme from localStorage:", e);
  }
  return "dark";
}

function applyThemeToDocument(theme: ThemeType) {
  if (typeof document === "undefined") return;

  const validTheme = VALID_THEMES.includes(theme) ? theme : "dark";
  const config: ThemeConfig = THEME_LIST.find((t) => t.id === validTheme) || THEME_LIST[0];

  document.documentElement.setAttribute("data-theme", validTheme);
  if (document.body) {
    document.body.setAttribute("data-theme", validTheme);
  }

  // カラー変数の動的更新
  document.documentElement.style.setProperty("--primary-color", config.accentHex);
  
  // RGB hex to rgb helper
  const hex = config.accentHex.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16) || 99;
  const g = parseInt(hex.substring(2, 4), 16) || 102;
  const b = parseInt(hex.substring(4, 6), 16) || 241;
  document.documentElement.style.setProperty("--primary-rgb", `${r}, ${g}, ${b}`);
  document.documentElement.style.setProperty("--bg-color", config.bgHex);

  // テーマごとのコントラスト調整
  if (validTheme === "light") {
    document.documentElement.style.setProperty("--primary-hover", "#4338ca");
    document.documentElement.style.setProperty("--on-primary", "#ffffff");
    document.documentElement.style.setProperty("--primary-light", "#6366f1");
    document.documentElement.style.setProperty("--primary-border", "#4f46e5");
  } else if (validTheme === "dim") {
    document.documentElement.style.setProperty("--primary-hover", "#6366f1");
    document.documentElement.style.setProperty("--on-primary", "#ffffff");
    document.documentElement.style.setProperty("--primary-light", "#a5b4fc");
    document.documentElement.style.setProperty("--primary-border", "#818cf8");
  } else if (validTheme === "sepia") {
    document.documentElement.style.setProperty("--primary-hover", "#b45309");
    document.documentElement.style.setProperty("--on-primary", "#ffffff");
    document.documentElement.style.setProperty("--primary-light", "#f59e0b");
    document.documentElement.style.setProperty("--primary-border", "#d97706");
  } else if (validTheme === "warm-sepia") {
    document.documentElement.style.setProperty("--primary-hover", "#6d3305");
    document.documentElement.style.setProperty("--on-primary", "#ffffff");
    document.documentElement.style.setProperty("--primary-light", "#a1500d");
    document.documentElement.style.setProperty("--primary-border", "#8a4208");
  } else {
    // dark
    document.documentElement.style.setProperty("--primary-hover", "#4f46e5");
    document.documentElement.style.setProperty("--on-primary", "#ffffff");
    document.documentElement.style.setProperty("--primary-light", "#818cf8");
    document.documentElement.style.setProperty("--primary-border", "#6366f1");
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeType>(getInitialTheme);
  const [plColorStyle, setPlColorStyle] = useState<"red-blue" | "green-red">(() => {
    return (localStorage.getItem("pl-color-style") as "red-blue" | "green-red") || "red-blue";
  });
  const [orderColorStyle, setOrderColorStyle] = useState<"blue-red" | "red-green">(() => {
    const saved = localStorage.getItem("speed-order-color-style");
    if (saved === "red-primary") return "red-green";
    return (saved as "blue-red" | "red-green") || "blue-red";
  });

  const setTheme = useCallback((newTheme: ThemeType) => {
    if (!VALID_THEMES.includes(newTheme)) return;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, newTheme);
      localStorage.setItem("theme", newTheme);
      localStorage.setItem("theme-mode", newTheme);
    } catch (e) {
      console.warn("Failed to save theme to localStorage:", e);
    }
    applyThemeToDocument(newTheme);
    setThemeState(newTheme);
  }, []);

  const cycleTheme = useCallback(() => {
    setThemeState((current) => {
      const currentTheme = VALID_THEMES.includes(current) ? current : "dark";
      const nextIdx = (VALID_THEMES.indexOf(currentTheme) + 1) % VALID_THEMES.length;
      const nextTheme = VALID_THEMES[nextIdx];
      try {
        localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        localStorage.setItem("theme", nextTheme);
        localStorage.setItem("theme-mode", nextTheme);
      } catch (e) {}
      applyThemeToDocument(nextTheme);
      return nextTheme;
    });
  }, []);

  // 初期ロードおよびテーマ変更エフェクト
  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  // 損益配色適用エフェクト
  useEffect(() => {
    document.documentElement.setAttribute("data-pl-style", plColorStyle);
    localStorage.setItem("pl-color-style", plColorStyle);
  }, [plColorStyle]);

  // 発注カラー配色適用エフェクト
  useEffect(() => {
    document.documentElement.setAttribute("data-order-color-style", orderColorStyle);
    localStorage.setItem("speed-order-color-style", orderColorStyle);
  }, [orderColorStyle]);

  // 他ウィンドウからの設定変更（Tauriイベント & storageイベント）を監視
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (
        (e.key === THEME_STORAGE_KEY || e.key === "theme" || e.key === "theme-mode") &&
        e.newValue &&
        VALID_THEMES.includes(e.newValue as ThemeType)
      ) {
        const newTheme = e.newValue as ThemeType;
        applyThemeToDocument(newTheme);
        setThemeState(newTheme);
      }
      if (e.key === "pl-color-style" && e.newValue) {
        setPlColorStyle(e.newValue as "red-blue" | "green-red");
      }
      if (e.key === "speed-order-color-style" && e.newValue) {
        setOrderColorStyle(e.newValue as "blue-red" | "red-green");
      }
    };

    window.addEventListener("storage", handleStorage);

    let unlistenTauri: (() => void) | undefined;
    listen<any>("settings-updated", (event) => {
      if (event.payload) {
        const { theme: updatedTheme, themeMode, themeId, plColorStyle: updatedPl, orderColorStyle: updatedOrder } = event.payload;
        const candidate = updatedTheme || themeMode || themeId;
        if (candidate && VALID_THEMES.includes(candidate as ThemeType)) {
          applyThemeToDocument(candidate as ThemeType);
          setThemeState(candidate as ThemeType);
        }
        if (updatedPl) setPlColorStyle(updatedPl);
        if (updatedOrder) setOrderColorStyle(updatedOrder);
      }
    }).then((unlisten) => {
      unlistenTauri = unlisten;
    }).catch(() => {});

    return () => {
      window.removeEventListener("storage", handleStorage);
      if (unlistenTauri) unlistenTauri();
    };
  }, []);

  return {
    theme,
    setTheme,
    cycleTheme,
    plColorStyle,
    setPlColorStyle,
    orderColorStyle,
    setOrderColorStyle,
    // 後方互換性エイリアス
    themeId: theme,
    setThemeId: (id: string) => {
      if (VALID_THEMES.includes(id as ThemeType)) {
        setTheme(id as ThemeType);
      }
    },
    themeMode: theme === "light" || theme === "warm-sepia" ? ("light" as const) : ("dark" as const),
    setThemeMode: (mode: "dark" | "light") => {
      setTheme(mode === "light" ? "light" : "dark");
    }
  };
}
