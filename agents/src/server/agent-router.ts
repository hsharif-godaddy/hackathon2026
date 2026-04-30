import { resolveProfile, runWithProfile, profileValue } from '../profiles/index.js'
import { logger } from '../logging/index.js'

interface AgentRouterDeps {
  hasMessagesForApp: (appId: string) => boolean
  getTemplateIds: () => string[]
}

export interface AgentStateManager {
  getCurrentAgent: (sessionId: string) => string | undefined
  getSessionMetadata?: (sessionId: string) => { appId?: string; [key: string]: unknown } | undefined
  clearSession?: (sessionId: string) => void
  switchAgent: (sessionId: string, agentId: string, prompt?: string) => Promise<unknown>
  setSessionMetadata?: (sessionId: string, metadata: { appId?: string; templateId?: string }) => void
}

export interface SessionContext {
  sessionId: string
  stateManager: AgentStateManager
}

export interface AgentRouterParams {
  appId: string
  agentId?: string
  templateId?: string
  agentProfile?: string
  agentContext?: { agentProfileSelectorEnabled?: boolean; agentProfile?: string }
  session?: SessionContext
}

export function createAgentRouter(deps: AgentRouterDeps) {
  return function resolveAgent(params: AgentRouterParams): string {
    const { appId, agentId, templateId, agentProfile, agentContext, session } = params

    if (agentId) return agentId

    if (session) {
      const { sessionId, stateManager } = session
      const currentAgent = stateManager.getCurrentAgent(sessionId)
      const sessionAppId = stateManager.getSessionMetadata?.(sessionId)?.appId as string | undefined

      if (currentAgent && sessionAppId === appId) {
        logger.debug('agent_router.session_agent', { sessionId, appId, currentAgent })
        return currentAgent
      }

      if (currentAgent && sessionAppId && sessionAppId !== appId) {
        logger.info('agent_router.app_changed', { sessionId, oldAppId: sessionAppId, newAppId: appId, oldAgent: currentAgent })
        stateManager.clearSession?.(sessionId)
      }
    }

    if (!deps.hasMessagesForApp(appId)) {
      const validTemplate = typeof templateId === 'string' && deps.getTemplateIds().includes(templateId)
        ? templateId : undefined
      let resolvedAgentId = validTemplate ? `initial-${validTemplate}` : 'initial'

      if (resolvedAgentId === 'initial') {
        const profile = resolveProfile({
          agentProfileSelectorEnabled: !!agentContext?.agentProfileSelectorEnabled,
          perProjectProfile: agentProfile,
          jwtAgentProfile: agentContext?.agentProfile,
        })
        if (profile) {
          const promptVersion = runWithProfile(profile, () => profileValue('initial.promptVersion', '' as string))
          if (promptVersion === '2.0') {
            resolvedAgentId = 'initial-v2'
          }
        }
      }

      if (session) {
        const { sessionId, stateManager } = session
        stateManager.switchAgent(sessionId, resolvedAgentId).catch(error => {
          logger.error('agent_router.session_state_error', { sessionId, appId, error: error instanceof Error ? error.message : String(error) })
        })
        stateManager.setSessionMetadata?.(sessionId, { appId, templateId })
      }

      logger.info('agent_router.initial_selected', { appId, agentId: resolvedAgentId, templateId: validTemplate || null })
      return resolvedAgentId
    }

    return 'develop'
  }
}
