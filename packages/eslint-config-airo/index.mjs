import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

// Exported separately for consumers that already register typescript-eslint
// (e.g. eslint-config-next/typescript). Using the default export in that context
// causes "Cannot redefine plugin @typescript-eslint" when module instances differ.
export const airoRules = {
  name: "airo/rules",
  rules: {
    // Disabled rules (violations exist but not blocking)
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "no-sync": "off",

    // Security guardrails (not in recommended, but zero violations)
    "no-eval": "error",
    "no-implied-eval": "error",
    "no-new-func": "error",
    "no-script-url": "error",

    // Downgrade eslint:recommended errors to warnings (violations remain)
    "no-empty": "warn",
    "no-self-assign": "warn",

    // TypeScript handles these
    "no-undef": "off",
  },
};

export { eslintConfigPrettier as prettierConfig };

export default [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  airoRules,
];
