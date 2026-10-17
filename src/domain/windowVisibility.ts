/**
 * ウィンドウ可視性イベントペイロードの型定義
 */
export interface WindowVisibilityPayload {
  label: string;
  visible: boolean;
}

/**
 * ウィンドウ可視性イベントが現在のウィンドウを対象としているか判定し、
 * 対象であれば新しい可視状態 (boolean) を返す。
 * 他ウィンドウ向けのイベントであれば null を返し、状態変更を無視すべきことを示す。
 *
 * @param currentLabel 現在のウィンドウの識別子 (例: "speed_order", "positions", "main")
 * @param payload イベントペイロード ({ label, visible } またはレガシー bare boolean)
 * @param fallbackToCurrent レガシー bare boolean 受信時に null を返して getCurrentWindow().isVisible() による自己検証を促すか
 */
export function resolveWindowVisibility(
  currentLabel: string,
  payload: unknown,
  fallbackToCurrent = false
): boolean | null {
  if (typeof payload === "object" && payload !== null && "visible" in payload) {
    const obj = payload as { label?: string; visible?: boolean };
    if (obj.label && obj.label !== currentLabel) {
      return null; // 他ウィンドウに対する可視性変更は無視
    }
    return Boolean(obj.visible);
  }

  if (typeof payload === "boolean") {
    // レガシー bare boolean の場合、別ウィンドウからのブロードキャストの可能性があるため
    // fallbackToCurrent が true の場合は null を返して自己検証を促す
    return fallbackToCurrent ? null : payload;
  }

  return null;
}
