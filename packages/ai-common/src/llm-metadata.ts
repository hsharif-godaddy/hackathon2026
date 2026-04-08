import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * LiteLLM metadata structure for cost tracking and attribution
 */
export interface LitellmMetadata {
  user?: string       // subscriptionId for budget tracking
  tags?: string[]     // customerId and appId for tagging/filtering
  /** Internal fields for grant fallback - NOT sent to GoCode */
  _internal?: {
    socketId?: string
    customerId?: string
  }
  /** BMS budget ID for GoCode cost reporting (HTTP header, not litellm_metadata body) */
  budgetId?: string
  /** BMS session ID for GoCode cost reporting (HTTP header, not litellm_metadata body) */
  budgetSessionId?: string
}

/**
 * AsyncLocalStorage context for per-request LLM metadata
 * Each LLM request can have isolated metadata for accurate cost tracking and attribution
 * This prevents cross-tenant metadata leakage in concurrent request scenarios
 */
export const llmMetadataContext = new AsyncLocalStorage<LitellmMetadata>()
