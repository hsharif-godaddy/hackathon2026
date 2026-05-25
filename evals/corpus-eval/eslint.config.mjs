import airoConfig from "@airo/eslint-config";

export default [
  { ignores: ["dist/**", "node_modules/**"] },
  ...airoConfig,
];
