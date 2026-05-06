import { PAAS_BUILD_PATTERNS } from './build-patterns.js';
import { PAAS_DEPLOY_PATTERNS } from './deploy-patterns.js';
import { PAAS_RUNTIME_PATTERNS } from './runtime-patterns.js';

export type { PatternRule } from './types.js';
export { PAAS_BUILD_PATTERNS, PAAS_DEPLOY_PATTERNS, PAAS_RUNTIME_PATTERNS };

/**
 * Concatenation of all PaaS-tuned pattern bundles. This is what PaaSDiagnoseService
 * wires into PatternClassifier today. When AAB ships, it gets its own AAB_ALL_PATTERNS.
 */
export const PAAS_ALL_PATTERNS = [
  ...PAAS_BUILD_PATTERNS,
  ...PAAS_DEPLOY_PATTERNS,
  ...PAAS_RUNTIME_PATTERNS,
];
