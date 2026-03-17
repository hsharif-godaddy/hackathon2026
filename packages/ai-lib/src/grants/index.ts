// Types (from @airo/shared)
export type { CreditGrant, GrantContextPayload } from '@airo/shared/grants'
export { GrantType, GrantFinalState } from '@airo/shared/grants'

// Grant Manager (from @airo/shared)
export { GrantManager, GrantUnusableReason } from '@airo/shared/grants'

// Session Manager (ai-lib specific — heavy deps on logger, AsyncLocalStorage)
export { GrantSessionManager, grantSessionManager, BudgetOverride } from './grant-session-manager.js'
export type { GrantRefreshCallback } from './grant-session-manager.js'

// Metadata Builder (ai-lib specific — depends on session manager, logger, LitellmMetadata)
export {
  buildLitellmMetadataFromContext,
  isGrantsExhausted,
  setAPM,
  LlmCallSource,
  GrantErrorCode,
} from './build-metadata.js'
export type { ExecutionContext, ExecutionContextMetadata } from './build-metadata.js'
