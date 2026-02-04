/**
 * Browser-safe grants exports
 *
 * Use this subpath (@airo/ai-lib/grants/client) in frontend code.
 * The main @airo/ai-lib/grants export includes server-only code
 * that uses Node.js APIs not available in browsers.
 */

// Types (browser-safe)
export type { CreditGrant, GrantContextPayload } from './types.js'
export { GrantType, GrantFinalState, LlmCallSource, GrantErrorCode } from './types.js'

// Grant Manager (browser-safe - pure functions, no Node.js dependencies)
export { GrantManager, GrantUnusableReason } from './grant-manager.js'
