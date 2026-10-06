import { useState, useEffect, useCallback } from "react";
import { EVENTS } from "../constants/events";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { THEME_LIST, ThemeType, ThemeConfig } from "../constants/themePresets";
import { listen } from "@tauri-apps/api/event";

const THEME_STORAGE_KEY = STORAGE_KEYS.tickreplayTheme;
const VALID_THEMES: ThemeType[] = ["dark", "dim", "light", "sepia", "warm-sepia"];

interface SettingsUpdatedPayload {
  theme?: string;
  themeMode?: string;
  themeId?: string;
  plColorStyle?: "red-blue" | "green-red";
  orderColorStyle?: "blue-red" | "red-green";
}

function getInitialTheme(): ThemeType {
  try {
    const saved = (localStorage.getItem(THEME_STORAGE_KEY) ||
      localStorage.getItem(STORAGE_KEYS.theme) ||
      localStorage.getItem(STORAGE_KEYS.themeMode) ||
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
    return (localStorage.getItem(STORAGE_KEYS.plColorStyle) as "red-blue" | "green-red") || "red-blue";
  });
  const [orderColorStyle, setOrderColorStyle] = useState<"blue-red" | "red-green">(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.speedOrderColorStyle);
    if (saved === "red-primary") return "red-green";
    return (saved as "blue-red" | "red-green") || "blue-red";
  });

  const setTheme = useCallback((newTheme: ThemeType) => {
    if (!VALID_THEMES.includes(newTheme)) return;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, newTheme);
      localStorage.setItem(STORAGE_KEYS.theme, newTheme);
      localStorage.setItem(STORAGE_KEYS.themeMode, newTheme);
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
        localStorage.setItem(STORAGE_KEYS.theme, nextTheme);
        localStorage.setItem(STORAGE_KEYS.themeMode, nextTheme);
      } catch (e) {
        // Keep the in-memory theme switch working if localStorage is unavailable.
      }
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
    localStorage.setItem(STORAGE_KEYS.plColorStyle, plColorStyle);
  }, [plColorStyle]);

  // 発注カラー配色適用エフェクト
  useEffect(() => {
    document.documentElement.setAttribute("data-order-color-style", orderColorStyle);
    localStorage.setItem(STORAGE_KEYS.speedOrderColorStyle, orderColorStyle);
  }, [orderColorStyle]);

  // 他ウィンドウからの設定変更（Tauriイベント & storageイベント）を監視
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (
        (e.key === THEME_STORAGE_KEY || e.key === STORAGE_KEYS.theme || e.key === STORAGE_KEYS.themeMode) &&
        e.newValue &&
        VALID_THEMES.includes(e.newValue as ThemeType)
      ) {
        const newTheme = e.newValue as ThemeType;
        applyThemeToDocument(newTheme);
        setThemeState(newTheme);
      }
      if (e.key === STORAGE_KEYS.plColorStyle && e.newValue) {
        setPlColorStyle(e.newValue as "red-blue" | "green-red");
      }
      if (e.key === STORAGE_KEYS.speedOrderColorStyle && e.newValue) {
        setOrderColorStyle(e.newValue as "blue-red" | "red-green");
      }
    };

    window.addEventListener("storage", handleStorage);

    // 購読解除は「解決後」に必ず行う。登録が解決する前にこの effect が
    // 破棄されても、解決時点で解除されるためリスナーが残らない。
    const unlistenTauri = listen<SettingsUpdatedPayload>(EVENTS.settingsUpdated, (event) => {
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
    });

    return () => {
      window.removeEventListener("storage", handleStorage);
      unlistenTauri.then((fn) => fn()).catch(() => {});
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
