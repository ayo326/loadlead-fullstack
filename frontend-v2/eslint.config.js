// ESLint 9 flat-config for frontend-v2. Minimal by design: the only
// rule we strictly need right now is react/jsx-no-undef, which would
// have caught the "<Stat> is not defined" and "<Users> is not defined"
// runtime errors we hit during the IAM-6/7 rollout. The TypeScript
// compiler does not always catch these (JSX compiles to
// React.createElement(Stat, ...) and the identifier is then looked
// up at runtime from module scope).
//
// We deliberately do not enable the full ESLint recommended ruleset
// here. The codebase has not been linted under it before, so flipping
// it on would surface hundreds of pre-existing findings and bury the
// signal we actually want. Pin one rule, broaden later.

import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";
import reactPlugin from "eslint-plugin-react";
import globals from "globals";

export default [
  {
    ignores: ["dist/**", "dist-admin/**", "node_modules/**", "build/**"],
  },
  {
    files: ["src/**/*.{ts,tsx,js,jsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: { ...globals.browser, ...globals.es2021, JSX: "readonly" },
    },
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooks,
    },
    settings: { react: { version: "detect" } },
    rules: {
      // Catches <Stat> / <Users> bugs at lint time, before the build
      // strips them into runtime ReferenceErrors.
      "react/jsx-no-undef": "error",
      // Keep react-hooks recommended (rules of hooks + deps array).
      ...reactHooks.configs.recommended.rules,
    },
  },
];
