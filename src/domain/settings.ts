import type { TerminalInfo } from "../types/terminal";

/**
 * ターミナル一覧からカスタム表示名マッピング (id -> name, path -> name) を抽出する
 */
export function formatTerminalNamesMap(
  terminals: TerminalInfo[]
): Record<string, string> | undefined {
  const map: Record<string, string> = {};
  for (const t of terminals) {
    if (t.custom_name && t.custom_name.trim()) {
      const name = t.custom_name.trim();
      if (t.id) map[t.id] = name;
      map[t.path] = name;
    }
  }
  return Object.keys(map).length > 0 ? map : undefined;
}
