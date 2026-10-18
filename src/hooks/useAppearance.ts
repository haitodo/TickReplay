import { useState, useEffect } from "react";
import { EVENTS } from "../constants/events";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { listen } from "@tauri-apps/api/event";

export type PlColorStyle = "red-blue" | "green-red";
export type OrderColorStyle = "blue-red" | "red-green";

interface SettingsUpdatedPayload {
  plColorStyle?: string;
  orderColorStyle?: string;
}

function getInitialPlColorStyle(): PlColorStyle {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.plColorStyle);
    if (saved === "red-blue" || saved === "green-red") {
      return saved;
    }
  } catch (e) {
    console.warn("Failed to read PL color style from localStorage:", e);
  }
  return "red-blue";
}

function getInitialOrderColorStyle(): OrderColorStyle {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.speedOrderColorStyle);
    if (saved === "red-primary") {
      return "red-green";
    }
    if (saved === "blue-red" || saved === "red-green") {
      return saved;
    }
  } catch (e) {
    console.warn("Failed to read order color style from localStorage:", e);
  }
  return "blue-red";
}

function applyPlColorStyle(style: PlColorStyle) {
  document.documentElement.setAttribute("data-pl-style", style);
  try {
    localStorage.setItem(STORAGE_KEYS.plColorStyle, style);
  } catch {
    // Keep the in-memory appearance working even when localStorage is unavailable.
  }
}

function applyOrderColorStyle(style: OrderColorStyle) {
  document.documentElement.setAttribute("data-order-color-style", style);
  try {
    localStorage.setItem(STORAGE_KEYS.speedOrderColorStyle, style);
  } catch {
    // Keep the in-memory appearance working even when localStorage is unavailable.
  }
}

/**
 * 損益色と発注ボタン配色だけを管理する。
 * カラーテーマはダーク固定のため、テーマ状態・テーマ同期は持たない。
 */
export function useAppearance() {
  const [plColorStyle, setPlColorStyle] = useState<PlColorStyle>(getInitialPlColorStyle);
  const [orderColorStyle, setOrderColorStyle] = useState<OrderColorStyle>(getInitialOrderColorStyle);

  useEffect(() => {
    applyPlColorStyle(plColorStyle);
  }, [plColorStyle]);

  useEffect(() => {
    applyOrderColorStyle(orderColorStyle);
  }, [orderColorStyle]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.plColorStyle && e.newValue) {
        if (e.newValue === "red-blue" || e.newValue === "green-red") {
          setPlColorStyle(e.newValue);
        }
      }
      if (e.key === STORAGE_KEYS.speedOrderColorStyle && e.newValue) {
        if (e.newValue === "red-primary") {
          setOrderColorStyle("red-green");
        } else if (e.newValue === "blue-red" || e.newValue === "red-green") {
          setOrderColorStyle(e.newValue);
        }
      }
    };

    window.addEventListener("storage", handleStorage);

    // 購読解除は「解決後」に必ず行う。登録が解決する前にこの effect が
    // 破棄されても、解決時点で解除されるためリスナーが残らない。
    const unlistenTauri = listen<SettingsUpdatedPayload>(EVENTS.settingsUpdated, (event) => {
      const updatedPl = event.payload?.plColorStyle;
      const updatedOrder = event.payload?.orderColorStyle;
      if (updatedPl === "red-blue" || updatedPl === "green-red") {
        setPlColorStyle(updatedPl);
      }
      if (updatedOrder === "blue-red" || updatedOrder === "red-green") {
        setOrderColorStyle(updatedOrder);
      }
    });

    return () => {
      window.removeEventListener("storage", handleStorage);
      unlistenTauri.then((fn) => fn()).catch(() => {});
    };
  }, []);

  return {
    plColorStyle,
    setPlColorStyle,
    orderColorStyle,
    setOrderColorStyle,
  };
}
