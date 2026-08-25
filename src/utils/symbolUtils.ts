import { SymbolItem } from "../components/SymbolCombobox";

export interface ParsedSymbol {
  originalName: string;
  basePair: string;
  broker: string;
  year: string;
  suffix: string; // e.g. "2016", "OANDA_2016", "Custom", or ""
  category: string; // e.g. "OANDA", "Ducascopy", "2016", "Standard"
  isYear: boolean;
}

const KNOWN_BASE_PAIRS = [
  "USDJPY", "EURUSD", "GBPJPY", "EURJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD",
  "EURGBP", "EURCHF", "EURAUD", "EURCAD", "EURNZD", "GBPAUD", "GBPCAD", "GBPCHF",
  "GBPNZD", "AUDJPY", "CHFJPY", "CADJPY", "NZDJPY", "AUDCAD", "AUDCHF", "AUDNZD",
  "CADCHF", "NZDCAD", "NZDCHF", "XAUUSD", "GOLD", "XAGUSD", "SILVER", "BTCUSD",
  "ETHUSD", "US30", "US500", "USTEC", "JP225", "DE30", "DE40", "UK100", "WTI", "BRENT"
];

/**
 * リプレイ実行時に自動生成される作業用シンボルまたはフォルダ名かどうかを判定する
 * 例: "Replay", "USDJPY_Replay", "EURUSD_replay", "USDJPY.replay"
 */
export function isReplaySymbol(symbolName: string): boolean {
  const clean = (symbolName || "").trim();
  if (!clean) return false;
  const upper = clean.toUpperCase();
  return upper === "REPLAY" || upper.endsWith("_REPLAY") || upper.endsWith(".REPLAY");
}

/**
 * シンボル名から ベース通貨ペア、ブローカー名、年、サフィックスを抽出する
 * 例:
 * - "USDJPY_OANDA_2016" -> basePair: "USDJPY", broker: "OANDA", year: "2016", category: "OANDA"
 * - "USDJPY_DUCASCOPY_2016" -> basePair: "USDJPY", broker: "DUCASCOPY", year: "2016", category: "DUCASCOPY"
 * - "USDJPY_2016" -> basePair: "USDJPY", broker: "", year: "2016", category: "2016"
 * - "EURJPY_test" -> basePair: "EURJPY", broker: "", year: "", category: "test"
 * - "USDJPY" -> basePair: "USDJPY", broker: "", year: "", category: "Standard"
 */
export function parseSymbolName(symbolName: string): ParsedSymbol {
  const clean = (symbolName || "").trim();
  if (!clean) {
    return {
      originalName: "",
      basePair: "",
      broker: "",
      year: "",
      suffix: "",
      category: "Standard",
      isYear: false
    };
  }

  const upper = clean.toUpperCase();

  // 1. 既知のベース通貨ペアの最長一致検索
  let matchedPair = "";
  for (const kp of KNOWN_BASE_PAIRS) {
    if (upper.startsWith(kp) && kp.length > matchedPair.length) {
      matchedPair = kp;
    }
  }

  if (matchedPair) {
    const remainder = clean.substring(matchedPair.length);
    const cleanRemainder = remainder.replace(/^[_.-]+/, "");

    if (!cleanRemainder) {
      return {
        originalName: clean,
        basePair: matchedPair,
        broker: "",
        year: "",
        suffix: "",
        category: "Standard",
        isYear: false
      };
    }

    const parts = cleanRemainder.split(/[_.-]+/).filter(Boolean);
    let year = "";
    let broker = "";
    const remainingParts: string[] = [];

    for (const part of parts) {
      if (/^\d{4}$/.test(part) && Number(part) >= 1970 && Number(part) <= 2099) {
        year = part;
      } else {
        remainingParts.push(part);
      }
    }

    if (remainingParts.length > 0) {
      broker = remainingParts.join("_");
    }

    const category = broker || year || "Custom";

    return {
      originalName: clean,
      basePair: matchedPair,
      broker,
      year,
      suffix: cleanRemainder,
      category,
      isYear: !!year
    };
  }

  // アンダースコア区切りのフォールバック
  const underscoreIdx = clean.lastIndexOf("_");
  if (underscoreIdx > 0 && underscoreIdx < clean.length - 1) {
    const basePair = clean.substring(0, underscoreIdx);
    const suffix = clean.substring(underscoreIdx + 1);
    const isYear = /^\d{4}$/.test(suffix) && Number(suffix) >= 1970 && Number(suffix) <= 2099;

    return {
      originalName: clean,
      basePair: basePair.toUpperCase(),
      broker: "",
      year: isYear ? suffix : "",
      suffix,
      category: suffix,
      isYear
    };
  }

  return {
    originalName: clean,
    basePair: clean.toUpperCase(),
    broker: "",
    year: "",
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

  const validSymbols = symbols.filter(s => !isReplaySymbol(typeof s === "string" ? s : s.name));

  const normalized: SymbolItem[] = validSymbols.map(s => {
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
  if (!parsedSource.suffix || parsedSource.category === "Standard" || isReplaySymbol(sourceSymbol)) {
    return [];
  }
  const targetCategory = parsedSource.category;

  const selectedUpper = new Set(currentlySelected.map(s => s.trim().toUpperCase()));
  selectedUpper.add(sourceSymbol.trim().toUpperCase());

  const companions: string[] = [];

  allSymbols.forEach(s => {
    const symName = typeof s === "string" ? s : s.name;
    if (isReplaySymbol(symName)) return;
    const parsed = parseSymbolName(symName);

    const isCategoryMatch = parsed.category === targetCategory;
    const isYearMatch = parsedSource.year ? parsed.year === parsedSource.year : true;
    const isBrokerMatch = parsedSource.broker ? parsed.broker.toUpperCase() === parsedSource.broker.toUpperCase() : true;

    if (isCategoryMatch && isYearMatch && isBrokerMatch && !selectedUpper.has(symName.toUpperCase())) {
      companions.push(symName);
    }
  });

  return companions;
}

/**
 * 指定したソースシンボルと同じ分類（同業者・同年度・同サフィックス）に属する全関連シンボル一覧を取得
 */
export function getAllCompanionsForSource(
  sourceSymbol: string,
  allSymbols: (SymbolItem | string)[]
): SymbolItem[] {
  const parsedSource = parseSymbolName(sourceSymbol);
  if (!parsedSource.basePair || isReplaySymbol(sourceSymbol)) return [];

  const targetCategory = parsedSource.category;
  const sourceUpper = sourceSymbol.trim().toUpperCase();

  const validSymbols = allSymbols.filter(s => !isReplaySymbol(typeof s === "string" ? s : s.name));
  const normalized: SymbolItem[] = validSymbols.map(s => {
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

  return normalized.filter(item => {
    if (item.name.toUpperCase() === sourceUpper) return false;
    const parsed = parseSymbolName(item.name);
    if (targetCategory === "Standard") {
      return parsed.category === "Standard" || !parsed.suffix;
    }
    const isCatMatch = parsed.category === targetCategory;
    const isYearMatch = parsedSource.year ? parsed.year === parsedSource.year : true;
    const isBrokerMatch = parsedSource.broker ? parsed.broker.toUpperCase() === parsedSource.broker.toUpperCase() : true;
    return isCatMatch && isYearMatch && isBrokerMatch;
  });
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
  const validSymbols = allSymbols.filter(s => !isReplaySymbol(typeof s === "string" ? s : s.name));
  const allNames = new Set(validSymbols.map(s => (typeof s === "string" ? s : s.name).toUpperCase()));

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

export interface DualFeedBrokerOption {
  broker: string;
  symbolName: string;
  item: SymbolItem;
}

export interface DualFeedPairCandidate {
  basePair: string;
  year: string;
  brokers: DualFeedBrokerOption[];
}

/**
 * 通貨ペア＋年ごとのブローカー別候補一覧を取得（デュアルフィード用）
 */
export function getDualFeedCandidates(symbols: (SymbolItem | string)[]): DualFeedPairCandidate[] {
  const map: { [key: string]: DualFeedPairCandidate } = {};

  symbols.forEach(s => {
    const symName = typeof s === "string" ? s : s.name;
    if (isReplaySymbol(symName)) return;
    const item: SymbolItem = typeof s === "string" ? { name: s, source_type: "custom", group_name: "Custom" } : s;
    const parsed = parseSymbolName(symName);

    if (parsed.basePair) {
      const yearKey = parsed.year || "Standard";
      const key = `${parsed.basePair}_${yearKey}`;
      if (!map[key]) {
        map[key] = {
          basePair: parsed.basePair,
          year: parsed.year,
          brokers: []
        };
      }
      const brokerLabel = parsed.broker || (parsed.isYear ? "Custom" : parsed.category || "Standard");
      if (!map[key].brokers.some(b => b.symbolName === symName)) {
        map[key].brokers.push({
          broker: brokerLabel,
          symbolName: symName,
          item
        });
      }
    }
  });

  return Object.values(map);
}

/**
 * 利用可能な全ブローカー名リストを取得
 */
export function getAllBrokers(symbols: (SymbolItem | string)[]): string[] {
  const brokerSet = new Set<string>();
  symbols.forEach(s => {
    const symName = typeof s === "string" ? s : s.name;
    if (isReplaySymbol(symName)) return;
    const parsed = parseSymbolName(symName);
    if (parsed.broker) {
      brokerSet.add(parsed.broker);
    }
  });
  return Array.from(brokerSet).sort((a, b) => a.localeCompare(b));
}

/**
 * 利用可能な全西暦年リストを取得
 */
export function getAllYears(symbols: (SymbolItem | string)[]): string[] {
  const yearSet = new Set<string>();
  symbols.forEach(s => {
    const symName = typeof s === "string" ? s : s.name;
    if (isReplaySymbol(symName)) return;
    const parsed = parseSymbolName(symName);
    if (parsed.year) {
      yearSet.add(parsed.year);
    }
  });
  return Array.from(yearSet).sort((a, b) => b.localeCompare(a));
}

