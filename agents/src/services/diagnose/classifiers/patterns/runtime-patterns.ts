import type { PatternRule } from './types.js';

export const RUNTIME_PATTERNS: PatternRule[] = [
  {
    id: 'heap-oom',
    category: 'Memory Exhaustion',
    severity: 'error',
    confidence: 95,
    pattern: /JavaScript heap out of memory|FATAL ERROR.*Allocation failed/i,
    getRecommendation: () =>
      'Increase Node.js memory: add NODE_OPTIONS=--max-old-space-size=4096 to your build or start script',
  },
  {
    id: 'env-var-missing',
    category: 'Env Var Missing',
    severity: 'error',
    confidence: 80,
    pattern: /process\.env\.([A-Z0-9_]+)\s+is\s+undefined/,
    getRecommendation: (match) =>
      `Set required environment variable: ${match[1]} (configure via PaaS secrets or .env)`,
    getIdSuffix: (match) => match[1] ?? '',
  },
];
