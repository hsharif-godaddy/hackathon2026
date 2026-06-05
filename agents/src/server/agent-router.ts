import { resolveProfile } from '../profiles/index.js'
import { errorFields, logger } from '../logging/index.js'
import { resolveInitialAgentId } from './resolve-initial-agent.js'
import { concreteDevelopForProfile } from './develop-variant.js'

interface AgentRouterDeps {
  /**
   * Degraded fallback ONLY: consulted when the persisted-agent store read throws,
   * so we cannot read the frozen `conversations.agentId`. No messages → resolve a
   * fresh initial agent; messages → best-effort `develop`. Never the primary path.
   */
  hasMessagesForApp: (appId: string) => boolean | Promise<boolean>
  getTemplateIds: () => string[]
  /**
   * The authoritative per-app agent: `conversations.agentId` of the app's latest
   * conversation, frozen as a concrete id at create/handoff. Returned verbatim —
   * a stale JWT profile or client field can never re-route an existing app.
   * Returns undefined for brand-new apps with no conversation yet (→ freeze a new
   * initial agent).
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
  /**
   * A validated `/agent <name>` override parsed from the message — the top-priority
   * bypass (QA/debug). SSE passes the parsed target here; WS resolves it upstream
   * (manual-agent-override) and returns before reaching the router. NOT a channel
   * for client-sent `data.agentId/agentName`, which no longer steer routing.
   */
  manualAgentOverride?: string
  templateId?: string
  agentContext?: { agentProfile?: string }
  session?: SessionContext
}

export function createAgentRouter(deps: AgentRouterDeps) {
  return async function resolveAgent(params: AgentRouterParams): Promise<string> {
    const { appId, manualAgentOverride, templateId, agentContext, session } = params

    // `/agent <name>` is the top-priority override. SSE passes the parsed target;
    // WS handles it upstream and returns before the router is consulted.
    if (manualAgentOverride) return manualAgentOverride

    // Fire-and-forget: warm the ephemeral session so subsequent messages on this
    // socket resolve from session state without re-reading the store. Stores the
    // concrete agent id verbatim. Self-correcting on any failure — if switchAgent
    // rejects, or setSessionMetadata throws (leaving the session with an agent but
    // no appId), the next message's session check misses and falls through to a
    // fresh store read. Hence warn, not error; the .catch also guarantees the
    // rejection never escapes as an unhandled promise.
    function rehydrateSession(s: SessionContext, agentToStore: string, errorEvent: string): void {
      s.stateManager.switchAgent(s.sessionId, agentToStore).then(() => {
        s.stateManager.setSessionMetadata?.(s.sessionId, { appId, templateId })
      }).catch(error => {
        logger.warn(errorEvent, { sessionId: s.sessionId, appId, agentId: agentToStore, ...errorFields(error) })
      })
    }

    // Map a base `develop` agent to the profile-specific variant for the active
    // JWT profile. Profiles with develop/skill flags but no initial variant (e.g.
    // `experimental`) start on base `initial` and hand off to base `develop`, so
    // the factory never wires an initial→develop-<profile> handoff for them — this
    // read-time mapping is the authoritative path to their `develop-<profile>`
    // agent (warm session, cold reload, and legacy `develop` rows alike). Concrete
    // ids (`develop-<name>`, `initial*`, `marketing`) pass through unchanged.
    function developVariant(agentId: string): string {
      if (agentId !== 'develop') return agentId
      const profile = resolveProfile({
        agentProfileSelectorEnabled: false,
        perProjectProfile: undefined,
        jwtAgentProfile: agentContext?.agentProfile,
      })
      return concreteDevelopForProfile(agentId, profile)
    }

    // The concrete initial agent to FREEZE for a brand-new app. The caller persists
    // the returned id as `conversations.agentId`, after which it is authoritative.
    function freezeInitialAgent(): string {
      return resolveInitialAgentId({
        appId,
        templateId,
        jwtAgentProfile: agentContext?.agentProfile,
        getTemplateIds: deps.getTemplateIds,
      })
    }

    // 1. Warm session cache: the concrete agent already resolved for this
    //    socket+app. Returned verbatim — the develop variant was frozen at handoff.
    if (session) {
      const { sessionId, stateManager } = session
      const currentAgent = stateManager.getCurrentAgent(sessionId)
      const sessionAppId = stateManager.getSessionMetadata?.(sessionId)?.appId as string | undefined

      if (currentAgent && sessionAppId === appId) {
        const resolved = developVariant(currentAgent)
        logger.debug('agent_router.session_agent', { sessionId, appId, currentAgent, resolved })
        return resolved
      }

      if (currentAgent && sessionAppId && sessionAppId !== appId) {
        logger.info('agent_router.app_changed', { sessionId, oldAppId: sessionAppId, newAppId: appId, oldAgent: currentAgent })
        stateManager.clearSession?.(sessionId)
      }
    }

    // 2. Authoritative stored agent: `conversations.agentId` of the app's latest
    //    conversation, frozen concrete at create/handoff. Returned verbatim.
    //    Undefined for a brand-new app with no conversation yet.
    let persistedAgent: string | undefined
    try {
      persistedAgent = await deps.getPersistedAgentForApp?.(appId)
    } catch (err) {
      // Store read failed — must not abort the turn. We cannot read the frozen
      // agent, so degrade to the message-presence heuristic (best effort only).
      logger.warn('agent_router.persisted_agent_check_failed', { appId, ...errorFields(err) })
      let hasMessages = true
      try {
        hasMessages = await deps.hasMessagesForApp(appId)
      } catch (heuristicErr) {
        // Both the authoritative store and the fallback heuristic are down — a
        // real outage, not a routine miss. Surface an alertable error (distinct
        // from the two warns above). We default to 'develop': wrong for a
        // brand-new app, but the safer guess for the far-more-common existing app
        // when we genuinely cannot tell new from existing.
        logger.error('agent_router.agent_resolution_degraded', { appId, ...errorFields(heuristicErr) })
      }
      return hasMessages ? 'develop' : freezeInitialAgent()
    }
    if (persistedAgent) {
      const resolved = developVariant(persistedAgent)
      if (session) rehydrateSession(session, resolved, 'agent_router.session_rehydrate_error')
      logger.info('agent_router.persisted_agent', { appId, agentId: resolved })
      return resolved
    }

    // 3. Brand-new app: resolve and freeze the concrete initial agent.
    const initialAgentId = freezeInitialAgent()
    if (session) rehydrateSession(session, initialAgentId, 'agent_router.session_state_error')
    logger.info('agent_router.initial_selected', { appId, agentId: initialAgentId })
    return initialAgentId
  }
}
