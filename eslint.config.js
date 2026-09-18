import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.git/**",
      "**/.omc/**",
      "**/.claude/**",
      "**/coverage/**",
      "**/__tests__/**",
      "**/tests/**",
      "__tests__/**",
      "tests/**",
      "**/*.config.js",
      "**/*.config.ts",
      "**/vite.config.ts",
      "**/vitest.config.ts",
      "**/tailwind.config.ts",
      "**/drizzle.config.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    rules: {
      // React rules
      "react/jsx-uses-react": "off",
      "react/react-in-jsx-scope": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // TypeScript rules
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-empty-interface": "off",

      // General rules
      "no-console": "off",
      "prefer-const": "warn",
      "no-var": "error",
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  {
    // schema.pg.ts is a server-only runtime mirror. Importing it from the client
    // would pull drizzle-orm/pg-core into the browser bundle for no reason.
    files: ["client/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/schema.pg", "**/schema.pg.js"],
              message:
                "shared/schema.pg.ts is server-only. Import types and Zod schemas from @shared/schema.",
            },
          ],
        },
      ],
    },
  },
  {
    // Table VALUES must come from server/db/tables.ts so queries are built
    // against the active dialect's tables. Types may still come from the
    // canonical schema, which is why this bans names rather than the module.
    files: ["server/**/*.ts"],
    ignores: ["server/db/**", "server/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "../shared/schema.js",
              importNames: [
                "apiKeys",
                "downloaders",
                "gameDownloads",
                "gameFiles",
                "games",
                "importTaskItems",
                "importTasks",
                "indexers",
                "notifications",
                "pathMappings",
                "platformMappings",
                "releaseBlacklist",
                "rootFolders",
                "rssFeedItems",
                "rssFeeds",
                "systemConfig",
                "userSettings",
                "users",
                "xrelNotifiedReleases",
              ],
              message:
                "Import table values from ./db/tables.js so queries target the active dialect. Types and Zod schemas may still come from ../shared/schema.js.",
            },
          ],
        },
      ],
    },
  },
  prettierConfig
);
