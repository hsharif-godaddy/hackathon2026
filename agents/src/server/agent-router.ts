import { errorFields, logger } from '../logging/index.js'
import { resolveInitialAgentId } from './resolve-initial-agent.js'

interface AgentRouterDeps {
  /**
   * Degraded fallback ONLY: consulted when the persisted-agent store read throws,
   * so we cannot read the frozen `conversations.agentId`. No messages → resolve a
   * fresh initial agent; messages → best-effort `develop`. Never the primary path.
   */
  hasMessagesForApp: (appId: string) => boolean | Promise<boolean>
  getModeIds: () => string[]
  /**
   * The registered/startable agent ids (factory `agents.list()`) — the allowlist
   * for the internal `?agent=` start-as override. Sub-agents are excluded.
   */
  getStartableAgentIds: () => string[]
  /**
   * The authoritative per-app agent: `conversations.agentId` of the app's latest
   * conversation, frozen as a concrete id at create/handoff. Returned verbatim —
   * a stale JWT profile or client field can never re-route an existing app.
   * Returns undefined for brand-new apps with no conversation yet (→ freeze a new
   * initial agent).
   */
  getPersistedAgentForApp?: (appId: string) => Promise<string | undefined>
  /**
   * Self-heal a stale/invalid persisted agent (e.g. a deleted develop-<profile>
   * variant or a retired initial-family agent). Called fire-and-forget when the
   * router detects an unrecognized id. `correctedAgentId` is 'initial-v3' when the
   * stale id is an initial-family agent (`initial` or `initial-*`, i.e. still
   * mid-initial-build), else 'develop'.
   */
  repairPersistedAgent?: (appId: string, correctedAgentId: string) => Promise<void>
  /**
   * Durable per-app agent mode override written by tools (e.g. deep-build). Checked
   * after the session cache but before the persisted-conversation agent so new
   * conversations on an app with a mode set inherit it automatically.
   */
  getAppAgentMode?: (appId: string) => Promise<string | undefined>
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
  templateId?: string
  /**
   * Internal "start-as" override (`?agent=<id>`). Only honored for a brand-new app
   * and only when the JWT sets `agentContext.agentStartOverrideEnabled`.
   */
  overrideAgentId?: string
  agentContext?: { agentProfile?: string; agentStartOverrideEnabled?: boolean }
  session?: SessionContext
}

export function createAgentRouter(deps: AgentRouterDeps) {
  return async function resolveAgent(params: AgentRouterParams): Promise<string> {
    const { appId, templateId, overrideAgentId, agentContext, session } = params

    // Per-profile develop variants were flattened (#4346): a single `develop`
    // agent serves every profile and resolves prompt/tool differences per turn
    // via callable `system`/`activeTools`. The router returns the plain agent
    // id — no `develop-<profile>` rerouting.

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

    // The concrete initial agent to FREEZE for a brand-new app. The caller persists
    // the returned id as `conversations.agentId`, after which it is authoritative.
    function freezeInitialAgent(): string {
      return resolveInitialAgentId({
        appId,
        overrideAgentId,
        startOverrideEnabled: agentContext?.agentStartOverrideEnabled,
        getStartableAgentIds: deps.getStartableAgentIds,
        templateId,
        jwtAgentProfile: agentContext?.agentProfile,
        getModeIds: deps.getModeIds,
      })
    }

    // 1. Warm session cache: the concrete agent already resolved for this
    //    socket+app. Returned verbatim — the develop variant was frozen at handoff.
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

    // 2.5 App-level agent mode — durable per-app override (e.g. deep-build).
    // Checked before conversation-level persistence so new conversations on
    // an app with a set mode inherit it automatically.
    if (deps.getAppAgentMode) {
      const appAgentMode: string | undefined = await deps.getAppAgentMode(appId)
      if (appAgentMode) {
        if (session) rehydrateSession(session, appAgentMode, 'agent_router.app_mode_rehydrate_error')
        logger.info('agent_router.app_mode', { appId, agentId: appAgentMode })
        return appAgentMode
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
      const startable: string[] = deps.getStartableAgentIds()
      if (startable.length > 0 && !startable.includes(persistedAgent)) {
        const fallbackAgent: string = (persistedAgent === 'initial' || persistedAgent.startsWith('initial-')) ? 'initial-v3' : 'develop'
        logger.warn('agent_router.persisted_agent_invalid', { appId, invalidAgentId: persistedAgent, fallback: fallbackAgent })
        deps.repairPersistedAgent?.(appId, fallbackAgent).catch(err => {
          logger.warn('agent_router.persisted_agent_repair_failed', { appId, ...errorFields(err) })
        })
        persistedAgent = fallbackAgent
      }
      if (session) rehydrateSession(session, persistedAgent, 'agent_router.session_rehydrate_error')
      logger.info('agent_router.persisted_agent', { appId, agentId: persistedAgent })
      return persistedAgent
    }

    // 3. Brand-new app: resolve and freeze the concrete initial agent.
    const initialAgentId = freezeInitialAgent()
    if (session) rehydrateSession(session, initialAgentId, 'agent_router.session_state_error')
    logger.info('agent_router.initial_selected', { appId, agentId: initialAgentId })
    return initialAgentId
  }
}
