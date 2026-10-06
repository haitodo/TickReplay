import type { SelectionMap } from "../types/uiState";

/**
 * カスタムシンボルインポート画面のフィルタリング・選択に関する純粋ロジック。
 *
 * 意図的に React から切り離してある。UI を描画せずに直接テストできるようにするため、
 * ここには副作用もフックも置かない。
 */

export interface ScannedZipFile {
  year_month: string;
  file_path: string;
  already_imported: boolean;
  file_type?: "parquet" | "zip" | string;
}

export interface ScannedPairGroup {
  category: string;
  broker?: string;
  year?: string;
  pair_name: string;
  suggested_symbol_name: string;
  group_path: string;
  files: ScannedZipFile[];
  already_exists_in_mt5: boolean;
}

export interface ImportFilters {
  broker: string;
  year: string;
  status: "ALL" | "unimported_only" | "imported_only";
  format: "ALL" | "parquet" | "zip";
  searchQuery: string;
}

export type SelectionMode = "all" | "none" | "unimported";

export interface ImportItem {
  pairName: string;
  symbolName: string;
  groupPath: string;
  filePath: string;
  yearMonth: string;
}

export function getGroupKey(g: {
  category?: string;
  pair_name: string;
  suggested_symbol_name?: string;
}): string {
  return g.suggested_symbol_name || `${g.category || "Custom"}_${g.pair_name}`;
}

export function getGroupBroker(g: ScannedPairGroup): string {
  if (g.broker && g.broker.trim() && g.broker.toLowerCase() !== "custom") return g.broker;
  if (g.category && !/^\d{4}$/.test(g.category) && g.category.toLowerCase() !== "custom") {
    return g.category;
  }
  return "Custom";
}

export function getGroupYear(g: ScannedPairGroup): string {
  if (g.year && /^\d{4}$/.test(g.year)) return g.year;
  if (g.category && /^\d{4}$/.test(g.category)) return g.category;
  if (g.files.length > 0 && g.files[0].year_month) {
    const match = g.files[0].year_month.match(/^(\d{4})/);
    if (match) return match[1];
  }
  const matchSym = g.suggested_symbol_name.match(/_(\d{4})(?:_|$)/);
  if (matchSym) return matchSym[1];
  return "";
}

function isParquetFile(f: ScannedZipFile): boolean {
  return f.file_type === "parquet" || f.file_path.toLowerCase().endsWith(".parquet");
}

/**
 * 書式フィルタをファイル単位で適用したうえで、業者・年・状態・検索語でグループを絞り込む。
 * 書式フィルタで空になったグループは除外する。
 */
export function filterGroups(
  groups: ScannedPairGroup[],
  filters: ImportFilters,
  symbolNames: { [key: string]: string } = {}
): ScannedPairGroup[] {
  return groups
    .map((g) => {
      const files = g.files.filter((f) => {
        if (filters.format === "ALL") return true;
        const isP = isParquetFile(f);
        if (filters.format === "parquet") return isP;
        if (filters.format === "zip") return !isP;
        return true;
      });
      return { ...g, files };
    })
    .filter((g) => {
      if (g.files.length === 0) return false;
      const b = getGroupBroker(g);
      const y = getGroupYear(g);
      if (filters.broker !== "ALL" && b !== filters.broker) return false;
      if (filters.year !== "ALL" && y !== filters.year) return false;

      const totalFiles = g.files.length;
      const importedFiles = g.files.filter((f) => f.already_imported).length;
      const isComplete = importedFiles === totalFiles && totalFiles > 0;

      if (filters.status === "unimported_only" && isComplete) return false;
      if (filters.status === "imported_only" && !isComplete) return false;

      if (filters.searchQuery.trim()) {
        const q = filters.searchQuery.trim().toUpperCase();
        const key = getGroupKey(g);
        const symName = symbolNames[key] || g.suggested_symbol_name || "";
        if (
          !g.pair_name.toUpperCase().includes(q) &&
          !symName.toUpperCase().includes(q) &&
          !b.toUpperCase().includes(q) &&
          !y.includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
}

/** グループ群に含まれる全ファイルを表示順のまま平坦化する。 */
export function collectFiles(groups: ScannedPairGroup[]): ScannedZipFile[] {
  const list: ScannedZipFile[] = [];
  groups.forEach((g) => {
    g.files.forEach((f) => list.push(f));
  });
  return list;
}

/** 可視ファイルのうち選択されているものの件数。 */
export function countSelected(
  files: ScannedZipFile[],
  selectedMonths: SelectionMap
): number {
  return files.filter((f) => selectedMonths[f.file_path]).length;
}

/**
 * 全スキャンファイル中の総選択数。フィルタで隠れている選択も含むため、
 * 可視件数との差が「他フィルタに残存する選択」の検知に使われる。
 */
export function countTotalSelected(selectedMonths: SelectionMap): number {
  return Object.values(selectedMonths).filter(Boolean).length;
}

/** 指定ファイル群に一括選択・解除を適用する。他のファイルの選択状態は保持する。 */
export function applySelectionMode(
  files: ScannedZipFile[],
  mode: SelectionMode,
  prev: SelectionMap
): SelectionMap {
  const next = { ...prev };
  files.forEach((f) => {
    if (mode === "all") {
      next[f.file_path] = true;
    } else if (mode === "none") {
      next[f.file_path] = false;
    } else if (mode === "unimported") {
      next[f.file_path] = !f.already_imported;
    }
  });
  return next;
}

/**
 * 業者フィルタ切り替え時の選択整合性を保つ。
 * 選択した業者以外のファイルのチェックを外し、その業者で1件も選択が無ければ
 * 未インポート分を自動選択する。broker が "ALL" のときは選択を変更しない。
 */
export function applyBrokerFilterSelection(
  groups: ScannedPairGroup[],
  broker: string,
  prev: SelectionMap
): SelectionMap {
  if (broker === "ALL") return prev;

  const next = { ...prev };
  let anySelectedInThisBroker = false;

  groups.forEach((g) => {
    if (getGroupBroker(g) !== broker) {
      // 選択した業者以外のファイルのチェックを解除し、隠れた選択が残らないようにする
      g.files.forEach((f) => {
        next[f.file_path] = false;
      });
    } else {
      g.files.forEach((f) => {
        if (next[f.file_path]) anySelectedInThisBroker = true;
      });
    }
  });

  // もしこの業者でまだ1件も選択されていない場合は未インポート分を自動選択
  if (!anySelectedInThisBroker) {
    groups.forEach((g) => {
      if (getGroupBroker(g) === broker) {
        g.files.forEach((f) => {
          if (!f.already_imported) {
            next[f.file_path] = true;
          }
        });
      }
    });
  }

  return next;
}

/**
 * インポート対象を確定する。表示中（フィルタ後）のグループのみを厳格に対象とし、
 * 他フィルタに残存する選択は取り込まない。
 */
export function collectImportItems(
  groups: ScannedPairGroup[],
  selectedMonths: SelectionMap,
  symbolNames: { [key: string]: string } = {},
  groupPaths: { [key: string]: string } = {}
): ImportItem[] {
  const items: ImportItem[] = [];
  groups.forEach((g) => {
    const key = getGroupKey(g);
    const symName = symbolNames[key] || g.suggested_symbol_name || `${g.pair_name}_Custom`;
    const grpPath =
      groupPaths[key] ||
      g.group_path ||
      (g.category && g.category !== "Custom" ? g.category : "Custom");

    g.files.forEach((f) => {
      if (selectedMonths[f.file_path]) {
        items.push({
          pairName: g.pair_name,
          symbolName: symName,
          groupPath: grpPath,
          filePath: f.file_path,
          yearMonth: f.year_month,
        });
      }
    });
  });
  return items;
}
