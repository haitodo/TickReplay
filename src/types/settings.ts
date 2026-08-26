/**
 * アプリケーション環境設定およびホットキー関連のドメイン型定義
 */

import { ThemeType } from "../constants/themePresets";
import { OrderColorStyle, PlColorStyle } from "./trading";

export type HotkeyActionKey =
  | "togglePlay"
  | "stepForward"
  | "stepBackward"
  | "speedUp"
  | "speedDown"
  | "switchSpeedMode"
  | "jumpStart"
  | "jumpEnd"
  | "orderBuy"
  | "orderSell"
  | "closeAll"
  | "reversePosition"
  | "increaseLots"
  | "decreaseLots"
  | "openSpeedOrderWindow"
  | "openPositionsWindow"
  | "openSettingsWindow"
  | "openSymbolSelector";

export type HotkeyMapping = Record<string, string>;

export interface AppSettings {
  hotkeys: HotkeyMapping;
  time_presets: number[];
  tick_presets: number[];
  theme_mode?: ThemeType;
  pl_color_style?: PlColorStyle;
  order_color_style?: OrderColorStyle;
  always_on_top?: boolean;
  is_shortcuts_active?: boolean;
  auto_scroll_sync?: boolean;
  auto_skip_weekend?: boolean;
  limit_tick_history?: boolean;
  tick_history_timeframe?: string;
  max_history_bars?: number;
  openrouter_api_key?: string;
  openrouter_model?: string;
  fred_api_key?: string;
  finnhub_api_key?: string;
}
