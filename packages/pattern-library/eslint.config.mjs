import airoConfig from "@airo/eslint-config";

export default [
  // Storybook stories are dev-only fixtures; they reference react-hooks rules
  // via inline eslint-disable directives, but the airo config doesn't register
  // the react-hooks plugin. Skip them rather than pull in another plugin just
  // for fixtures.
  // *.figma.tsx are Code Connect mappings consumed only by the @figma/code-connect
  // CLI (which is intentionally not installed here). They import '@figma/code-connect'
  // and are never built, linted, or published as part of this package.
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src/**/*.stories.tsx",
      "src/**/*.figma.tsx",
      "storybook-static/**",
    ],
  },
  ...airoConfig,
];
