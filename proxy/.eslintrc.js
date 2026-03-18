module.exports = {
  extends: ["@airo/eslint-config"],
  rules: {
    // proxy/ already had these as errors — keep them stricter than baseline
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/prefer-nullish-coalescing": "error",
    "@typescript-eslint/prefer-optional-chain": "error",
    eqeqeq: ["error", "always"],
    curly: ["error", "all"],
    "no-script-url": "error",
    "no-sync": "warn",
    "no-buffer-constructor": "error",
  },
};
