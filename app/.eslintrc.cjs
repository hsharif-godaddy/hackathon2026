module.exports = {
  extends: ["@airo/eslint-config", "next/core-web-vitals", "next/typescript"],
  plugins: ["simple-import-sort"],
  rules: {
    "react/display-name": "off",
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
    // next/typescript sets no-explicit-any to error; keep at warn
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_|^error$|^e$",
      },
    ],
  },
  ignorePatterns: [
    "node_modules/**",
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "next-env.d.ts",
    "src/generated/**",
    "prisma/generated/**",
  ],
};
