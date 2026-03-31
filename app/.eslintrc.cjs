module.exports = {
  extends: ["@airo/eslint-config", "next/core-web-vitals", "next/typescript"],
  plugins: ["simple-import-sort"],
  rules: {
    "react/display-name": "off",
    // next/typescript preset overrides shared config, so we must override it here
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "react-hooks/exhaustive-deps": "off",
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
