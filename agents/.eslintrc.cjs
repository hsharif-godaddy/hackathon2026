module.exports = {
  extends: ["@airo/eslint-config"],
  overrides: [
    {
      // Template files are not part of the agents tsconfig
      files: ["src/skills/*/templates/**/*"],
      parserOptions: {
        project: null,
      },
      rules: {
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unsafe-member-access": "off",
        "@typescript-eslint/no-unsafe-call": "off",
        "@typescript-eslint/no-unsafe-return": "off",
        "@typescript-eslint/no-unsafe-argument": "off",
        "@typescript-eslint/prefer-nullish-coalescing": "off",
        "@typescript-eslint/prefer-optional-chain": "off",
      },
    },
  ],
};
