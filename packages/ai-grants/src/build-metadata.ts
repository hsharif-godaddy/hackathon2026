import { grantSessionManager } from './grant-session-manager.js'
import { isBudgetOverride } from './budget-override.js'
import { createLogger, type LitellmMetadata } from '@airo/ai-common'

const logger = createLogger('ai-grants')
import { LlmCallSource } from '@airo/shared/grants'

/**
 * Prefix for subscription-based billing identifiers
 * Must match the frontend prefix in app/src/lib/subscription-id.ts
 */
const SUBSCRIPTION_ID_PREFIX = 'airo-build:sid:'

/**
 * APM agent type (loose typing to avoid strict dependency)
 */
type APMAgent = {
  setLabel?: (key: string, value: string | number | boolean) => void
}

/**
 * Execution context passed through the agent system
 * Provides type safety for context access throughout the codebase
 */
export interface ExecutionContext {
  /** WebSocket socket ID for session identification */
  socketId?: string

  /** Application and user metadata */
  metadata?: ExecutionContextMetadata
}

export interface ExecutionContextMetadata {
  appId?: string
  customerId?: string
  /**
   * Subscription ID for LLM billing.
   * Usually the customer's subscription ID, but can also hold BudgetOverride values
   * (care-agent, test-accounts) for special billing scenarios.
   */
  subscriptionId?: string
  sessionId?: string
  agentId?: string

  /** State manager reference for tool access */
  stateManager?: unknown

  /** User's original message (for context search) */
  _userMessage?: string

  /** Whether app has unbuilt rebuild pages */
  hasUnbuiltRebuildPages?: boolean

  /** Budget Service flag from JWT */
  budgetServiceEnabled?: boolean

  /** BMS budget ID (subscriptionId mapped to BMS) */
  bmsBudgetId?: string

  /** BMS session ID (created per prompt via performBudgetPreCheck) */
  budgetSessionId?: string

  /** OTel trace ID for GoCode cross-service log correlation (sent as x-trace-id header) */
  traceId?: string
}

// Re-export enums from shared
export { LlmCallSource, GrantErrorCode } from '@airo/shared/grants'

interface MetadataOptions {
  agentId?: string | undefined
  source?: LlmCallSource | string
}

// Module-level APM reference (set via setAPM)
let apm: APMAgent | null = null

/**
 * Set APM agent for instrumentation in build-metadata
 */
export function setAPM(apmAgent: APMAgent): void {
  apm = apmAgent
}

/**
 * Build LiteLLM metadata from execution context
 *
 * Uses session-managed grants for efficiency (not per-message grants).
 * Single source of truth for all LLM calls in the system.
 *
 * When budgetServiceEnabled is true (BMS mode):
 * - Skip grant lookup entirely - BMS handles cost tracking via x-gocode-budget-* headers
 * - Return metadata with budget fields for GoCode attribution
 *
 * When budgetServiceEnabled is false (legacy grants mode):
 * - Fallback hierarchy (in order of preference):
 *   1. Grant's llmBudgetUserId (when grants available)
 *   2. subscriptionId (when no grants indexed for subscription)
 *   3. customerId (LAST RESORT - provides infinite budget, avoid if possible)
 *
 * @param context - Execution context with socketId and metadata
 * @param options - Optional agent ID and source for tagging
 * @returns LitellmMetadata with user and tags, or null if grants exhausted (legacy mode only)
 */
export function buildLitellmMetadataFromContext(
  context: ExecutionContext | Record<string, unknown> | undefined,
  options?: MetadataOptions
): LitellmMetadata | null {
  // Handle both typed ExecutionContext and legacy Record<string, unknown>
  const typedContext = context as ExecutionContext | undefined
  const metadata = typedContext?.metadata as ExecutionContextMetadata | undefined

  if (!metadata) return null

  const { appId, customerId, subscriptionId } = metadata
  const socketId = typedContext?.socketId

  if (!appId) return null

  // Build tags for cost attribution and filtering
  const tags: string[] = []
  if (customerId) tags.push(`cid:${customerId}`)
  tags.push(`appId:${appId}`)
  tags.push(`source:${options?.source ?? LlmCallSource.UserChat}`)
  if (options?.agentId) tags.push(`agent:${options.agentId}`)
  tags.push(metadata.budgetServiceEnabled ? 'mode:bms' : 'mode:grants')

  // BMS session fields for GoCode cost reporting (x-gocode-budget-* headers)
  // Only present when budget service is enabled and session was created
  const hasBudgetFields = !!(metadata.budgetServiceEnabled && metadata.bmsBudgetId && metadata.budgetSessionId)
  const budgetFields: Pick<LitellmMetadata, 'budgetId' | 'budgetSessionId'> = hasBudgetFields
    ? { budgetId: metadata.bmsBudgetId!, budgetSessionId: metadata.budgetSessionId! }
    : {}
  // Only log when budget fields are present to avoid high-volume logs
  if (hasBudgetFields) {
    logger.info('budget.metadata.fields', {
      appId,
      bmsBudgetId: metadata.bmsBudgetId ?? null,
      budgetSessionId: metadata.budgetSessionId ?? null,
    })
  }

  // OTel trace ID for GoCode cross-service log correlation (x-trace-id header)
  const traceFields: Pick<LitellmMetadata, 'traceId'> =
    metadata.traceId ? { traceId: metadata.traceId } : {}

  // Budget override sessions bypass grants and use dedicated budgets
  // (e2s care agents, test accounts, task-specific budgets)
  // Check BEFORE BMS mode to avoid incorrect prefixing of override values
  if (isBudgetOverride(subscriptionId)) {
    // Log at info for production visibility — override sessions are infrequent/bounded
    logger.info('grants.build_metadata.task_budget_override', {
      appId,
      socketId,
      subscriptionId,
      tags,
      source: options?.source ?? LlmCallSource.UserChat,
    })
    return { user: subscriptionId, tags, ...budgetFields, ...traceFields }
  }

  // BMS MODE: When budget service is enabled, skip grant lookup entirely
  // BMS handles cost tracking via x-gocode-budget-* headers sent to GoCode
  // The user field is still needed for GoCode cost attribution but grants are not consulted
  if (metadata.budgetServiceEnabled) {
    // Use subscriptionId for user identification (preferred) or customerId as fallback
    const userId = subscriptionId
      ? (subscriptionId.startsWith(SUBSCRIPTION_ID_PREFIX) ? subscriptionId : `${SUBSCRIPTION_ID_PREFIX}${subscriptionId}`)
      : customerId

    if (!userId) {
      logger.error('grants.build_metadata.bms_no_user_identifier', { appId, socketId })
      return null
    }

    apm?.setLabel?.('litellm.user_type', 'bms_subscription')
    logger.debug('grants.build_metadata.bms_mode', {
      appId,
      socketId,
      subscriptionId,
      userId,
      tags,
      source: options?.source ?? LlmCallSource.UserChat,
      hasBudgetSession: hasBudgetFields,
    })

    return { user: userId, tags, budgetServiceEnabled: true, ...budgetFields, ...traceFields }
  }

  // LEGACY GRANTS MODE: Budget service disabled, use grant-based billing

  // Budget override sessions bypass grants and use dedicated budgets
  // (e2s care agents, test accounts, task-specific budgets)
  // Include budgetFields so GoCode receives session ID for cost tracking
  if (isBudgetOverride(subscriptionId)) {
    // Log at info for production visibility — override sessions are infrequent/bounded
    logger.info('grants.build_metadata.task_budget_override', {
      appId,
      socketId,
      subscriptionId,
      tags,
      hasBudgetFields,
      source: options?.source ?? LlmCallSource.UserChat,
    })
    return { user: subscriptionId, tags, ...budgetFields, ...traceFields }
  }

  // Budget billing is determined entirely by the explicit subscriptionId in context.
  // The triggering code (WebSocket server for sessions, trigger point for background tasks)
  // sets subscriptionId to the appropriate BudgetOverride value when needed.

  // Use session-managed grants if available (websocket context)
  if (socketId && grantSessionManager.hasGrants(socketId)) {
    const userId = grantSessionManager.getCurrentUserId(socketId, customerId)

    if (userId) {
      // APM: Track which grant is being used
      apm?.setLabel?.('litellm.user_type', 'grant')
      // Include _internal fields for fetch-level grant fallback
      const metadata: LitellmMetadata = {
        user: userId,
        tags,
        ...budgetFields,
        ...traceFields,
        _internal: {
          socketId,
          ...(customerId && { customerId })
        }
      }
      logger.debug('grants.build_metadata.result', {
        appId,
        socketId,
        subscriptionId,
        userType: 'grant',
        userId,
        tags,
        source: options?.source ?? LlmCallSource.UserChat,
      })
      return metadata
    }

    // All grants exhausted - return null to signal error upstream
    // DO NOT fallback to subscriptionId/customerId - user needs to purchase more credits
    logger.error('grants.build_metadata.exhausted', {
      appId,
      socketId,
      customerId,
    })
    apm?.setLabel?.('litellm.user_type', 'exhausted')
    return null
  }

  // For background tasks: Try subscription-based grant lookup when no socketId
  // This uses grants that were indexed when a user's websocket session received them
  if (!socketId && subscriptionId) {
    // Strip prefix if present - grants are indexed by raw subscriptionId without budget prefix
    const rawSubscriptionId = subscriptionId.startsWith(SUBSCRIPTION_ID_PREFIX)
      ? subscriptionId.slice(SUBSCRIPTION_ID_PREFIX.length)
      : subscriptionId
    logger.debug('grants.build_metadata.subscription_check', {
      appId,
      subscriptionId,
      rawSubscriptionId,
      subscriptionCount: grantSessionManager.getSubscriptionCount(),
    })

    const userId = grantSessionManager.getUserIdBySubscription(rawSubscriptionId)
    const hasGrants = grantSessionManager.hasGrantsBySubscription(rawSubscriptionId)
    logger.debug('grants.build_metadata.subscription_grant_lookup', {
      appId,
      subscriptionId,
      rawSubscriptionId,
      userId,
      hasGrants,
    })

    if (userId) {
      apm?.setLabel?.('litellm.user_type', 'grant_by_subscription')
      const metadata = { user: userId, tags, ...budgetFields, ...traceFields }
      logger.debug('grants.build_metadata.result', {
        appId,
        socketId: null,
        subscriptionId,
        userType: 'grant_by_subscription',
        userId,
        tags,
        source: options?.source ?? LlmCallSource.UserChat,
      })
      return metadata
    }

    // Subscription has grants but all exhausted
    if (grantSessionManager.hasGrantsBySubscription(rawSubscriptionId)) {
      logger.error('grants.build_metadata.subscription_exhausted', {
        appId,
        subscriptionId,
        rawSubscriptionId,
        customerId,
      })
      apm?.setLabel?.('litellm.user_type', 'exhausted_by_subscription')
      return null
    }

    // No grants indexed for this subscription - fall through to subscriptionId fallback
    logger.debug('grants.build_metadata.no_subscription_grants', {
      appId,
      subscriptionId,
    })
  }

  // Fallback hierarchy: subscriptionId first, customerId as LAST RESORT
  // subscriptionId provides budget control, customerId gives infinite budget
  if (subscriptionId) {
    apm?.setLabel?.('litellm.user_type', 'subscription_id')
    const prefixedSubscriptionId = subscriptionId.startsWith(SUBSCRIPTION_ID_PREFIX)
      ? subscriptionId
      : `${SUBSCRIPTION_ID_PREFIX}${subscriptionId}`
    const metadata = { user: prefixedSubscriptionId, tags, ...budgetFields, ...traceFields }
    logger.debug('grants.build_metadata.result', {
      appId,
      socketId,
      subscriptionId,
      userType: 'subscription_id',
      userId: prefixedSubscriptionId,
      tags,
      source: options?.source ?? LlmCallSource.UserChat,
      reason: socketId ? 'no_grants_in_session' : 'no_socket',
    })
    return metadata
  }

  // customerId is LAST RESORT - provides infinite budget, only for legacy/edge cases
  if (customerId) {
    apm?.setLabel?.('litellm.user_type', 'customer_id')
    const metadata = { user: customerId, tags, ...budgetFields, ...traceFields }
    logger.warn('grants.build_metadata.result', {
      appId,
      socketId,
      subscriptionId,
      userType: 'customer_id_LAST_RESORT',
      userId: customerId,
      tags,
      source: options?.source ?? LlmCallSource.UserChat,
      reason: 'no_subscription_id',
    })
    return metadata
  }

  // No user identifier available
  logger.error('grants.build_metadata.no_user_identifier', { appId })
  return null
}

/**
 * Check if metadata build would fail due to exhausted grants
 * Use this for early error detection before attempting LLM calls
 *
 * @param context - Execution context
 * @returns true if all grants are exhausted (legacy grants mode only)
 */
export function isGrantsExhausted(
  context: ExecutionContext | Record<string, unknown> | undefined
): boolean {
  const typedContext = context as ExecutionContext | undefined
  const socketId = typedContext?.socketId
  if (!socketId) return false

  const metadata = typedContext?.metadata as ExecutionContextMetadata | undefined

  // BMS mode: grants not used, cannot be "exhausted" in the grant sense
  // BMS handles its own budget enforcement via GoCode
  if (metadata?.budgetServiceEnabled) {
    return false
  }

  // Budget override sessions bypass grants (e2s, test accounts, task budgets)
  if (isBudgetOverride(metadata?.subscriptionId)) {
    logger.debug('grants.is_grants_exhausted.override_bypass', {
      socketId,
      subscriptionId: metadata?.subscriptionId,
    })
    return false
  }

  // No grants in session - not exhausted (will use customerId as fallback)
  if (!grantSessionManager.hasGrants(socketId)) return false

  // Has grants + no usable grant = exhausted
  const customerId = metadata?.customerId
  return grantSessionManager.getCurrentUserId(socketId, customerId) === undefined
}
