/**
 * ファイルバッファの文字コード（UTF-8 vs Shift-JIS/CP932）を自動判定・デコードするユーティリティ
 */

export interface DecodedResult {
  text: string;
  encoding: "utf-8" | "shift-jis";
}

/**
 * ArrayBufferからテキストを安全にデコード（Shift-JIS/UTF-8自動判別）
 */
export function decodeFileBuffer(buffer: ArrayBuffer): DecodedResult {
  const bytes = new Uint8Array(buffer);

  // 1. UTF-8 BOM (0xEF, 0xBB, 0xBF) のチェック
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    const decoder = new TextDecoder("utf-8");
    return {
      text: decoder.decode(bytes.subarray(3)),
      encoding: "utf-8"
    };
  }

  // 2. UTF-8としてのデコードを試みる (fatal: true で無効バイト検出)
  try {
    const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
    const text = utf8Decoder.decode(bytes);
    return {
      text,
      encoding: "utf-8"
    };
  } catch (_e) {
    // UTF-8でデコードエラーが発生した場合はShift-JIS / CP932と判定
    try {
      const sjisDecoder = new TextDecoder("shift-jis");
      const text = sjisDecoder.decode(bytes);
      return {
        text,
        encoding: "shift-jis"
      };
    } catch (_e2) {
      // フォールバック（標準UTF-8）
      const fallbackDecoder = new TextDecoder("utf-8");
      return {
        text: fallbackDecoder.decode(bytes),
        encoding: "utf-8"
      };
    }
  }
}
