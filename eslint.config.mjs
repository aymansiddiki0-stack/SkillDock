import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  {
    files: ["build.mjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly" } }
  },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "no-restricted-globals": ["error", "eval"],
      "no-eval": "error",
      "no-implied-eval": "error"
    }
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "no-console": "off"
    }
  }
);
