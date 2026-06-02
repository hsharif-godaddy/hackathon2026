import airoConfig from "@airo/eslint-config";

export default [
  // Storybook stories are dev-only fixtures; they reference react-hooks rules
  // via inline eslint-disable directives, but the airo config doesn't register
  // the react-hooks plugin. Skip them rather than pull in another plugin just
  // for fixtures.
  { ignores: ["dist/**", "node_modules/**", "src/**/*.stories.tsx", "storybook-static/**"] },
  ...airoConfig,
];
