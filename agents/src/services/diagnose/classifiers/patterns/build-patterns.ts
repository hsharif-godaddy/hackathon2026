import type { PatternRule } from './types.js';

/**
 * PaaS (Node.js Hosting) build-time failure patterns. Recommendation wording is
 * tuned to the PaaS environment (e.g. secrets model, build scripts). When AAB
 * diagnose adds its own ruleset, add a sibling AAB_BUILD_PATTERNS rather than
 * mutating these.
 */
export const PAAS_BUILD_PATTERNS: PatternRule[] = [
  {
    id: 'missing-module',
    category: 'Missing Dependency',
    severity: 'error',
    confidence: 95,
    pattern: /Cannot find module ['"]([^'"]+)['"]/,
    getRecommendation: (match) => `Install missing package: npm install ${match[1]}`,
    getIdSuffix: (match) => match[1] ?? '',
  },
  {
    id: 'ts-error',
    category: 'TypeScript Error',
    severity: 'error',
    confidence: 90,
    pattern: /error TS(\d+):/,
    getRecommendation: () => 'Fix TypeScript compilation errors in your source code',
    getIdSuffix: (match) => match[1] ?? '',
  },
  {
    id: 'build-script-missing',
    category: 'Build Script Missing',
    severity: 'error',
    confidence: 95,
    pattern: /missing script:\s*build/i,
    getRecommendation: () => 'Add a "build" script to package.json',
  },
  {
    id: 'dist-missing',
    category: 'Dist Folder Missing',
    severity: 'error',
    confidence: 90,
    pattern: /dist\/?\s+folder not found|ENOENT.*dist\//i,
    getRecommendation: () => 'Ensure your build command produces a dist/ directory with server output',
  },
  // esbuild (used by vite's config loader and bundler) prints "Could not
  // resolve" when it can't find an imported module. Distinct from Node's
  // "Cannot find module" — esbuild does not auto-add .ts to extensionless
  // imports in config files, which is what bites customer zip uploads whose
  // vite.config.ts imports local .ts plugins relatively.
  {
    id: 'esbuild-resolve-failure',
    category: 'Missing Dependency',
    severity: 'error',
    confidence: 95,
    pattern: /Could not resolve ['"]([^'"]+)['"]/,
    getRecommendation: (match) =>
      `esbuild could not resolve '${match[1]}'. If it's a package, install it (npm install ${match[1]}). If it's a relative path, verify the file exists in your upload and that the extension is resolvable (esbuild does not auto-add '.ts' for config imports).`,
    getIdSuffix: (match) => match[1] ?? '',
  },
  {
    id: 'vite-config-load-failure',
    category: 'Vite Config Error',
    severity: 'error',
    confidence: 90,
    pattern: /failed to load config from .*\bvite\.config\.[tj]s\b/i,
    getRecommendation: () =>
      'Vite could not load its config file. Check the preceding "Could not resolve" or "SyntaxError" lines for the specific cause.',
  },
  {
    id: 'esbuild-build-failed',
    category: 'Build Failed',
    severity: 'error',
    confidence: 85,
    pattern: /Build failed with (\d+) errors?/,
    getRecommendation: (match) =>
      `esbuild reported ${match[1]} error(s). Review the "Could not resolve" or per-file error lines immediately above this summary.`,
    getIdSuffix: (match) => match[1] ?? '',
  },
];
