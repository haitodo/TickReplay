import { SymbolItem } from "../components/SymbolCombobox";

export interface ParsedSymbol {
  originalName: string;
  basePair: string;
  suffix: string; // e.g. "2016", "test", "Custom", or ""
  category: string; // e.g. "2016", "test", "Custom", "Standard"
  isYear: boolean;
}

/**
 * シンボル名から ベース通貨ペア、サフィックス、年判定を抽出する
 * 例:
 * - "USDJPY_2016" -> basePair: "USDJPY", suffix: "2016", isYear: true, category: "2016"
 * - "EURJPY_test" -> basePair: "EURJPY", suffix: "test", isYear: false, category: "test"
 * - "GBPJPY_Custom" -> basePair: "GBPJPY", suffix: "Custom", isYear: false, category: "Custom"
 * - "USDJPY" -> basePair: "USDJPY", suffix: "", isYear: false, category: "Standard"
 */
export function parseSymbolName(symbolName: string): ParsedSymbol {
  const clean = (symbolName || "").trim();
  if (!clean) {
    return {
      originalName: "",
      basePair: "",
      suffix: "",
      category: "Standard",
      isYear: false
    };
  }

  // アンダースコア区切りのチェック (例: USDJPY_2016, EURJPY_test)
  const underscoreIdx = clean.lastIndexOf("_");
  if (underscoreIdx > 0 && underscoreIdx < clean.length - 1) {
    const basePair = clean.substring(0, underscoreIdx);
    const suffix = clean.substring(underscoreIdx + 1);
    const isYear = /^\d{4}$/.test(suffix) && Number(suffix) >= 1970 && Number(suffix) <= 2099;

    return {
      originalName: clean,
      basePair: basePair.toUpperCase(),
      suffix,
      category: suffix,
      isYear
    };
  }

  // ドット区切りのチェック (例: USDJPY.oj5k, EURUSD.pro)
  const dotIdx = clean.indexOf(".");
  if (dotIdx > 0 && dotIdx < clean.length - 1) {
    const basePair = clean.substring(0, dotIdx);
    const suffix = clean.substring(dotIdx + 1);

    return {
      originalName: clean,
      basePair: basePair.toUpperCase(),
      suffix,
      category: suffix,
      isYear: false
    };
  }

  return {
    originalName: clean,
    basePair: clean.toUpperCase(),
    suffix: "",
    category: "Standard",
    isYear: false
  };
}

/**
 * シンボル一覧をサフィックス（年別、カスタムタグ別、通常別）に分類・グループ化する
 */
export function groupSymbolsByCategory(symbols: (SymbolItem | string)[]): {
  years: string[];
  tags: string[];
  hasStandard: boolean;
  categories: { [category: string]: SymbolItem[] };
  allCategories: string[];
} {
  const categories: { [category: string]: SymbolItem[] } = {};
  const yearSet = new Set<string>();
  const tagSet = new Set<string>();
  let hasStandard = false;

  const normalized: SymbolItem[] = symbols.map(s => {
    if (typeof s === "string") {
      const parsed = parseSymbolName(s);
      return {
        name: s,
        source_type: parsed.suffix ? "custom" : "broker",
        group_name: parsed.category
      };
    }
    return s;
  });

  normalized.forEach(item => {
    const parsed = parseSymbolName(item.name);
    let cat = parsed.category;
    if (cat === "Standard" || !parsed.suffix) {
      cat = "Standard";
      hasStandard = true;
    } else if (parsed.isYear) {
      yearSet.add(cat);
    } else {
      tagSet.add(cat);
    }

    if (!categories[cat]) {
      categories[cat] = [];
    }
    if (!categories[cat].some(existing => existing.name === item.name)) {
      categories[cat].push(item);
    }
  });

  // 年は降順ソート (2025, 2024, ..., 2016)
  const years = Array.from(yearSet).sort((a, b) => b.localeCompare(a));
  // タグはアルファベット順
  const tags = Array.from(tagSet).sort((a, b) => a.localeCompare(b));

  const allCategories: string[] = [];
  allCategories.push(...years);
  allCategories.push(...tags);
  if (hasStandard) {
    allCategories.push("Standard");
  }

  return {
    years,
    tags,
    hasStandard,
    categories,
    allCategories
  };
}

/**
 * ソースシンボルと同一サフィックス（同一年または同一タグ）を持つ利用可能な他通貨ペアを取得
 */
export function getCompanionSymbols(
  sourceSymbol: string,
  allSymbols: (SymbolItem | string)[],
  currentlySelected: string[] = []
): string[] {
  const parsedSource = parseSymbolName(sourceSymbol);
  // サフィックス（年やタグ）がない標準銘柄の場合は、大量のデフォルト銘柄がサジェストされてレイアウトが崩れるのを防止
  if (!parsedSource.suffix || parsedSource.category === "Standard") {
    return [];
  }
  const targetCategory = parsedSource.category;

  const selectedUpper = new Set(currentlySelected.map(s => s.trim().toUpperCase()));
  selectedUpper.add(sourceSymbol.trim().toUpperCase());

  const companions: string[] = [];

  allSymbols.forEach(s => {
    const symName = typeof s === "string" ? s : s.name;
    const parsed = parseSymbolName(symName);

    if (parsed.category === targetCategory && !selectedUpper.has(symName.toUpperCase())) {
      companions.push(symName);
    }
  });

  return companions;
}

/**
 * ソースシンボルの年度・サフィックス変更時に、同期他通貨のサフィックスを新しいものに置換する
 * 例: ["EURJPY_2016", "GBPJPY_2016"] + from="2016", to="2017"
 *     -> ["EURJPY_2017", "GBPJPY_2017"] (利用可能なシンボル内に存在するか、生成)
 */
export function switchSymbolSuffix(
  currentSyncSymbols: string[],
  fromSuffix: string,
  toSuffix: string,
  allSymbols: (SymbolItem | string)[] = []
): string[] {
  const allNames = new Set(allSymbols.map(s => (typeof s === "string" ? s : s.name).toUpperCase()));

  return currentSyncSymbols.map(sym => {
    const parsed = parseSymbolName(sym);
    if (parsed.suffix.toLowerCase() === fromSuffix.toLowerCase()) {
      const candidate = toSuffix ? `${parsed.basePair}_${toSuffix}` : parsed.basePair;
      // 利用可能リストにあればそれを優先、なければそのまま生成名を返す
      const found = Array.from(allNames).find(a => a === candidate.toUpperCase());
      return found || candidate;
    }
    return sym;
  });
}

/**
 * JPYクロス判定 (USDJPY, EURJPY, GBPJPY 等)
 */
export function isJpyPair(sym: string): boolean {
  const parsed = parseSymbolName(sym);
  return parsed.basePair.endsWith("JPY") || parsed.basePair.startsWith("JPY");
}

/**
 * ドルストレート判定 (EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF 等)
 */
export function isUsdStraight(sym: string): boolean {
  const parsed = parseSymbolName(sym);
  return parsed.basePair.includes("USD") && !parsed.basePair.includes("JPY");
}

/**
 * ユーロクロス判定 (EURGBP, EURCHF, EURAUD, EURCAD 等)
 */
export function isEuroCross(sym: string): boolean {
  const parsed = parseSymbolName(sym);
  return parsed.basePair.startsWith("EUR") && !parsed.basePair.includes("JPY") && !parsed.basePair.includes("USD");
}
