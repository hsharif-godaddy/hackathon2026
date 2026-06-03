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
  /**
   * Durable per-app fallback for the active agent, read from the persisted
   * conversation record (`conversations.agentId`). Consulted only when there is
   * no in-memory session agent — i.e. after a browser reload (new socket id) or
   * on the SSE transport (no session at all). Without this, a reload mid-`initial`
   * loses the ephemeral session and the `hasMessagesForApp` heuristic wrongly
   * promotes the conversation to `develop`. Returns undefined for brand-new apps
   * with no conversation yet.
   */
  getPersistedAgentForApp?: (appId: string) => Promise<string | undefined>
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

    // If the active agent is 'develop' and a profile carries develop/skill flags,
    // reroute to the profile-specific variant (develop-<profile>). Otherwise the
    // agent id passes through unchanged. Shared by the session, persisted-fallback,
    // and has-messages paths so they resolve variants identically.
    function resolveDevelopVariant(agent: string): string {
      if (agent !== 'develop') return agent
      const profile = resolveProfile({
        agentProfileSelectorEnabled: !!agentContext?.agentProfileSelectorEnabled,
        perProjectProfile: agentProfile,
        jwtAgentProfile: agentContext?.agentProfile,
      })
      if (profile) {
        const hasDevelopFlags = Object.keys(profile.properties).some(k =>
          k.startsWith('develop.') || k.startsWith('skill.')
        )
        if (hasDevelopFlags) {
          logger.debug('agent_router.develop_variant', { appId, profileName: profile.name })
          return `develop-${profile.name}`
        }
      }
      return agent
    }

    // Fire-and-forget: warm the ephemeral session so subsequent messages on this
    // socket resolve from session state without re-reading the DB. Stores the raw
    // agent id (matching normal handoff semantics); the develop variant is
    // re-resolved per read. A failure here is self-correcting — the next message
    // simply re-reads from the DB — so it logs at warn, not error.
    function rehydrateSession(s: SessionContext, agentToStore: string, errorEvent: string): void {
      s.stateManager.switchAgent(s.sessionId, agentToStore).then(() => {
        s.stateManager.setSessionMetadata?.(s.sessionId, { appId, templateId })
      }).catch(error => {
        logger.warn(errorEvent, { sessionId: s.sessionId, appId, agentId: agentToStore, ...errorFields(error) })
      })
    }

    if (session) {
      const { sessionId, stateManager } = session
      const currentAgent = stateManager.getCurrentAgent(sessionId)
      const sessionAppId = stateManager.getSessionMetadata?.(sessionId)?.appId as string | undefined

      if (currentAgent && sessionAppId === appId) {
        // Handoff case: initial agent hands off to 'develop', but the
        // profile-specific variant should be used instead.
        const resolved = resolveDevelopVariant(currentAgent)
        if (resolved === currentAgent) {
          logger.debug('agent_router.session_agent', { sessionId, appId, currentAgent })
        }
        return resolved
      }

      if (currentAgent && sessionAppId && sessionAppId !== appId) {
        logger.info('agent_router.app_changed', { sessionId, oldAppId: sessionAppId, newAppId: appId, oldAgent: currentAgent })
        stateManager.clearSession?.(sessionId)
      }
    }

    // No in-memory session agent (browser reload → new socket id, or SSE which has
    // no session). Fall back to the durable per-conversation agent so we don't lose
    // the 'initial' phase across reconnects. Brand-new apps (no conversation yet)
    // return undefined here and fall through to the hasMessagesForApp heuristic.
    let persistedAgent: string | undefined
    try {
      persistedAgent = await deps.getPersistedAgentForApp?.(appId)
    } catch (err) {
      // Store read failure must not abort the turn — same contract as the
      // hasMessagesForApp block below; fall through to the heuristic.
      logger.warn('agent_router.persisted_agent_check_failed', { appId, ...errorFields(err) })
    }
    if (persistedAgent) {
      const resolved = resolveDevelopVariant(persistedAgent)
      if (session) rehydrateSession(session, persistedAgent, 'agent_router.session_rehydrate_error')
      logger.info('agent_router.persisted_agent', { appId, agentId: resolved })
      return resolved
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

      if (session) rehydrateSession(session, resolvedAgentId, 'agent_router.session_state_error')

      logger.info('agent_router.initial_selected', { appId, agentId: resolvedAgentId, templateId: validTemplate || null })
      return resolvedAgentId
    }

    // Existing app with messages but no persisted/session agent: default to
    // 'develop', rerouting to the profile variant when applicable.
    return resolveDevelopVariant('develop')
  }
}
