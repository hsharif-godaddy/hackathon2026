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
    // Downgrade @typescript-eslint/recommended errors to warnings (violations remain)
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": [
      "warn",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      },
    ],

    // Security guardrails (not in recommended, but zero violations)
    "no-eval": "error",
    "no-implied-eval": "error",
    "no-new-func": "error",
    "no-script-url": "error",
    "no-sync": "warn",

    // Downgrade eslint:recommended errors to warnings (violations remain)
    "no-empty": "warn",
    "no-constant-condition": "warn",
    "no-case-declarations": "warn",
    "no-useless-escape": "warn",
    "no-self-assign": "warn",

    // TypeScript handles these
    "no-undef": "off",
  },
  overrides: [
    {
      files: ["**/__tests__/**/*", "**/*.test.*", "**/*.spec.*"],
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
      },
    },
  ],
};
