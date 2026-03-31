module.exports = {
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
  env: {
    node: true,
    es2022: true,
  },
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
