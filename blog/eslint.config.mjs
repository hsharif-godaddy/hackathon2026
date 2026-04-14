import airoConfig from "@airo/eslint-config";
import eslintPluginAstro from "eslint-plugin-astro";

export default [
  { ignores: ["dist/**", "node_modules/**"] },
  ...airoConfig,
  ...eslintPluginAstro.configs.recommended,
];
