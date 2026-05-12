import { resolveProfile, runWithProfile, profileValue } from '../profiles/index.js'
import { errorFields, logger } from '../logging/index.js'
import { profileDefinesCustomModularPromptFiles } from '../agents/modular-prompt-files.js'
import { getRegisteredInitialV3ModularAgentIds } from '../agents/registered-initial-modular-agent-ids.js'
import { getRegisteredInitialNamedVariantAgentId } from '../agents/registered-initial-named-variant-ids.js'

/**
 * A `promptVersion` enters the named-variant resolver branch only when it is
 * a non-empty, non-numeric string. Numeric values like `"1.0"` reserve the
 * default initial-agent path; registered numeric variants (`"2.0"`, `"3.0"`)
 * are handled by their explicit branches above.
 */
function isNamedVariantVersion(promptVersion: string | null | undefined): promptVersion is string {
  if (promptVersion == null) return false
  const trimmed = promptVersion.trim()
  if (trimmed.length === 0) return false
  return !/^\d+(\.\d+)*$/.test(trimmed)
}

interface AgentRouterDeps {
  hasMessagesForApp: (appId: string) => boolean | Promise<boolean>
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
  return async function resolveAgent(params: AgentRouterParams): Promise<string> {
    const { appId, agentId, templateId, agentProfile, agentContext, session } = params

    if (agentId) return agentId

    if (session) {
      const { sessionId, stateManager } = session
      const currentAgent = stateManager.getCurrentAgent(sessionId)
      const sessionAppId = stateManager.getSessionMetadata?.(sessionId)?.appId as string | undefined

      if (currentAgent && sessionAppId === appId) {
        // If session says 'develop' but a profile has develop flags, reroute to the variant.
        // This handles the handoff case: initial agent hands off to 'develop', but the
        // profile-specific variant should be used instead.
        if (currentAgent === 'develop') {
          const profile = resolveProfile({
            agentProfileSelectorEnabled: !!agentContext?.agentProfileSelectorEnabled,
            perProjectProfile: agentProfile,
            jwtAgentProfile: agentContext?.agentProfile,
          })
          if (profile) {
            const hasDevelopFlags = Object.keys(profile.properties).some(k => k.startsWith('develop.'))
            if (hasDevelopFlags) {
              logger.debug('agent_router.session_develop_variant', { sessionId, appId, profileName: profile.name })
              return `develop-${profile.name}`
            }
          }
        }
        logger.debug('agent_router.session_agent', { sessionId, appId, currentAgent })
        return currentAgent
      }

      if (currentAgent && sessionAppId && sessionAppId !== appId) {
        logger.info('agent_router.app_changed', { sessionId, oldAppId: sessionAppId, newAppId: appId, oldAgent: currentAgent })
        stateManager.clearSession?.(sessionId)
      }
    }

    let hasMessages = true
    try {
      hasMessages = await deps.hasMessagesForApp(appId)
    } catch (err) {
      // Remote adapter failure should not abort the turn — default to 'develop'
      logger.warn('agent_router.has_messages_check_failed', { appId, ...errorFields(err) })
    }

    if (!hasMessages) {
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
          if (profileDefinesCustomModularPromptFiles(profile)) {
            const variantId = `initial-v3-${profile.name}`
            if (getRegisteredInitialV3ModularAgentIds().has(variantId)) {
              resolvedAgentId = variantId
            } else {
              logger.warn('agent_router.initial_modular_variant_unregistered', {
                appId,
                profileName: profile.name,
                variantId,
                fallbackAgentId: 'initial-v3',
              })
              resolvedAgentId = 'initial-v3'
            }
          } else {
            const promptVersion = runWithProfile(profile, () => profileValue('initial.promptVersion', '' as string))
            if (promptVersion === '2.0') {
              resolvedAgentId = 'initial-v2'
            } else if (promptVersion === '3.0') {
              resolvedAgentId = 'initial-v3'
            } else if (isNamedVariantVersion(promptVersion)) {
              // Only non-numeric, non-empty strings enter the named-variant
              // branch. Numeric versions like `1.0` (current) or `4.0`
              // (hypothetical) fall through to the default selection and
              // must not emit `initial_named_variant_unregistered` warns.
              const namedVariantAgentId = getRegisteredInitialNamedVariantAgentId(promptVersion)
              if (namedVariantAgentId) {
                resolvedAgentId = namedVariantAgentId
              } else {
                logger.warn('agent_router.initial_named_variant_unregistered', {
                  appId,
                  profileName: profile.name,
                  promptVersion,
                })
              }
            }
          }
        }
      }

      if (session) {
        const { sessionId, stateManager } = session
        stateManager.switchAgent(sessionId, resolvedAgentId).then(() => {
          stateManager.setSessionMetadata?.(sessionId, { appId, templateId })
        }).catch(error => {
          logger.error('agent_router.session_state_error', {
            sessionId,
            appId,
            resolvedAgentId,
            ...errorFields(error),
          })
        })
      }

      logger.info('agent_router.initial_selected', { appId, agentId: resolvedAgentId, templateId: validTemplate || null })
      return resolvedAgentId
    }

    // Check if profile routes to a develop variant (develop-{profileName})
    const profile = resolveProfile({
      agentProfileSelectorEnabled: !!agentContext?.agentProfileSelectorEnabled,
      perProjectProfile: agentProfile,
      jwtAgentProfile: agentContext?.agentProfile,
    })
    if (profile) {
      const hasDevelopFlags = Object.keys(profile.properties).some(k => k.startsWith('develop.'))
      if (hasDevelopFlags) {
        logger.debug('agent_router.develop_variant', { appId, profileName: profile.name })
        return `develop-${profile.name}`
      }
    }

    return 'develop'
  }
}
