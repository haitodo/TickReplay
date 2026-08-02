import { useState, useEffect } from "react";
import { THEME_PRESETS, THEME_PRESETS_LIGHT } from "../constants/themePresets";

export function useTheme() {
  const [themeId, setThemeId] = useState<string>(() => {
    return localStorage.getItem("accent-theme") || "cream";
  });
  const [glassEffect, setGlassEffect] = useState<boolean>(() => {
    return localStorage.getItem("glass-effect") === "true";
  });
  const [themeMode, setThemeMode] = useState<"dark" | "light">(() => {
    return (localStorage.getItem("theme-mode") as "dark" | "light") || "dark";
  });
  const [plColorStyle, setPlColorStyle] = useState<"red-blue" | "green-red">(() => {
    return (localStorage.getItem("pl-color-style") as "red-blue" | "green-red") || "red-blue";
  });
  const [orderColorStyle, setOrderColorStyle] = useState<"blue-red" | "red-green">(() => {
    const saved = localStorage.getItem("speed-order-color-style");
    if (saved === "red-primary") return "red-green";
    return (saved as "blue-red" | "red-green") || "blue-red";
  });

  // テーマ切り替えエフェクト
  useEffect(() => {
    const selected = THEME_PRESETS.find(p => p.id === themeId) || THEME_PRESETS[0];
    let color = selected.color;
    let rgb = selected.rgb;
    let hover = selected.hover;
    let onPrimary = selected.onPrimary;
    let light = selected.light;
    let border = selected.border;

    if (themeMode === "light") {
      document.documentElement.setAttribute('data-theme', 'light');
      document.documentElement.setAttribute('data-theme-mode', 'light');
      const lightAdjusted = THEME_PRESETS_LIGHT[selected.id];
      if (lightAdjusted) {
        color = lightAdjusted.color ?? color;
        rgb = lightAdjusted.rgb ?? rgb;
        hover = lightAdjusted.hover ?? hover;
        onPrimary = lightAdjusted.onPrimary ?? onPrimary;
        light = lightAdjusted.light ?? light;
        border = lightAdjusted.border ?? border;
      }
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      document.documentElement.removeAttribute('data-theme-mode');
    }

    document.documentElement.style.setProperty('--primary-color', color);
    document.documentElement.style.setProperty('--primary-rgb', rgb);
    document.documentElement.style.setProperty('--primary-hover', hover);
    document.documentElement.style.setProperty('--on-primary', onPrimary);
    document.documentElement.style.setProperty('--primary-light', light);
    document.documentElement.style.setProperty('--primary-border', border);
    localStorage.setItem("accent-theme", selected.id);
    localStorage.setItem("theme-mode", themeMode);
  }, [themeId, themeMode]);

  // ガラス質感適用エフェクト
  useEffect(() => {
    if (glassEffect) {
      document.documentElement.setAttribute('data-glass-effect', 'true');
    } else {
      document.documentElement.removeAttribute('data-glass-effect');
    }
    localStorage.setItem("glass-effect", String(glassEffect));
  }, [glassEffect]);

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

  return {
    themeId,
    setThemeId,
    glassEffect,
    setGlassEffect,
    themeMode,
    setThemeMode,
    plColorStyle,
    setPlColorStyle,
    orderColorStyle,
    setOrderColorStyle
  };
}
