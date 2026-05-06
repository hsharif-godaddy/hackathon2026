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
];
