/**
 * Grant types for LLM billing
 *
 * This is the SINGLE SOURCE OF TRUTH for grant types.
 */

export enum GrantType {
  PlanMonthly = 'plan-monthly',
  CreditPack = 'credit-pack',
}

export enum GrantFinalState {
  Consumed = 'consumed',
  Expired = 'expired',
}

/**
 * Source identifiers for LLM calls (used in metadata tags)
 */
export enum LlmCallSource {
  UserChat = 'user-chat',
  ToolQaAnalyze = 'tool:qa-analyze',
  ToolFontTheme = 'tool:font-theme',
  ToolColorScheme = 'tool:color-scheme',
  ToolVideoPrompt = 'tool:video-prompt',
  ToolVideoGenerate = 'tool:video-generate',
  ServiceNameSuggestion = 'service:name-suggestion',
  ServiceDomainSeedSuggestion = 'service:domain-seed-suggestion',
  ServiceSummarization = 'service:summarization',
  ServiceEmbeddings = 'service:embeddings',
  ServiceSeoAudit = 'service:seo-audit',
  AgentAssessment = 'agent:assessment',
}

/**
 * Error codes for grant-related failures
 * Frontend maps these to localized messages via GrantErrorCode → translation key
 */
export enum GrantErrorCode {
  AllGrantsExhausted = 'GRANTS_ALL_EXHAUSTED',
  NoGrantsAvailable = 'GRANTS_NONE_AVAILABLE',
  GrantFetchFailed = 'GRANTS_FETCH_FAILED',
  BudgetExceeded = 'BUDGET_EXCEEDED',
  NoActiveGrants = 'NO_ACTIVE_GRANTS',
  GrantExpired = 'GRANT_EXPIRED',
  GrantUnavailable = 'GRANT_UNAVAILABLE',
}

export interface CreditGrant {
  id: string
  subscriptionId: string
  type: GrantType
  llmBudgetUserId: string
  llmBudgetId: string
  creditsMax: number
  creditsSpent: number
  isAvailable: boolean
  // Optional because API omits this field when null/not set
  finalState?: GrantFinalState | null
  // Optional - null means no expiration
  useBefore?: string | null
  consumedAt?: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Payload for grant_context WebSocket event
 */
export interface GrantContextPayload {
  grants: CreditGrant[]
  timestamp: number
}
