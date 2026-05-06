import type { PatternRule } from './types.js';

/**
 * PaaS (Node.js Hosting) deploy-time failure patterns. Recommendation wording is
 * tuned to the PaaS environment. When AAB diagnose adds its own ruleset, add a
 * sibling AAB_DEPLOY_PATTERNS rather than mutating these.
 */
export const PAAS_DEPLOY_PATTERNS: PatternRule[] = [
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
