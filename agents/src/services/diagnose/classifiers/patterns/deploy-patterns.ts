import type { PatternRule } from './types.js';

export const DEPLOY_PATTERNS: PatternRule[] = [
  {
    id: 'port-binding',
    category: 'Port Binding',
    severity: 'error',
    confidence: 95,
    pattern: /EADDRINUSE/,
    getRecommendation: () =>
      'Port already in use. Make sure your app binds to process.env.PORT and no other process is holding the port',
  },
  {
    id: 'health-check-timeout',
    category: 'Health Check Timeout',
    severity: 'error',
    confidence: 85,
    pattern: /health[\s-]?check.*timeout/i,
    getRecommendation: () =>
      'App failed to start within the health check window. Inspect startup logs and ensure the server binds to process.env.PORT before the timeout',
  },
];
