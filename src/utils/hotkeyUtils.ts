// --- デフォルトのホットキー定義
export const DEFAULT_HOTKEYS: Record<string, string> = {
  play_pause: "Control+Alt+Space",
  step_forward: "Control+Alt+ArrowRight",
  step_backward: "Control+Alt+ArrowLeft",
  session_jump_next: "Control+Alt+Home",
  session_jump_prev: "Control+Alt+End",
  time_jump_forward: "Control+Alt+Shift+PageUp",
  time_jump_backward: "Control+Alt+Shift+PageDown",
  time_jump_forward_1m: "Control+Alt+ArrowUp",
  time_jump_backward_1m: "Control+Alt+ArrowDown",
  time_jump_forward_10m: "Control+Alt+PageUp",
  time_jump_backward_10m: "Control+Alt+PageDown",
  coarse_speed_up: "Control+Alt+BracketRight",
  coarse_speed_down: "Control+Alt+BracketLeft",
  medium_speed_up: "Control+Alt+Period",
  medium_speed_down: "Control+Alt+Comma",
  fine_speed_up: "Control+Alt+Equal",
  fine_speed_down: "Control+Alt+Minus",
  speed_mode_toggle: "Control+Alt+KeyM",
  speed_reset_1x: "Control+Alt+Digit1",
  loop_set_a: "Control+Alt+KeyA",
  loop_set_b: "Control+Alt+KeyB",
  loop_clear: "Control+Alt+KeyC",
  reset: "Control+Alt+KeyR",
  order_buy: "",
  order_sell: "",
  order_close_buy: "",
  order_close_sell: "",
  order_close_all: ""
};

// --- ホットキーのメタデータ（日本語表記と説明）
export const HOTKEY_METADATA: Record<string, { name: string; desc: string }> = {
  play_pause: { name: "再生 / 一時停止", desc: "リプレイの再生と一時停止を切り替えます" },
  step_forward: { name: "1ステップ進む", desc: "1ティック進みます（一時停止時のみ有効）" },
  step_backward: { name: "1ステップ戻る", desc: "1ティック戻ります（一時停止時のみ有効）" },
  session_jump_next: { name: "次のセッションへジャンプ", desc: "東京、ロンドン、ニューヨークなどの次のセッション開始時刻へ移動します" },
  session_jump_prev: { name: "前のセッションへジャンプ", desc: "前のセッション開始時刻へ移動します" },
  time_jump_forward: { name: "時間加算 (+1時間)", desc: "時間を1時間進めます" },
  time_jump_backward: { name: "時間減算 (-1時間)", desc: "時間を1時間戻します" },
  time_jump_forward_1m: { name: "時間加算 (+1分)", desc: "時間を1分進めます" },
  time_jump_backward_1m: { name: "時間減算 (-1分)", desc: "時間を1分戻します" },
  time_jump_forward_10m: { name: "時間加算 (+10分)", desc: "時間を10分進めます" },
  time_jump_backward_10m: { name: "時間減算 (-10分)", desc: "時間を10分戻します" },
  coarse_speed_up: { name: "速度プリセット切替 (上げる)", desc: "再生速度またはスキップティック数を次のプリセットへ上げます" },
  coarse_speed_down: { name: "速度プリセット切替 (下げる)", desc: "再生速度またはスキップティック数を前のプリセットへ下げます" },
  medium_speed_up: { name: "速度の標準調整 (+1.0x / +10T)", desc: "再生速度を1.0x(または10ティック)上げます" },
  medium_speed_down: { name: "速度の標準調整 (-1.0x / -10T)", desc: "再生速度を1.0x(または10ティック)下げます" },
  fine_speed_up: { name: "速度の微調整 (+0.1x / +1T)", desc: "再生速度を0.1x(または1ティック)細かく上げます" },
  fine_speed_down: { name: "速度の微調整 (-0.1x / -1T)", desc: "再生速度を0.1x(または1ティック)細かく下げます" },
  speed_mode_toggle: { name: "速度モード切替 (Time ⇄ Tick)", desc: "時間ベース再生とTick数ベース再生を切り替えます" },
  speed_reset_1x: { name: "速度を 1.0x / 1T にリセット", desc: "再生速度を標準の1.0x(または1T)にリセットします" },
  loop_set_a: { name: "ループ開始点 A の設定", desc: "現在のインデックスをリプレイのループ開始位置（点A）として設定します" },
  loop_set_b: { name: "ループ終了点 B の設定", desc: "現在のインデックスをリプレイのループ終了位置（点B）として設定します" },
  loop_clear: { name: "A-Bループの解除", desc: "設定されているA-Bループ範囲をクリアします" },
  reset: { name: "リセット", desc: "リプレイのインデックスを初期位置にリセットします" },
  order_buy: { name: "スピード発注: 買い", desc: "スピード発注画面の買い（BUY）注文を実行します" },
  order_sell: { name: "スピード発注: 売り", desc: "スピード発注画面の売り（SELL）注文を実行します" },
  order_close_buy: { name: "スピード発注: 買い決済", desc: "保有しているすべての買い（BUY）ポジションを決済します" },
  order_close_sell: { name: "スピード発注: 売り決済", desc: "保有しているすべての売り（SELL）ポジションを決済します" },
  order_close_all: { name: "スピード発注: 全決済", desc: "保有しているすべてのポジションを一括決済します" }
};

export interface MaxBarsInfo {
  max_bars: number;
  is_unlimited: boolean;
  raw_value: string;
}

// KeyboardEventからTauriショートカット文字列を生成する
export const getTauriShortcutFromEvent = (e: KeyboardEvent): string => {
  const modifiers: string[] = [];
  if (e.ctrlKey) modifiers.push("Control");
  if (e.shiftKey) modifiers.push("Shift");
  if (e.altKey) modifiers.push("Alt");
  if (e.metaKey) modifiers.push("Super");

  const mainKey = e.code;
  if (
    mainKey === "ControlLeft" ||
    mainKey === "ControlRight" ||
    mainKey === "ShiftLeft" ||
    mainKey === "ShiftRight" ||
    mainKey === "AltLeft" ||
    mainKey === "AltRight" ||
    mainKey === "MetaLeft" ||
    mainKey === "MetaRight"
  ) {
    return "";
  }

  if (modifiers.length > 0) {
    return `${modifiers.join("+")}+${mainKey}`;
  }
  return mainKey;
};

// 登録キー文字列の日本語表示用フォーマッタ
export const formatShortcutForDisplay = (shortcut: string): string => {
  if (!shortcut || shortcut.trim() === "") return "未設定";
  return shortcut
    .replace(/Control/g, "Ctrl")
    .replace(/Super/g, "Win")
    .replace(/BracketLeft/g, "[")
    .replace(/BracketRight/g, "]")
    .replace(/Key([A-Z])/g, "$1")
    .replace(/Digit([0-9])/g, "$1")
    .replace(/\+/g, " + ");
};

// KeyboardEventが登録ショートカットに一致するか判定するヘルパー
export const matchesHotkey = (e: KeyboardEvent, registeredKey: string): boolean => {
  if (!registeredKey || registeredKey.trim() === "") return false;
  const regNorm = registeredKey.toLowerCase();

  const hasCtrl = regNorm.includes("control") || regNorm.includes("ctrl");
  const hasShift = regNorm.includes("shift");
  const hasAlt = regNorm.includes("alt");
  const hasMeta = regNorm.includes("super") || regNorm.includes("meta") || regNorm.includes("win");

  if (e.ctrlKey !== hasCtrl) return false;
  if (e.shiftKey !== hasShift) return false;
  if (e.altKey !== hasAlt) return false;
  if (e.metaKey !== hasMeta) return false;

  const parts = regNorm.split("+");
  const mainKeyPart = parts[parts.length - 1];

  const eventKey = e.key.toLowerCase();
  const eventCode = e.code.toLowerCase();

  if (mainKeyPart === "space" && (eventKey === " " || eventKey === "space" || eventCode === "space")) return true;
  if (mainKeyPart === "arrowright" && (eventKey === "arrowright" || eventCode === "arrowright")) return true;
  if (mainKeyPart === "arrowleft" && (eventKey === "arrowleft" || eventCode === "arrowleft")) return true;
  if (mainKeyPart === "arrowup" && (eventKey === "arrowup" || eventCode === "arrowup")) return true;
  if (mainKeyPart === "arrowdown" && (eventKey === "arrowdown" || eventCode === "arrowdown")) return true;

  if (mainKeyPart.startsWith("key")) {
    const letter = mainKeyPart.substring(3);
    if (eventCode === mainKeyPart || eventKey === letter) return true;
  }

  if (mainKeyPart.startsWith("digit")) {
    const digit = mainKeyPart.substring(5);
    if (eventCode === mainKeyPart || eventKey === digit) return true;
  }

  if (mainKeyPart === "bracketleft" && (eventKey === "[" || eventCode === "bracketleft")) return true;
  if (mainKeyPart === "bracketright" && (eventKey === "]" || eventCode === "bracketright")) return true;
  if (mainKeyPart === "minus" && (eventKey === "-" || eventCode === "minus")) return true;
  if (mainKeyPart === "equal" && (eventKey === "=" || eventCode === "equal")) return true;

  if (mainKeyPart === eventKey || mainKeyPart === eventCode) return true;

  return false;
};
