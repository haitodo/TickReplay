import { describe, it, expect } from "vitest";
import { CustomSymbolImportModal } from "../CustomSymbolImportModal";
import type { SelectionMap } from "../../types/uiState";
import {
  type ScannedPairGroup,
  type ImportFilters,
  getGroupBroker,
  getGroupYear,
  filterGroups,
  collectFiles,
  countSelected,
  countTotalSelected,
  applySelectionMode,
  applyBrokerFilterSelection,
  collectImportItems,
} from "../../domain/customSymbolImport";

/**
 * ここでは本番実装 (domain/customSymbolImport.ts) を直接呼び出す。
 * フィルタや選択のロジックをテスト側で書き直すと、本番が壊れても緑のままになるため、
 * 期待値の計算以外のロジックをこのファイルに置かないこと。
 */

const parquet = (ym: string, path: string, imported = false) => ({
  year_month: ym,
  file_path: path,
  already_imported: imported,
  file_type: "parquet" as const,
});

const mockGroups: ScannedPairGroup[] = [
  {
    category: "XM",
    broker: "XM",
    year: "2024",
    pair_name: "USDJPY",
    suggested_symbol_name: "USDJPY_XM_2024",
    group_path: "XM",
    already_exists_in_mt5: false,
    files: [
      parquet("2024-01", "D:/tick/XM/USDJPY_2024-01.parquet"),
      parquet("2024-02", "D:/tick/XM/USDJPY_2024-02.parquet"),
    ],
  },
  {
    category: "DMM",
    broker: "DMM",
    year: "2024",
    pair_name: "USDJPY",
    suggested_symbol_name: "USDJPY_DMM_2024",
    group_path: "DMM",
    already_exists_in_mt5: false,
    files: [
      parquet("2024-01", "D:/tick/DMM/USDJPY_2024-01.parquet"),
      parquet("2024-02", "D:/tick/DMM/USDJPY_2024-02.parquet"),
    ],
  },
  {
    category: "Axiory",
    broker: "Axiory",
    year: "2024",
    pair_name: "EURUSD",
    suggested_symbol_name: "EURUSD_Axiory_2024",
    group_path: "Axiory",
    already_exists_in_mt5: false,
    files: [parquet("2024-01", "D:/tick/Axiory/EURUSD_2024-01.parquet")],
  },
];

const ALL: ImportFilters = {
  broker: "ALL",
  year: "ALL",
  status: "ALL",
  format: "ALL",
  searchQuery: "",
};

const withFilters = (overrides: Partial<ImportFilters> = {}): ImportFilters => ({
  ...ALL,
  ...overrides,
});

describe("CustomSymbolImportModal component", () => {
  it("is defined as a React component", () => {
    expect(CustomSymbolImportModal).toBeDefined();
    expect(typeof CustomSymbolImportModal).toBe("function");
  });
});

describe("getGroupBroker", () => {
  it("prefers the explicit broker field", () => {
    expect(getGroupBroker(mockGroups[0])).toBe("XM");
  });

  it("falls back to category when broker is absent or 'custom'", () => {
    expect(getGroupBroker({ ...mockGroups[0], broker: undefined })).toBe("XM");
    expect(getGroupBroker({ ...mockGroups[0], broker: "custom" })).toBe("XM");
  });

  it("returns Custom when nothing identifies the broker", () => {
    expect(getGroupBroker({ ...mockGroups[0], broker: undefined, category: "custom" })).toBe("Custom");
    expect(getGroupBroker({ ...mockGroups[0], broker: undefined, category: "2024" })).toBe("Custom");
  });
});

describe("getGroupYear", () => {
  it("prefers the explicit year field", () => {
    expect(getGroupYear(mockGroups[0])).toBe("2024");
  });

  it("falls back to a 4-digit category", () => {
    expect(getGroupYear({ ...mockGroups[0], year: undefined, category: "2023" })).toBe("2023");
  });

  it("falls back to the first file's year_month", () => {
    const g = { ...mockGroups[0], year: undefined, category: "XM" };
    expect(getGroupYear(g)).toBe("2024");
  });

  it("falls back to the year embedded in the symbol name", () => {
    const g: ScannedPairGroup = {
      ...mockGroups[0],
      year: undefined,
      category: "XM",
      suggested_symbol_name: "USDJPY_XM_2019",
      files: [],
    };
    expect(getGroupYear(g)).toBe("2019");
  });

  it("returns an empty string when no year can be determined", () => {
    const g: ScannedPairGroup = {
      ...mockGroups[0],
      year: undefined,
      category: "XM",
      suggested_symbol_name: "USDJPY_XM",
      files: [],
    };
    expect(getGroupYear(g)).toBe("");
  });
});

describe("filterGroups", () => {
  it("returns every group when all filters are ALL", () => {
    expect(filterGroups(mockGroups, ALL)).toHaveLength(3);
  });

  it("filters groups strictly by selected broker", () => {
    const filtered = filterGroups(mockGroups, withFilters({ broker: "XM" }));
    expect(filtered).toHaveLength(1);
    expect(filtered[0].broker).toBe("XM");
    expect(filtered[0].suggested_symbol_name).toBe("USDJPY_XM_2024");
  });

  it("filters by year", () => {
    expect(filterGroups(mockGroups, withFilters({ year: "2024" }))).toHaveLength(3);
    expect(filterGroups(mockGroups, withFilters({ year: "2023" }))).toHaveLength(0);
  });

  it("excludes fully imported groups when unimported_only is selected", () => {
    const fullyImported: ScannedPairGroup = {
      ...mockGroups[0],
      suggested_symbol_name: "USDJPY_XM_2020",
      files: [parquet("2020-01", "D:/tick/XM/USDJPY_2020-01.parquet", true)],
    };
    const groups = [...mockGroups, fullyImported];

    const result = filterGroups(groups, withFilters({ status: "unimported_only" }));
    expect(result.map((g) => g.suggested_symbol_name)).not.toContain("USDJPY_XM_2020");
  });

  it("keeps only fully imported groups when imported_only is selected", () => {
    const fullyImported: ScannedPairGroup = {
      ...mockGroups[0],
      suggested_symbol_name: "USDJPY_XM_2020",
      files: [parquet("2020-01", "D:/tick/XM/USDJPY_2020-01.parquet", true)],
    };
    const groups = [...mockGroups, fullyImported];

    const result = filterGroups(groups, withFilters({ status: "imported_only" }));
    expect(result.map((g) => g.suggested_symbol_name)).toEqual(["USDJPY_XM_2020"]);
  });

  it("drops files of the wrong format and removes groups left empty", () => {
    const mixed: ScannedPairGroup = {
      ...mockGroups[0],
      suggested_symbol_name: "USDJPY_XM_MIXED",
      files: [
        parquet("2024-01", "D:/tick/XM/USDJPY_2024-01.parquet"),
        { year_month: "2024-02", file_path: "D:/tick/XM/USDJPY_2024-02.zip", already_imported: false, file_type: "zip" },
      ],
    };
    const onlyZip: ScannedPairGroup = {
      ...mockGroups[0],
      suggested_symbol_name: "USDJPY_XM_ONLYZIP",
      files: [
        { year_month: "2024-03", file_path: "D:/tick/XM/USDJPY_2024-03.zip", already_imported: false, file_type: "zip" },
      ],
    };

    const result = filterGroups([mixed, onlyZip], withFilters({ format: "parquet" }));

    // 混在グループは parquet だけが残り、zip のみのグループは除外される
    expect(result).toHaveLength(1);
    expect(result[0].suggested_symbol_name).toBe("USDJPY_XM_MIXED");
    expect(result[0].files.map((f) => f.file_path)).toEqual(["D:/tick/XM/USDJPY_2024-01.parquet"]);

    const zipResult = filterGroups([mixed, onlyZip], withFilters({ format: "zip" }));
    expect(zipResult).toHaveLength(2);
    expect(zipResult[0].files.map((f) => f.file_path)).toEqual(["D:/tick/XM/USDJPY_2024-02.zip"]);
  });

  it("matches the search query against pair name, symbol name, broker and year", () => {
    expect(filterGroups(mockGroups, withFilters({ searchQuery: "eurusd" }))).toHaveLength(1);
    expect(filterGroups(mockGroups, withFilters({ searchQuery: "axiory" }))).toHaveLength(1);
    expect(filterGroups(mockGroups, withFilters({ searchQuery: "usdjpy" }))).toHaveLength(2);
    expect(filterGroups(mockGroups, withFilters({ searchQuery: "2024" }))).toHaveLength(3);
    expect(filterGroups(mockGroups, withFilters({ searchQuery: "nope" }))).toHaveLength(0);
  });

  it("uses the symbolNames override map when searching", () => {
    const groups = [{ ...mockGroups[0], suggested_symbol_name: "A", pair_name: "AAA" }];
    const symbolNames = { A: "ZZZ_USDJPY" };
    expect(filterGroups(groups, withFilters({ searchQuery: "ZZZ" }), symbolNames)).toHaveLength(1);
    expect(filterGroups(groups, withFilters({ searchQuery: "ZZZ" }), {})).toHaveLength(0);
  });

  it("does not mutate the input groups", () => {
    const before = JSON.stringify(mockGroups);
    filterGroups(mockGroups, withFilters({ format: "zip" }));
    expect(JSON.stringify(mockGroups)).toBe(before);
  });
});

describe("collectFiles / countSelected / countTotalSelected", () => {
  it("flattens files in display order", () => {
    const files = collectFiles(mockGroups);
    expect(files).toHaveLength(5);
    expect(files[0].file_path).toBe("D:/tick/XM/USDJPY_2024-01.parquet");
    expect(files[4].file_path).toBe("D:/tick/Axiory/EURUSD_2024-01.parquet");
  });

  it("counts only selected visible files, but counts every selection in total", () => {
    const selectedMonths: SelectionMap = {
      "D:/tick/XM/USDJPY_2024-01.parquet": true,
      "D:/tick/XM/USDJPY_2024-02.parquet": false,
      "D:/tick/DMM/USDJPY_2024-01.parquet": true,
      "D:/tick/DMM/USDJPY_2024-02.parquet": true,
    };

    const visible = collectFiles(filterGroups(mockGroups, withFilters({ broker: "XM" })));
    const visibleSelectedCount = countSelected(visible, selectedMonths);
    const totalSelectedCount = countTotalSelected(selectedMonths);

    // DMM の選択は「隠れた選択」として総数にだけ現れる
    expect(visibleSelectedCount).toBe(1);
    expect(totalSelectedCount).toBe(3);
    expect(totalSelectedCount - visibleSelectedCount).toBe(2);
  });
});

describe("applySelectionMode", () => {
  const files = mockGroups[0].files;

  it("selects all given files and preserves unrelated selections", () => {
    const next = applySelectionMode(files, "all", { "other.parquet": true });
    expect(next["D:/tick/XM/USDJPY_2024-01.parquet"]).toBe(true);
    expect(next["D:/tick/XM/USDJPY_2024-02.parquet"]).toBe(true);
    expect(next["other.parquet"]).toBe(true);
  });

  it("clears only the given files", () => {
    const next = applySelectionMode(files, "none", {
      "D:/tick/XM/USDJPY_2024-01.parquet": true,
      "other.parquet": true,
    });
    expect(next["D:/tick/XM/USDJPY_2024-01.parquet"]).toBe(false);
    expect(next["other.parquet"]).toBe(true);
  });

  it("selects exactly the unimported files", () => {
    const mixed = [parquet("2024-01", "a.parquet", true), parquet("2024-02", "b.parquet", false)];
    const next = applySelectionMode(mixed, "unimported", {});
    expect(next["a.parquet"]).toBe(false);
    expect(next["b.parquet"]).toBe(true);
  });

  it("does not mutate the previous selection object", () => {
    const prev: SelectionMap = { "D:/tick/XM/USDJPY_2024-01.parquet": false };
    applySelectionMode(files, "all", prev);
    expect(prev["D:/tick/XM/USDJPY_2024-01.parquet"]).toBe(false);
    expect(prev["D:/tick/XM/USDJPY_2024-02.parquet"]).toBeUndefined();
  });
});

describe("applyBrokerFilterSelection", () => {
  it("clears selections belonging to other brokers", () => {
    const prev = {
      "D:/tick/XM/USDJPY_2024-01.parquet": true,
      "D:/tick/DMM/USDJPY_2024-01.parquet": true,
      "D:/tick/Axiory/EURUSD_2024-01.parquet": true,
    };

    const next = applyBrokerFilterSelection(mockGroups, "XM", prev);

    expect(next["D:/tick/XM/USDJPY_2024-01.parquet"]).toBe(true);
    expect(next["D:/tick/DMM/USDJPY_2024-01.parquet"]).toBe(false);
    expect(next["D:/tick/Axiory/EURUSD_2024-01.parquet"]).toBe(false);
  });

  it("auto-selects unimported files when the broker has no selection yet", () => {
    const next = applyBrokerFilterSelection(mockGroups, "DMM", {});
    expect(next["D:/tick/DMM/USDJPY_2024-01.parquet"]).toBe(true);
    expect(next["D:/tick/DMM/USDJPY_2024-02.parquet"]).toBe(true);
    // 他業者のファイルは「未設定」ではなく明示的に false へ落とされる
    expect(next["D:/tick/XM/USDJPY_2024-01.parquet"]).toBe(false);
  });

  it("does not auto-select already imported files", () => {
    const groups: ScannedPairGroup[] = [
      {
        ...mockGroups[0],
        files: [
          parquet("2024-01", "D:/tick/XM/USDJPY_2024-01.parquet", true),
          parquet("2024-02", "D:/tick/XM/USDJPY_2024-02.parquet", false),
        ],
      },
    ];
    const next = applyBrokerFilterSelection(groups, "XM", {});
    // インポート済みのファイルは選択されない (未設定のまま = 未チェック扱い)
    expect(next["D:/tick/XM/USDJPY_2024-01.parquet"]).toBeUndefined();
    expect(next["D:/tick/XM/USDJPY_2024-02.parquet"]).toBe(true);
  });

  it("keeps the existing selection when the broker already has one", () => {
    const prev = { "D:/tick/XM/USDJPY_2024-01.parquet": true };
    const next = applyBrokerFilterSelection(mockGroups, "XM", prev);
    // 2件目は自動選択されない (すでに1件選択があるため)
    expect(next["D:/tick/XM/USDJPY_2024-01.parquet"]).toBe(true);
    expect(next["D:/tick/XM/USDJPY_2024-02.parquet"]).toBeUndefined();
  });

  it("leaves the selection untouched for the ALL pseudo-broker", () => {
    const prev = { "D:/tick/XM/USDJPY_2024-01.parquet": true };
    expect(applyBrokerFilterSelection(mockGroups, "ALL", prev)).toBe(prev);
  });
});

describe("collectImportItems", () => {
  it("takes items exclusively from the passed groups", () => {
    // 他業者に残存する選択があっても、渡されたグループ以外は取り込まない
    const selectedMonths: SelectionMap = {
      "D:/tick/XM/USDJPY_2024-01.parquet": true,
      "D:/tick/XM/USDJPY_2024-02.parquet": false,
      "D:/tick/DMM/USDJPY_2024-01.parquet": true,
      "D:/tick/DMM/USDJPY_2024-02.parquet": true,
      "D:/tick/Axiory/EURUSD_2024-01.parquet": true,
    };

    const filteredGroups = filterGroups(mockGroups, withFilters({ broker: "XM" }));
    const items = collectImportItems(filteredGroups, selectedMonths);

    expect(items).toHaveLength(1);
    expect(items[0].symbolName).toBe("USDJPY_XM_2024");
    expect(items[0].filePath).toBe("D:/tick/XM/USDJPY_2024-01.parquet");
    expect(items[0].pairName).toBe("USDJPY");
    expect(items[0].yearMonth).toBe("2024-01");
  });

  it("returns nothing when no file is selected", () => {
    expect(collectImportItems(mockGroups, {})).toHaveLength(0);
  });

  it("prefers symbolNames and groupPaths overrides", () => {
    const selectedMonths = { "D:/tick/XM/USDJPY_2024-01.parquet": true };
    const items = collectImportItems(
      [mockGroups[0]],
      selectedMonths,
      { USDJPY_XM_2024: "OVERRIDE_SYM" },
      { USDJPY_XM_2024: "OVERRIDE_PATH" }
    );

    expect(items).toHaveLength(1);
    expect(items[0].symbolName).toBe("OVERRIDE_SYM");
    expect(items[0].groupPath).toBe("OVERRIDE_PATH");
  });

  it("falls back to group_path, then category, then Custom for the group path", () => {
    const selectedMonths = { "f.parquet": true };
    const base = { ...mockGroups[0], files: [parquet("2024-01", "f.parquet")] };

    expect(collectImportItems([{ ...base, group_path: "GP" }], selectedMonths)[0].groupPath).toBe("GP");
    expect(collectImportItems([{ ...base, group_path: "" }], selectedMonths)[0].groupPath).toBe("XM");
    expect(
      collectImportItems([{ ...base, group_path: "", category: "Custom" }], selectedMonths)[0].groupPath
    ).toBe("Custom");
  });

  it("derives the symbol name list from the selected items without duplicates", () => {
    const selectedMonths = {
      "D:/tick/XM/USDJPY_2024-01.parquet": true,
      "D:/tick/XM/USDJPY_2024-02.parquet": true,
    };
    const items = collectImportItems([mockGroups[0]], selectedMonths);
    const symbols = Array.from(new Set(items.map((it) => it.symbolName)));

    expect(items).toHaveLength(2);
    expect(symbols).toEqual(["USDJPY_XM_2024"]);
    expect(items.map((it) => it.yearMonth).sort()).toEqual(["2024-01", "2024-02"]);
  });
});
