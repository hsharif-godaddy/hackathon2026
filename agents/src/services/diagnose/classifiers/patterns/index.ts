import { BUILD_PATTERNS } from './build-patterns.js';
import { DEPLOY_PATTERNS } from './deploy-patterns.js';
import { RUNTIME_PATTERNS } from './runtime-patterns.js';

export type { PatternRule } from './types.js';
export { BUILD_PATTERNS, DEPLOY_PATTERNS, RUNTIME_PATTERNS };

export const ALL_PATTERNS = [...BUILD_PATTERNS, ...DEPLOY_PATTERNS, ...RUNTIME_PATTERNS];
