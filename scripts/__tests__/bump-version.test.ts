import { describe, it, expect } from "vitest";
import {
  parseSemver,
  isValidSemver,
  incrementVersion,
  updatePackageJson,
  updatePackageLockJson,
  updateTauriConfJson,
  updateCargoToml,
  updateCargoLock,
  updateReadme,
} from "../bump-version.js";

describe("bump-version utility tests", () => {
  describe("parseSemver & isValidSemver", () => {
    it("should correctly parse valid semver strings", () => {
      expect(parseSemver("1.0.0")).toEqual({
        major: 1,
        minor: 0,
        patch: 0,
        prerelease: undefined,
        build: undefined,
      });

      expect(parseSemver("v2.14.3-beta.1")).toEqual({
        major: 2,
        minor: 14,
        patch: 3,
        prerelease: "beta.1",
        build: undefined,
      });
    });

    it("should return null / false for invalid semver strings", () => {
      expect(parseSemver("invalid")).toBeNull();
      expect(parseSemver("1.0")).toBeNull();
      expect(isValidSemver("1.0.0")).toBe(true);
      expect(isValidSemver("v1.2.3")).toBe(true);
      expect(isValidSemver("1.2")).toBe(false);
    });
  });

  describe("incrementVersion", () => {
    it("should increment patch version correctly", () => {
      expect(incrementVersion("1.0.0", "patch")).toBe("1.0.1");
      expect(incrementVersion("1.2.9", "patch")).toBe("1.2.10");
    });

    it("should increment minor version correctly", () => {
      expect(incrementVersion("1.0.0", "minor")).toBe("1.1.0");
      expect(incrementVersion("1.5.3", "minor")).toBe("1.6.0");
    });

    it("should increment major version correctly", () => {
      expect(incrementVersion("1.0.0", "major")).toBe("2.0.0");
      expect(incrementVersion("1.5.3", "major")).toBe("2.0.0");
    });

    it("should handle prerelease bumps", () => {
      expect(incrementVersion("1.0.0", "prepatch", "beta")).toBe("1.0.1-beta.0");
      expect(incrementVersion("1.0.1-beta.0", "prerelease")).toBe("1.0.1-beta.1");
    });
  });

  describe("updatePackageJson", () => {
    it("should update package.json version preserving indentation", () => {
      const original = JSON.stringify(
        {
          name: "tick-replay",
          version: "1.0.0",
          type: "module",
        },
        null,
        2
      ) + "\n";

      const updated = updatePackageJson(original, "1.0.1");
      const parsed = JSON.parse(updated);
      expect(parsed.version).toBe("1.0.1");
      expect(parsed.name).toBe("tick-replay");
      expect(updated.endsWith("\n")).toBe(true);
    });
  });

  describe("updatePackageLockJson", () => {
    it("should update package-lock.json top-level and packages[''] version", () => {
      const original = JSON.stringify(
        {
          name: "tick-replay",
          version: "1.0.0",
          lockfileVersion: 3,
          packages: {
            "": {
              name: "tick-replay",
              version: "1.0.0",
            },
          },
        },
        null,
        2
      ) + "\n";

      const updated = updatePackageLockJson(original, "1.1.0");
      const parsed = JSON.parse(updated);
      expect(parsed.version).toBe("1.1.0");
      expect(parsed.packages[""].version).toBe("1.1.0");
    });
  });

  describe("updateTauriConfJson", () => {
    it("should update tauri.conf.json version", () => {
      const original = JSON.stringify(
        {
          productName: "TickReplay",
          version: "1.0.0",
          identifier: "com.haitodo.mt5replay",
        },
        null,
        2
      ) + "\n";

      const updated = updateTauriConfJson(original, "2.0.0");
      const parsed = JSON.parse(updated);
      expect(parsed.version).toBe("2.0.0");
      expect(parsed.productName).toBe("TickReplay");
    });
  });

  describe("updateCargoToml", () => {
    it("should update [package] version without touching dependencies", () => {
      const original = `[package]
name = "tick-replay"
version = "1.0.0"
description = "A Tauri App"
authors = ["you"]
edition = "2021"

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
serde_json = "1"
`;

      const updated = updateCargoToml(original, "1.0.1");
      expect(updated).toContain('version = "1.0.1"');
      // Verify dependencies were NOT touched
      expect(updated).toContain('tauri = { version = "2", features = [] }');
      expect(updated).toContain('tauri-plugin-opener = "2"');
      expect(updated).toContain('serde_json = "1"');
    });
  });

  describe("updateCargoLock", () => {
    it("should update tick-replay version in Cargo.lock", () => {
      const original = `[[package]]
name = "syn"
version = "2.0.117"

[[package]]
name = "tick-replay"
version = "1.0.0"
dependencies = [
 "tauri",
]
`;

      const updated = updateCargoLock(original, "1.0.1");
      expect(updated).toContain('name = "tick-replay"\nversion = "1.0.1"');
      expect(updated).toContain('name = "syn"\nversion = "2.0.117"');
    });
  });

  describe("updateReadme", () => {
    it("should update installer filename in README.md", () => {
      const original = `* **インストーラーファイル (.exe)**:\n  \`src-tauri/target/release/bundle/nsis/TickReplay_1.0.0_x64-setup.exe\``;
      const updated = updateReadme(original, "1.0.1");
      expect(updated).toContain("TickReplay_1.0.1_x64-setup.exe");
    });
  });
});
