/**
 * TickReplay Version Bump Script
 * 
 * アプリのバージョン（package.json, package-lock.json, tauri.conf.json,
 * Cargo.toml, Cargo.lock, README.md）を一括で安全に更新するCLIスクリプト。
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..");

/**
 * Semver形式の文字列をパースする
 * @param {string} version
 * @returns {{ major: number, minor: number, patch: number, prerelease?: string, build?: string } | null}
 */
export function parseSemver(version) {
  if (!version || typeof version !== "string") return null;
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || undefined,
    build: match[5] || undefined,
  };
}

/**
 * 有効なSemver形式かどうかを判定する
 * @param {string} version
 * @returns {boolean}
 */
export function isValidSemver(version) {
  return parseSemver(version) !== null;
}

/**
 * 指定されたインクリメント種別に応じてバージョン番号を計算する
 * @param {string} currentVersion
 * @param {"patch" | "minor" | "major" | "prerelease" | "prepatch" | "preminor" | "premajor"} bumpType
 * @param {string} [preid="beta"]
 * @returns {string}
 */
export function incrementVersion(currentVersion, bumpType, preid = "beta") {
  const parsed = parseSemver(currentVersion);
  if (!parsed) {
    throw new Error(`不正なバージョン形式です: "${currentVersion}"`);
  }

  const { major, minor, patch, prerelease } = parsed;

  switch (bumpType) {
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "major":
      return `${major + 1}.0.0`;
    case "prepatch":
      return `${major}.${minor}.${patch + 1}-${preid}.0`;
    case "preminor":
      return `${major}.${minor + 1}.0-${preid}.0`;
    case "premajor":
      return `${major + 1}.0.0-${preid}.0`;
    case "prerelease": {
      if (!prerelease) {
        return `${major}.${minor}.${patch + 1}-${preid}.0`;
      }
      // すでに prerelease が存在する場合 (例: beta.0 -> beta.1 または alpha.3 -> alpha.4)
      const preMatch = prerelease.match(/^(.*?)(\d+)$/);
      if (preMatch) {
        const prefix = preMatch[1];
        const num = parseInt(preMatch[2], 10) + 1;
        return `${major}.${minor}.${patch}-${prefix}${num}`;
      }
      return `${major}.${minor}.${patch}-${prerelease}.1`;
    }
    default:
      throw new Error(`未知のバンプタイプです: "${bumpType}"`);
  }
}

/**
 * package.json の内容を更新
 * @param {string} content
 * @param {string} newVersion
 * @returns {string}
 */
export function updatePackageJson(content, newVersion) {
  const json = JSON.parse(content);
  json.version = newVersion;
  return JSON.stringify(json, null, 2) + "\n";
}

/**
 * package-lock.json の内容を更新
 * @param {string} content
 * @param {string} newVersion
 * @returns {string}
 */
export function updatePackageLockJson(content, newVersion) {
  const json = JSON.parse(content);
  json.version = newVersion;
  if (json.packages && json.packages[""]) {
    json.packages[""].version = newVersion;
  }
  return JSON.stringify(json, null, 2) + "\n";
}

/**
 * tauri.conf.json の内容を更新
 * @param {string} content
 * @param {string} newVersion
 * @returns {string}
 */
export function updateTauriConfJson(content, newVersion) {
  const json = JSON.parse(content);
  json.version = newVersion;
  return JSON.stringify(json, null, 2) + "\n";
}

/**
 * Cargo.toml の [package] セクションの version のみを更新
 * @param {string} content
 * @param {string} newVersion
 * @returns {string}
 */
export function updateCargoToml(content, newVersion) {
  const packageRegex = /(^\[package\][\s\S]*?\nversion\s*=\s*)"[^"]*"/m;
  if (!packageRegex.test(content)) {
    throw new Error("Cargo.toml 内に [package] の version フィールドが見つかりませんでした。");
  }
  return content.replace(packageRegex, `$1"${newVersion}"`);
}

/**
 * Cargo.lock の tick-replay パッケージの version を更新
 * @param {string} content
 * @param {string} newVersion
 * @returns {string}
 */
export function updateCargoLock(content, newVersion) {
  const lockRegex = /(^\[\[package\]\]\r?\nname = "tick-replay"\r?\nversion = )"[^"]*"/m;
  if (!lockRegex.test(content)) {
    return content; // Cargo.lock 内に対象がなければスキップ
  }
  return content.replace(lockRegex, `$1"${newVersion}"`);
}

/**
 * README.md のインストーラーファイル名例を更新
 * @param {string} content
 * @param {string} newVersion
 * @returns {string}
 */
export function updateReadme(content, newVersion) {
  const readmeRegex = /(TickReplay_)\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(_x64-setup\.exe)/g;
  return content.replace(readmeRegex, `$1${newVersion}$2`);
}

/**
 * バージョン更新処理を実行
 * @param {{ typeOrVersion?: string, dryRun?: boolean, syncOnly?: boolean, projectRoot?: string }} options
 * @returns {{ currentVersion: string, nextVersion: string, modifiedFiles: string[] }}
 */
export function performVersionBump(options = {}) {
  const root = options.projectRoot || DEFAULT_PROJECT_ROOT;
  const packageJsonPath = path.join(root, "package.json");
  const packageLockJsonPath = path.join(root, "package-lock.json");
  const tauriConfPath = path.join(root, "src-tauri", "tauri.conf.json");
  const cargoTomlPath = path.join(root, "src-tauri", "Cargo.toml");
  const cargoLockPath = path.join(root, "src-tauri", "Cargo.lock");
  const readmePath = path.join(root, "README.md");

  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`package.json が見つかりません: ${packageJsonPath}`);
  }

  const pkgRaw = fs.readFileSync(packageJsonPath, "utf-8");
  const pkg = JSON.parse(pkgRaw);
  const currentVersion = pkg.version;

  let nextVersion;

  if (options.syncOnly) {
    // --sync-only モード: すでに package.json が更新されている（例: npm version 実行時）
    nextVersion = currentVersion;
  } else if (!options.typeOrVersion) {
    throw new Error("更新後のバージョンまたは更新種別（patch / minor / major）を指定してください。");
  } else {
    const rawArg = options.typeOrVersion.trim().replace(/^v/, "");
    if (["patch", "minor", "major", "prerelease", "prepatch", "preminor", "premajor"].includes(rawArg)) {
      nextVersion = incrementVersion(currentVersion, rawArg);
    } else if (isValidSemver(rawArg)) {
      nextVersion = rawArg;
    } else {
      throw new Error(`無効なバージョンまたは指定です: "${options.typeOrVersion}" (例: patch, minor, major, 1.2.3)`);
    }
  }

  const modifiedFiles = [];

  // 1. package.json
  if (!options.syncOnly) {
    const newPkgContent = updatePackageJson(pkgRaw, nextVersion);
    if (newPkgContent !== pkgRaw) {
      modifiedFiles.push("package.json");
      if (!options.dryRun) fs.writeFileSync(packageJsonPath, newPkgContent, "utf-8");
    }
  }

  // 2. package-lock.json
  if (fs.existsSync(packageLockJsonPath)) {
    const lockRaw = fs.readFileSync(packageLockJsonPath, "utf-8");
    const newLockContent = updatePackageLockJson(lockRaw, nextVersion);
    if (newLockContent !== lockRaw) {
      modifiedFiles.push("package-lock.json");
      if (!options.dryRun) fs.writeFileSync(packageLockJsonPath, newLockContent, "utf-8");
    }
  }

  // 3. src-tauri/tauri.conf.json
  if (fs.existsSync(tauriConfPath)) {
    const tauriRaw = fs.readFileSync(tauriConfPath, "utf-8");
    const newTauriContent = updateTauriConfJson(tauriRaw, nextVersion);
    if (newTauriContent !== tauriRaw) {
      modifiedFiles.push("src-tauri/tauri.conf.json");
      if (!options.dryRun) fs.writeFileSync(tauriConfPath, newTauriContent, "utf-8");
    }
  }

  // 4. src-tauri/Cargo.toml
  if (fs.existsSync(cargoTomlPath)) {
    const cargoRaw = fs.readFileSync(cargoTomlPath, "utf-8");
    const newCargoContent = updateCargoToml(cargoRaw, nextVersion);
    if (newCargoContent !== cargoRaw) {
      modifiedFiles.push("src-tauri/Cargo.toml");
      if (!options.dryRun) fs.writeFileSync(cargoTomlPath, newCargoContent, "utf-8");
    }
  }

  // 5. src-tauri/Cargo.lock
  if (fs.existsSync(cargoLockPath)) {
    const cargoLockRaw = fs.readFileSync(cargoLockPath, "utf-8");
    const newCargoLockContent = updateCargoLock(cargoLockRaw, nextVersion);
    if (newCargoLockContent !== cargoLockRaw) {
      modifiedFiles.push("src-tauri/Cargo.lock");
      if (!options.dryRun) fs.writeFileSync(cargoLockPath, newCargoLockContent, "utf-8");
    }
  }

  // 6. README.md
  if (fs.existsSync(readmePath)) {
    const readmeRaw = fs.readFileSync(readmePath, "utf-8");
    const newReadmeContent = updateReadme(readmeRaw, nextVersion);
    if (newReadmeContent !== readmeRaw) {
      modifiedFiles.push("README.md");
      if (!options.dryRun) fs.writeFileSync(readmePath, newReadmeContent, "utf-8");
    }
  }

  return {
    currentVersion,
    nextVersion,
    modifiedFiles,
  };
}

/**
 * 対話形式のプロンプト
 * @param {string} currentVersion
 * @returns {Promise<string | null>}
 */
async function runInteractive(currentVersion) {
  const patchVer = incrementVersion(currentVersion, "patch");
  const minorVer = incrementVersion(currentVersion, "minor");
  const majorVer = incrementVersion(currentVersion, "major");

  console.log("\n==========================================");
  console.log(`  TickReplay バージョン更新ツール`);
  console.log(`  現在のバージョン: v${currentVersion}`);
  console.log("==========================================");
  console.log(`  1) patch     ->  v${patchVer} (バグ修正・小改善)`);
  console.log(`  2) minor     ->  v${minorVer} (後方互換のある機能追加)`);
  console.log(`  3) major     ->  v${majorVer} (互換性を破る大きな変更)`);
  console.log(`  4) custom    ->  直接バージョン番号を入力`);
  console.log(`  5) cancel    ->  キャンセルして終了`);
  console.log("==========================================");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (promptText) => {
    return new Promise((resolve) => rl.question(promptText, resolve));
  };

  try {
    const ans = (await question("選択してください (1-5): ")).trim();
    if (ans === "1" || ans.toLowerCase() === "patch") {
      return patchVer;
    } else if (ans === "2" || ans.toLowerCase() === "minor") {
      return minorVer;
    } else if (ans === "3" || ans.toLowerCase() === "major") {
      return majorVer;
    } else if (ans === "4" || ans.toLowerCase() === "custom") {
      const customVer = (await question("新しいバージョン番号を入力 (例: 1.2.3): ")).trim();
      if (!isValidSemver(customVer)) {
        console.error(`❌ 無効なバージョン形式です: "${customVer}"`);
        return null;
      }
      return customVer.replace(/^v/, "");
    } else {
      console.log("キャンセルしました。");
      return null;
    }
  } finally {
    rl.close();
  }
}

/**
 * ヘルプメッセージを表示
 */
function showHelp() {
  console.log(`
使用方法:
  npm run bump [patch | minor | major | <version>] [options]
  node scripts/bump-version.js [patch | minor | major | <version>] [options]

オプション:
  --dry-run       ファイル変更を行わず、更新対象と新バージョンをプレビューします
  --sync-only     package.json のバージョンに合わせて他のファイルを同期します
  --help, -h      このヘルプを表示します

例:
  npm run bump:patch       # パッチバージョンを更新 (例: 1.0.0 -> 1.0.1)
  npm run bump:minor       # マイナーバージョンを更新 (例: 1.0.0 -> 1.1.0)
  npm run bump:major       # メジャーバージョンを更新 (例: 1.0.0 -> 2.0.0)
  npm run bump 1.2.3       # バージョン 1.2.3 に設定
  npm run bump             # 対話メニューを表示して選択
  npm version patch        # npm標準コマンド（tauri.conf.json等も自動同期）
`);
}

/**
 * メイン実行処理
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    showHelp();
    process.exit(0);
  }

  const dryRun = args.includes("--dry-run");
  const syncOnly = args.includes("--sync-only");

  // オプション以外の引数を取得
  const positionalArgs = args.filter((arg) => !arg.startsWith("--") && !arg.startsWith("-"));

  let target = positionalArgs[0] || null;

  const packageJsonPath = path.join(DEFAULT_PROJECT_ROOT, "package.json");
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  const currentVersion = pkg.version;

  if (!target && !syncOnly) {
    // 対話モード
    if (process.stdin.isTTY) {
      target = await runInteractive(currentVersion);
      if (!target) {
        process.exit(0);
      }
    } else {
      console.error("❌ エラー: バージョンまたは種別（patch, minor, major）を指定してください。");
      showHelp();
      process.exit(1);
    }
  }

  try {
    const result = performVersionBump({
      typeOrVersion: target || undefined,
      dryRun,
      syncOnly,
    });

    console.log("\n==========================================");
    if (dryRun) {
      console.log("🔍 [DRY RUN] 変更プレビュー (ファイルは書き換えられていません)");
    } else if (syncOnly) {
      console.log(`🔄 ファイルバージョン同期完了: v${result.nextVersion}`);
    } else {
      console.log(`✨ バージョン更新完了: v${result.currentVersion} -> v${result.nextVersion}`);
    }
    console.log("==========================================");

    if (result.modifiedFiles.length > 0) {
      console.log("更新対象ファイル:");
      for (const file of result.modifiedFiles) {
        console.log(`  ✓ ${file}`);
      }
    } else {
      console.log("変更されたファイルはありません (すでに同期済みです)。");
    }

    console.log("\n次のステップ例:");
    console.log("  1. git add -A && git commit -m \"chore: bump version to v" + result.nextVersion + "\"");
    console.log("  2. pnpm tauri build");
    console.log("==========================================\n");
  } catch (err) {
    console.error(`\n❌ エラー: ${err.message}\n`);
    process.exit(1);
  }
}

// CLIから直接実行された場合のみ main() を呼び出す
if (process.argv[1] === __filename || process.argv[1] === path.resolve(__filename)) {
  main();
}
