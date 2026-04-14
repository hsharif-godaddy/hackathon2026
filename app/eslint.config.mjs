import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import airoConfig from "@airo/eslint-config";

const config = [
  // Global ignores
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
      "next-env.d.ts",
      "gasket-data.js",
      "src/generated/**",
      "prisma/generated/**",
    ],
  },

  // Shared base config (native flat config)
  ...airoConfig,

  // Next.js configs (native flat config from eslint-config-next@16)
  ...nextCoreWebVitals,
  ...nextTypescript,

  // App-level overrides
  {
    plugins: {
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      "react/display-name": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/exhaustive-deps": "off",
      // React Compiler rules from eslint-plugin-react-hooks v5 (bundled with
      // eslint-config-next@16). Disabled until the codebase is Compiler-ready.
      "react-hooks/component-hook-factories": "off",
      "react-hooks/config": "off",
      "react-hooks/error-boundaries": "off",
      "react-hooks/gating": "off",
      "react-hooks/globals": "off",
      "react-hooks/immutability": "off",
      "react-hooks/incompatible-library": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/set-state-in-render": "off",
      "react-hooks/static-components": "off",
      "react-hooks/unsupported-syntax": "off",
      "react-hooks/use-memo": "off",
      "simple-import-sort/imports": [
        "warn",
        {
          groups: [
            ["^\\u0000"],
            ["^node:"],
            ["^[a-z]", "^@(?!/)[a-z]"],
            ["^@/", "^", "^\\.\\."],
          ],
        },
      ],
      "simple-import-sort/exports": "warn",
    },
  },
];

export default config;
