import { grantSessionManager } from './grant-session-manager.js'
import { logger, type LitellmMetadata } from '@airo/ai-common'
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
  subscriptionId?: string
  sessionId?: string
  agentId?: string

  /** State manager reference for tool access */
  stateManager?: unknown

  /** User's original message (for context search) */
  _userMessage?: string

  /** Whether app has unbuilt rebuild pages */
  hasUnbuiltRebuildPages?: boolean
}

/**
 * Special subscription IDs for non-standard billing
 */
export enum SpecialSubscriptionId {
  CareAgent = 'airo-builder:care-agent',
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
 * Fallback hierarchy (in order of preference):
 * 1. Grant's llmBudgetUserId (when grants feature ON and grants available)
 * 2. subscriptionId (when grants feature OFF or no grants indexed)
 * 3. customerId (LAST RESORT - provides infinite budget, avoid if possible)
 *
 * @param context - Execution context with socketId and metadata
 * @param options - Optional agent ID and source for tagging
 * @returns LitellmMetadata with user and tags, or null if grants exhausted
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

  // E2S (care) sessions bypass grants entirely
  if (subscriptionId === SpecialSubscriptionId.CareAgent) {
    return { user: SpecialSubscriptionId.CareAgent, tags }
  }

  // Use session-managed grants if available (websocket context)
  if (socketId && grantSessionManager.isFeatureEnabled(socketId)) {
    const userId = grantSessionManager.getCurrentUserId(socketId, customerId)

    if (userId) {
      // APM: Track which grant is being used
      apm?.setLabel?.('litellm.user_type', 'grant')
      // Include _internal fields for fetch-level grant fallback
      const metadata: LitellmMetadata = {
        user: userId,
        tags,
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
    const featureEnabledForSub = grantSessionManager.isFeatureEnabledBySubscription(rawSubscriptionId)
    logger.debug('grants.build_metadata.subscription_check', {
      appId,
      subscriptionId,
      rawSubscriptionId,
      featureEnabledForSub,
      subscriptionCount: grantSessionManager.getSubscriptionCount(),
    })

    if (featureEnabledForSub) {
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
        const metadata = { user: userId, tags }
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
  }

  // Fallback hierarchy: subscriptionId first, customerId as LAST RESORT
  // subscriptionId provides budget control, customerId gives infinite budget
  if (subscriptionId) {
    apm?.setLabel?.('litellm.user_type', 'subscription_id')
    const prefixedSubscriptionId = subscriptionId.startsWith(SUBSCRIPTION_ID_PREFIX)
      ? subscriptionId
      : `${SUBSCRIPTION_ID_PREFIX}${subscriptionId}`
    const metadata = { user: prefixedSubscriptionId, tags }
    logger.debug('grants.build_metadata.result', {
      appId,
      socketId,
      subscriptionId,
      userType: 'subscription_id',
      userId: prefixedSubscriptionId,
      tags,
      source: options?.source ?? LlmCallSource.UserChat,
      reason: socketId ? 'feature_disabled' : 'no_socket',
    })
    return metadata
  }

  // customerId is LAST RESORT - provides infinite budget, only for legacy/edge cases
  if (customerId) {
    apm?.setLabel?.('litellm.user_type', 'customer_id')
    const metadata = { user: customerId, tags }
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
 * @returns true if grants feature is active AND all grants are exhausted
 */
export function isGrantsExhausted(
  context: ExecutionContext | Record<string, unknown> | undefined
): boolean {
  const typedContext = context as ExecutionContext | undefined
  const socketId = typedContext?.socketId
  if (!socketId) return false

  // Feature not enabled - not exhausted (will use customerId)
  if (!grantSessionManager.isFeatureEnabled(socketId)) return false

  // No grants in session - not exhausted (will use customerId as fallback)
  if (!grantSessionManager.hasGrants(socketId)) return false

  // Feature enabled + has grants + no usable grant = exhausted
  const metadata = typedContext?.metadata as ExecutionContextMetadata | undefined
  const customerId = metadata?.customerId
  return grantSessionManager.getCurrentUserId(socketId, customerId) === undefined
}
