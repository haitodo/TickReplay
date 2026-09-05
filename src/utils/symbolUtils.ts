import { SymbolItem } from "../components/SymbolCombobox";
import { parseDateTimeStr } from "./dateUtils";

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

/**
 * ブローカー名またはシンボル名が OANDA であるかを判定する
 */
export function isOandaBroker(brokerOrSymbol: string): boolean {
  if (!brokerOrSymbol) return false;
  return /oanda/i.test(brokerOrSymbol);
}

/**
 * ブローカー名またはシンボル名が DUKASCOPY / DUCASCOPY であるかを判定する
 */
export function isDucascopyBroker(brokerOrSymbol: string): boolean {
  if (!brokerOrSymbol) return false;
  return /du[ck]as/i.test(brokerOrSymbol);
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
 * デュアルフィード比較用のブローカー並び順をソートする
 * Main優先: OANDA > その他 > DUKASCOPY/DUCASCOPY
 * Sub優先: DUKASCOPY/DUCASCOPY > その他 > OANDA
 * 
 * 2社選択時（[0]がMain、[1]がSub）に [OANDA, DUCASCOPY] になるように並び替える
 */
export function sortBrokersForDualFeed(brokers: DualFeedBrokerOption[]): DualFeedBrokerOption[] {
  if (brokers.length <= 1) return [...brokers];

  const oandaIdx = brokers.findIndex(b => isOandaBroker(b.broker) || isOandaBroker(b.symbolName));
  const ducasIdx = brokers.findIndex(b => isDucascopyBroker(b.broker) || isDucascopyBroker(b.symbolName));

  const result: DualFeedBrokerOption[] = [];
  const used = new Set<number>();

  // 1. Main候補 (先頭): OANDA があれば最優先、なければ DUCAS 以外の先頭、それもなければ最初の要素
  if (oandaIdx !== -1) {
    result.push(brokers[oandaIdx]);
    used.add(oandaIdx);
  } else {
    const firstNonDucas = brokers.findIndex((b, idx) => !used.has(idx) && !(isDucascopyBroker(b.broker) || isDucascopyBroker(b.symbolName)));
    if (firstNonDucas !== -1) {
      result.push(brokers[firstNonDucas]);
      used.add(firstNonDucas);
    } else {
      result.push(brokers[0]);
      used.add(0);
    }
  }

  // 2. Sub候補 (2番目): DUCASCOPY があれば最優先、なければ残りの先頭
  if (ducasIdx !== -1 && !used.has(ducasIdx)) {
    result.push(brokers[ducasIdx]);
    used.add(ducasIdx);
  }

  // 3. 残りのブローカーを追加
  brokers.forEach((b, idx) => {
    if (!used.has(idx)) {
      result.push(b);
      used.add(idx);
    }
  });

  return result;
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

  const candidates = Object.values(map);
  // 各候補のブローカー一覧を Dual Feed 向け優先順位（Main: OANDA, Sub: DUCASCOPY）でソート
  candidates.forEach(c => {
    c.brokers = sortBrokersForDualFeed(c.brokers);
  });

  return candidates;
}

/**
 * 利用可能なシンボル一覧から、デュアルフィード比較に最適なデフォルトペア（Main: OANDA, Sub: DUCASCOPY）を取得する
 */
export function findDefaultDualFeedPair(
  symbols: (SymbolItem | string)[],
  currentSourceSymbol?: string
): { mainSymbol: string; subSymbol: string } | null {
  const candidates = getDualFeedCandidates(symbols);
  const validCandidates = candidates.filter(c => c.brokers.length >= 2);

  if (validCandidates.length === 0) {
    if (candidates.length > 0 && candidates[0].brokers.length > 0) {
      return {
        mainSymbol: candidates[0].brokers[0].symbolName,
        subSymbol: ""
      };
    }
    return null;
  }

  // 現在のシンボル情報
  const currentParsed = currentSourceSymbol ? parseSymbolName(currentSourceSymbol) : null;
  const currentBasePair = currentParsed?.basePair?.toUpperCase() || "";
  const currentYear = currentParsed?.year || "";

  // 1. 同一ベース通貨ペアかつ同一年の候補を検索
  if (currentBasePair) {
    const samePairSameYear = validCandidates.find(
      c => c.basePair.toUpperCase() === currentBasePair && (!currentYear || c.year === currentYear)
    );
    if (samePairSameYear) {
      // 既にソート済みなので [0] が Main、[1] が Sub
      return {
        mainSymbol: samePairSameYear.brokers[0].symbolName,
        subSymbol: samePairSameYear.brokers[1].symbolName
      };
    }

    // 2. 同一ベース通貨ペア（別年含む）の候補を検索
    const samePairAnyYear = validCandidates.find(
      c => c.basePair.toUpperCase() === currentBasePair
    );
    if (samePairAnyYear) {
      return {
        mainSymbol: samePairAnyYear.brokers[0].symbolName,
        subSymbol: samePairAnyYear.brokers[1].symbolName
      };
    }
  }

  // 3. OANDA & DUCASCOPY が揃っている候補（USDJPY優先、なければ先頭）を検索
  const idealCandidate = validCandidates.find(
    c => (isOandaBroker(c.brokers[0].broker) || isOandaBroker(c.brokers[0].symbolName)) &&
         (isDucascopyBroker(c.brokers[1].broker) || isDucascopyBroker(c.brokers[1].symbolName)) &&
         c.basePair.toUpperCase() === "USDJPY"
  ) || validCandidates.find(
    c => (isOandaBroker(c.brokers[0].broker) || isOandaBroker(c.brokers[0].symbolName)) &&
         (isDucascopyBroker(c.brokers[1].broker) || isDucascopyBroker(c.brokers[1].symbolName))
  );

  if (idealCandidate) {
    return {
      mainSymbol: idealCandidate.brokers[0].symbolName,
      subSymbol: idealCandidate.brokers[1].symbolName
    };
  }

  // 4. フォールバック: 最初の候補の先頭2社
  const fallback = validCandidates[0];
  return {
    mainSymbol: fallback.brokers[0].symbolName,
    subSymbol: fallback.brokers[1].symbolName
  };
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

/**
 * 現在のシンボル（通貨ペア・ブローカー）に一致する、指定年度のシンボルを検索する
 * 例: "USDJPY_OANDA_2024" + targetYear="2023" -> "USDJPY_OANDA_2023"
 */
export function findMatchingSymbolForYear(
  currentSymbol: string,
  targetYear: string,
  allSymbols: (SymbolItem | string)[]
): string | null {
  if (!currentSymbol || !targetYear) return null;
  const currentParsed = parseSymbolName(currentSymbol);
  if (!currentParsed.basePair) return null;

  const validSymbols = allSymbols.filter(s => !isReplaySymbol(typeof s === "string" ? s : s.name));
  const parsedList = validSymbols.map(s => {
    const name = typeof s === "string" ? s : s.name;
    return { name, parsed: parseSymbolName(name) };
  });

  // 1. 同一通貨ペア + 同一ブローカー + 対象年度 の完全一致
  if (currentParsed.broker) {
    const exactMatch = parsedList.find(item =>
      item.parsed.basePair.toUpperCase() === currentParsed.basePair.toUpperCase() &&
      item.parsed.broker.toUpperCase() === currentParsed.broker.toUpperCase() &&
      item.parsed.year === targetYear
    );
    if (exactMatch) return exactMatch.name;
  }

  // 2. 同一通貨ペア + 対象年度 の一致
  const pairYearMatch = parsedList.find(item =>
    item.parsed.basePair.toUpperCase() === currentParsed.basePair.toUpperCase() &&
    item.parsed.year === targetYear
  );
  if (pairYearMatch) return pairYearMatch.name;

  // 3. 通信先候補が見つからない場合は null
  return null;
}

/**
 * シンボルに含まれる年度と指定日時の年度に不一致があるかを判定する
 */
export function checkSymbolYearMismatch(
  symbol: string,
  dateTimeStr: string
): { hasMismatch: boolean; symbolYear?: string; dateYear: number } {
  const dateParsed = parseDateTimeStr(dateTimeStr);
  const symParsed = parseSymbolName(symbol);

  if (symParsed.year) {
    const symYearNum = parseInt(symParsed.year);
    const hasMismatch = !isNaN(symYearNum) && symYearNum !== dateParsed.year;
    return {
      hasMismatch,
      symbolYear: symParsed.year,
      dateYear: dateParsed.year
    };
  }

  return {
    hasMismatch: false,
    symbolYear: undefined,
    dateYear: dateParsed.year
  };
}

/**
 * デュアルフィード比較表示用: 年度バッジが別枠で表示される場合に、
 * シンボル名末尾の冗長な年度（例: "_2024"）を取り除いてコンパクトな名称にする。
 * 例: "USDJPY_DUCASCOPY_2024" -> "USDJPY_DUCASCOPY"
 *     "USDJPY_OANDA_2024" -> "USDJPY_OANDA"
 *     "USDJPY_2024" -> "USDJPY"
 *     "USDJPY" -> "USDJPY"
 */
export function formatCompactDualSymbolName(symbolName: string, parsed?: ParsedSymbol): string {
  const clean = (symbolName || "").trim();
  if (!clean) return "(未選択)";
  const p = parsed || parseSymbolName(clean);
  if (p.year) {
    const yearPattern = new RegExp(`[_.-]${p.year}$`, "i");
    if (yearPattern.test(clean)) {
      const stripped = clean.replace(yearPattern, "");
      if (stripped.length > 0) {
        return stripped;
      }
    }
  }
  return clean;
}

