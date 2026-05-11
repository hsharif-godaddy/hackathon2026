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
    return { contextMessages: result.contextMessages, formattedContexts: result.formattedContexts }
  }
}
