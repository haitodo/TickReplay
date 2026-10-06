import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * 導入方針 (ラチェット方式):
 *   既存コードに違反があるルールは warn に留め、解消したぶんから error へ昇格させる。
 *   各 warn には現在の違反件数を添えてあるので、それが 0 になったら error に変える。
 *   依存配列 (exhaustive-deps) の一括修正は挙動を変えうるため別作業とする。
 */
export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "src-tauri/**", "coverage/**"],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn", // 既存14件

      // TypeScript が同等の検査を行うため基底ルールは無効化する
      // (無効化しないと同じ問題が二重に報告される)
      "no-unused-vars": "off",
      "no-undef": "off",

      "@typescript-eslint/no-explicit-any": "warn", // 既存16件
      "@typescript-eslint/no-unused-vars": ["warn", {
        varsIgnorePattern: "^_",
        argsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
      "no-empty": "error",
      "prefer-const": "error",
      "no-useless-assignment": "error",
      "@typescript-eslint/no-empty-object-type": "error",
    },
  },

  {
    files: ["*.config.{js,ts}", "scripts/**/*.{js,ts}", "vite.config.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
);
