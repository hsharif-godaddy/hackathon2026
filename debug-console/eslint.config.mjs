import airoConfig from "@airo/eslint-config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default [
  { ignores: ["node_modules/**", "dist/**", ".next/**"] },
  ...airoConfig,
  ...nextCoreWebVitals,
  {
    rules: {
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
      "@next/next/no-html-link-for-pages": "off",
    },
  },
];
