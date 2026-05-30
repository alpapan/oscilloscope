import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "node_modules/**",
      "www/**",
      "android/**",
      "dist/**",
      "test-results/**",
      ".pixi/**",
      "eslint.config.js",
    ],
  },
  // pixi-shim: ES module (imported via importmap in browser)
  {
    files: ["pixi-shim.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: globals.browser,
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },
  // Playwright E2E tests (.spec.js): browser context + Playwright
  {
    files: ["tests/**/*.spec.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "commonjs",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      ...js.configs.recommended.rules,
      // Allow underscore prefix for intentionally unused catch params
      // The underscore prefix (_e, _err) is the JavaScript convention for
      // intentionally unused function parameters. This codebase uses it
      // consistently for catch clauses where the error is not needed.
      "no-unused-vars": "off",
      // Allow empty blocks in catch statements with inline comments
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  // Unit tests (.test.js): Node CommonJS only
  {
    files: ["tests/**/*.test.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      ...js.configs.recommended.rules,
      // Allow underscore prefix for intentionally unused catch params
      // The underscore prefix (_e, _err) is the JavaScript convention for
      // intentionally unused function parameters. This codebase uses it
      // consistently for catch clauses where the error is not needed.
      "no-unused-vars": "off",
    },
  },
  // Electron: Node CommonJS
  {
    files: ["electron/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      ...js.configs.recommended.rules,
      // Allow underscore prefix for intentionally unused catch params
      // The underscore prefix (_e, _err) is the JavaScript convention for
      // intentionally unused function parameters. This codebase uses it
      // consistently for catch clauses where the error is not needed.
      "no-unused-vars": "off",
      // Allow empty blocks in catch statements with inline comments
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  // Scripts: Node CommonJS
  {
    files: ["scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      ...js.configs.recommended.rules,
      // Allow underscore prefix for intentionally unused catch params
      // The underscore prefix (_e, _err) is the JavaScript convention for
      // intentionally unused function parameters. This codebase uses it
      // consistently for catch clauses where the error is not needed.
      "no-unused-vars": "off",
      // Allow empty blocks in catch statements with inline comments
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  // Playwright config: Node CommonJS
  {
    files: ["playwright.config.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },
  // Root .js files (not in tests/electron/scripts): browser + Node
  // These export via typeof module for dual CommonJS/browser pattern
  {
    files: [
      "*.js",
    ],
    // Exclude specific patterns that have their own configs
    ignores: [
      "pixi-shim.js",
      "playwright.config.js",
    ],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "script",
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      // Disable no-undef for globals declared in types/globals.d.ts
      "no-undef": "off",
      // Allow underscore prefix for intentionally unused catch params (_e, _err)
      // The underscore prefix (_e, _err) is the JavaScript convention for
      // intentionally unused function parameters. This codebase uses it
      // consistently for catch clauses where the error is not needed.
      "no-unused-vars": "off",
      // Allow empty blocks in catch statements with inline comments
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];
