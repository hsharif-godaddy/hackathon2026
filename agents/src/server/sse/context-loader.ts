/**
 * SSE context-loader: builds context messages for a turn and enriches
 * `context.metadata` in-place so tools (e.g. website-rebuild) and
 * agent prompts (e.g. hasUnbuiltRebuildPages gating) see the same
 * fields the WS path provides via `ai-lib-websocket-server.ts`
 * loadContextMessages.
 *
 * Extracted into its own module so the three enrichments
 * (stateManager, hasUnbuiltRebuildPages, per-agent contextPreferences)
 * have unit coverage — the inline closure in app.ts was not reachable
 * from tests.
 */

import type { AgentContextPreferences } from '../../agents/ai-lib-agents/types.js'
import { buildPinnedSkillsContextMessages } from '../pinned-skills-context.js'
import { selectCacheConversationId } from '../budget-report-conversation-id.js'
import { logger } from '../../logging/index.js'
import type { AgentsAppContext } from '../../types/websocket-context.js'
import { resolveBmsSubscriptionId } from '@airo/ai-grants'
import { isEmployeeAuthType } from '@airo/shared/auth'

export interface SSEContextLoaderDeps {
  agentFactory: {
    stateManager: unknown
    agents: {
      get(id: string): { getConfig(): { metadata?: { contextPreferences?: AgentContextPreferences } } | undefined } | undefined
    }
  }
  contextMgr: {
    convertToEnhancedContext: (ctx: unknown) => unknown
    buildContextMessages: (
      msg: string,
      ctx: unknown,
      prefs: AgentContextPreferences | undefined,
    ) => Promise<{ contextMessages: any[]; formattedContexts?: any[] }>
  }
  hasUnbuiltRebuildPages: (appId: string) => Promise<boolean>
  /**
   * Resolve the fields needed to enrich SSE context for a given app.
   * Supplies workspace path (pinned-skill persistence), base URL (httpCheck
   * tool), and billing metadata (customerId/subscriptionId). Optional —
   * when omitted each feature degrades gracefully.
   */
  getAppContextFields?: (appId: string) => {
    path?: string
    previewUrl?: string | null
    customerId?: string | null
    subscriptionId?: string | null
  } | undefined
}

export interface SSEContextLoaderResult {
  contextMessages: any[]
  formattedContexts?: any[]
}

export function createSSEContextLoader(
  deps: SSEContextLoaderDeps,
): (context: Record<string, unknown>) => Promise<SSEContextLoaderResult> {
  return async (context: Record<string, unknown>) => {
    const metadata = (context.metadata ?? {}) as Record<string, unknown>
    context.metadata = metadata

    metadata.stateManager = deps.agentFactory.stateManager

    // Consumed by develop-agent prompts to suppress page-build suggestions
    // when a rebuild page selector is showing.
    const appId = metadata.appId as string | undefined
    const rebuildPagesPromise: Promise<boolean> = appId
      ? deps.hasUnbuiltRebuildPages(appId)
      : Promise.resolve(false)

    if (appId && deps.getAppContextFields) {
      let appRecord: ReturnType<NonNullable<SSEContextLoaderDeps['getAppContextFields']>> | undefined
      try {
        appRecord = deps.getAppContextFields(appId)
      } catch (err) {
        logger.warn('sse.context.app_metadata_failed', {
          appId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      if (appRecord) {
        if (appRecord.previewUrl && !metadata.appBaseUrl) {
          metadata.appBaseUrl = appRecord.previewUrl
        }

        const authType = metadata.authType as string | undefined
        const isEmployeeSession = isEmployeeAuthType(authType)
        const useTestBudget = metadata.useTestBudget === true
        const currentSubscriptionId = typeof metadata.subscriptionId === 'string'
          ? metadata.subscriptionId
          : appRecord.subscriptionId ?? undefined

        if (appRecord.customerId) {
          metadata.customerId = appRecord.customerId
        }

        const resolvedSubscriptionId = resolveBmsSubscriptionId(
          isEmployeeSession,
          useTestBudget,
          currentSubscriptionId,
        )
        if (resolvedSubscriptionId) {
          metadata.subscriptionId = resolvedSubscriptionId
        }
      }
    }

    // Start with existing contextAttachments from MessageExecutionService (e.g., ai_edit_context)
    const contextAttachments: unknown[] = Array.isArray(context.contextAttachments)
      ? [...context.contextAttachments]
      : []

    if (Array.isArray(context.selectedAssets) && context.selectedAssets.length > 0) {
      contextAttachments.push({
        type: 'selected_assets',
        data: context.selectedAssets,
        persistence: 'ephemeral',
        renderStrategy: 'before_prompt',
      })
    }

    const agentContext = {
      metadata,
      visualContext: context.visualContext,
      aiEditContext: context.aiEditContext,
      contextAttachments: contextAttachments.length > 0 ? contextAttachments : undefined,
    }
    const enhancedContext = deps.contextMgr.convertToEnhancedContext(agentContext)

    const agentId = metadata.agentId as string | undefined
    const agent = agentId ? deps.agentFactory.agents.get(agentId) : undefined
    const agentPreferences = agent?.getConfig()?.metadata?.contextPreferences

    const [result, hasRebuildPages] = await Promise.all([
      deps.contextMgr.buildContextMessages('', enhancedContext, agentPreferences),
      rebuildPagesPromise,
    ])
    metadata.hasUnbuiltRebuildPages = hasRebuildPages

    // Mirror the WS transport: inject pinned-skill mode context so pinned
    // skills work identically across SSE and WS. See
    // `packages/ai-transport/CLAUDE.md` — cross-transport behavior must
    // match. Pinned content is tagged `before_history` to bucket with
    // leading system messages.
    // Use the same conversationId resolution as WS (`selectCacheConversationId`)
    // so a future SSE path that delivers conversationId via `conversation`
    // instead of `metadata` does not silently no-op pinned context. See
    // `agents/CLAUDE.md` "conversationId for cost-attribution context".
    const pinSelection = selectCacheConversationId(context as AgentsAppContext)
    const contextMessages = [...result.contextMessages]
    if (pinSelection.value) {
      const pinnedMessages = await buildPinnedSkillsContextMessages(pinSelection.value, appId)
      for (const msg of pinnedMessages) {
        contextMessages.push(msg)
      }
    } else {
      logger.warn('skill.pinned.context.no_conversation_id', {
        metadataKeys: Object.keys(metadata),
        transport: 'sse',
      })
    }
    return { contextMessages, formattedContexts: result.formattedContexts }
  }
}
