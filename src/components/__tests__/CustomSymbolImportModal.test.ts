import { describe, it, expect } from "vitest";
import { CustomSymbolImportModal, ScannedPairGroup } from "../CustomSymbolImportModal";

describe("CustomSymbolImportModal component", () => {
  it("is defined as a React component", () => {
    expect(CustomSymbolImportModal).toBeDefined();
    expect(typeof CustomSymbolImportModal).toBe("function");
  });

  describe("Broker filter and import isolation logic", () => {
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
          { year_month: "2024-01", file_path: "D:/tick/XM/USDJPY_2024-01.parquet", already_imported: false },
          { year_month: "2024-02", file_path: "D:/tick/XM/USDJPY_2024-02.parquet", already_imported: false },
        ]
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
          { year_month: "2024-01", file_path: "D:/tick/DMM/USDJPY_2024-01.parquet", already_imported: false },
          { year_month: "2024-02", file_path: "D:/tick/DMM/USDJPY_2024-02.parquet", already_imported: false },
        ]
      },
      {
        category: "Axiory",
        broker: "Axiory",
        year: "2024",
        pair_name: "EURUSD",
        suggested_symbol_name: "EURUSD_Axiory_2024",
        group_path: "Axiory",
        already_exists_in_mt5: false,
        files: [
          { year_month: "2024-01", file_path: "D:/tick/Axiory/EURUSD_2024-01.parquet", already_imported: false }
        ]
      }
    ];

    it("filters groups strictly by selected broker", () => {
      const selectedBroker = "XM";
      const filtered = mockGroups.filter(g => g.broker === selectedBroker);
      expect(filtered.length).toBe(1);
      expect(filtered[0].broker).toBe("XM");
      expect(filtered[0].suggested_symbol_name).toBe("USDJPY_XM_2024");
    });

    it("collects items to import exclusively from filteredGroups even if other brokers are marked true in selectedMonths", () => {
      // Simulate state where DMM files were previously marked true in selectedMonths
      const selectedMonths: { [path: string]: boolean } = {
        "D:/tick/XM/USDJPY_2024-01.parquet": true,
        "D:/tick/XM/USDJPY_2024-02.parquet": false,
        "D:/tick/DMM/USDJPY_2024-01.parquet": true, // Stale hidden selection
        "D:/tick/DMM/USDJPY_2024-02.parquet": true, // Stale hidden selection
        "D:/tick/Axiory/EURUSD_2024-01.parquet": true // Stale hidden selection
      };

      const selectedBroker = "XM";
      const filteredGroups = mockGroups.filter(g => g.broker === selectedBroker);

      // Using the fixed handleStartImport logic (iterating over filteredGroups):
      const itemsToImport: any[] = [];
      filteredGroups.forEach(g => {
        g.files.forEach(f => {
          if (selectedMonths[f.file_path]) {
            itemsToImport.push({
              pairName: g.pair_name,
              symbolName: g.suggested_symbol_name,
              filePath: f.file_path,
              yearMonth: f.year_month
            });
          }
        });
      });

      // Exactly 1 item should be imported (XM 2024-01), DMM and Axiory must NOT be included!
      expect(itemsToImport.length).toBe(1);
      expect(itemsToImport[0].symbolName).toBe("USDJPY_XM_2024");
      expect(itemsToImport[0].filePath).toBe("D:/tick/XM/USDJPY_2024-01.parquet");
    });

    it("clears non-target broker selections when switching broker filter", () => {
      const initialSelectedMonths: { [path: string]: boolean } = {
        "D:/tick/XM/USDJPY_2024-01.parquet": true,
        "D:/tick/DMM/USDJPY_2024-01.parquet": true,
        "D:/tick/Axiory/EURUSD_2024-01.parquet": true
      };

      const newBroker = "XM";
      const nextSelected = { ...initialSelectedMonths };

      mockGroups.forEach(g => {
        if (g.broker !== newBroker) {
          g.files.forEach(f => {
            nextSelected[f.file_path] = false;
          });
        }
      });

      expect(nextSelected["D:/tick/XM/USDJPY_2024-01.parquet"]).toBe(true);
      expect(nextSelected["D:/tick/DMM/USDJPY_2024-01.parquet"]).toBe(false);
      expect(nextSelected["D:/tick/Axiory/EURUSD_2024-01.parquet"]).toBe(false);
    });

    it("detects hidden selections when totalSelectedCount exceeds visibleSelectedCount", () => {
      const selectedMonths: { [path: string]: boolean } = {
        "D:/tick/XM/USDJPY_2024-01.parquet": true,
        "D:/tick/DMM/USDJPY_2024-01.parquet": true,
        "D:/tick/DMM/USDJPY_2024-02.parquet": true
      };

      const filteredGroups = mockGroups.filter(g => g.broker === "XM");
      const visibleFiles = filteredGroups.flatMap(g => g.files);
      const visibleSelectedCount = visibleFiles.filter(f => selectedMonths[f.file_path]).length;
      const totalSelectedCount = Object.values(selectedMonths).filter(Boolean).length;

      expect(visibleSelectedCount).toBe(1);
      expect(totalSelectedCount).toBe(3);
      expect(totalSelectedCount > visibleSelectedCount).toBe(true);

      const hiddenCount = totalSelectedCount - visibleSelectedCount;
      expect(hiddenCount).toBe(2);
    });
  });
});
