import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSessionStateManager } from '@airo/ai-lib'
import * as profiles from '../../profiles/index.js'
import { createAgentRouter } from '../agent-router.js'
import { setRegisteredInitialNamedVariantIds } from '../../agents/registered-initial-named-variant-ids.js'
import { logger } from '../../logging/index.js'
import type { ProfileData } from '../../profiles/types.js'

describe('agent-router', function agentRouterTests() {
  const resolveAgent = createAgentRouter({
    hasMessagesForApp: () => false,
    getModeIds: () => [],
  })

  let resolveProfileSpy: ReturnType<typeof vi.spyOn>

  beforeEach(function setup() {
    resolveProfileSpy = vi.spyOn(profiles, 'resolveProfile')
    setRegisteredInitialNamedVariantIds(new Map())
  })

  afterEach(function teardown() {
    resolveProfileSpy.mockRestore()
    setRegisteredInitialNamedVariantIds(new Map())
  })

  function profile(partial: Partial<ProfileData> & Pick<ProfileData, 'name' | 'properties'>): ProfileData {
    return {
      description: '',
      ...partial,
    }
  }

  it('routes to initial-v3 when modular prompt files are configured (no per-profile variant)', async function modularRoute() {
    resolveProfileSpy.mockReturnValue(profile({
      name: 'exp',
      properties: { 'initial.modularPromptFiles': 'identity.md' },
    }))

    const id = await resolveAgent({
      appId: 'app_new',
      agentContext: { agentProfile: 'exp' },
    })
    // initial-v3-{profile} variants are gone — the base initial-v3 reads
    // modularPromptFiles from the active profile per turn.
    expect(id).toBe('initial-v3')
  })

  it('routes to initial-v3 when both modularPromptFiles and promptVersion 3.0 are set', async function modularPlusV3() {
    resolveProfileSpy.mockReturnValue(profile({
      name: 'both',
      properties: {
        'initial.modularPromptFiles': 'identity.md',
        'initial.promptVersion': '3.0',
      },
    }))

    const id = await resolveAgent({
      appId: 'app_new',
      agentContext: { agentProfile: 'both' },
    })
    expect(id).toBe('initial-v3')
  })

  it('routes to initial-v3 when only promptVersion 3.0 is set', async function v3Only() {
    resolveProfileSpy.mockReturnValue(profile({
      name: 'v3only',
      properties: { 'initial.promptVersion': '3.0' },
    }))

    const id = await resolveAgent({
      appId: 'app_new',
      agentContext: { agentProfile: 'v3only' },
    })
    expect(id).toBe('initial-v3')
  })

  it('falls back to initial when promptVersion 2.0 is set (variant removed)', async function v2Removed() {
    resolveProfileSpy.mockReturnValue(profile({
      name: 'v2prod',
      properties: { 'initial.promptVersion': '2.0' },
    }))

    const id = await resolveAgent({
      appId: 'app_new',
      agentContext: { agentProfile: 'v2prod' },
    })
    expect(id).toBe('initial')
  })

  it('routes to initial-<variant> when named manifest variant is registered', async function namedVariantRegistered() {
    resolveProfileSpy.mockReturnValue(profile({
      name: 'enhancer',
      properties: { 'initial.promptVersion': 'prompt-enhancer' },
    }))
    setRegisteredInitialNamedVariantIds(new Map([['prompt-enhancer', 'initial-prompt-enhancer']]))

    const id = await resolveAgent({
      appId: 'app_new',
      agentContext: { agentProfile: 'enhancer' },
    })
    expect(id).toBe('initial-prompt-enhancer')
  })

  it('falls back to initial and warns when named variant is unregistered (e.g. typo or build failure)', async function namedVariantMissing() {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(function () {})
    resolveProfileSpy.mockReturnValue(profile({
      name: 'typo',
      properties: { 'initial.promptVersion': 'prompt_enhancer' },
    }))

    const id = await resolveAgent({
      appId: 'app_new',
      agentContext: { agentProfile: 'typo' },
    })
    expect(id).toBe('initial')
    expect(warnSpy).toHaveBeenCalledWith(
      'agent_router.initial_named_variant_unregistered',
      expect.objectContaining({
        appId: 'app_new',
        profileName: 'typo',
        promptVersion: 'prompt_enhancer',
      }),
    )
    warnSpy.mockRestore()
  })

  it('does not enter the named-variant branch when promptVersion is absent', async function namedVariantNotApplied() {
    resolveProfileSpy.mockReturnValue(profile({
      name: 'no-version',
      properties: {},
    }))
    setRegisteredInitialNamedVariantIds(new Map([['prompt-enhancer', 'initial-prompt-enhancer']]))

    const id = await resolveAgent({
      appId: 'app_new',
      agentContext: { agentProfile: 'no-version' },
    })
    expect(id).toBe('initial')
  })

  it('does not warn for legacy numeric promptVersion 1.0 (falls through, no named-variant branch)', async function legacyNumeric() {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(function () {})
    resolveProfileSpy.mockReturnValue(profile({
      name: 'legacy',
      properties: { 'initial.promptVersion': '1.0' },
    }))

    const id = await resolveAgent({
      appId: 'app_new',
      agentContext: { agentProfile: 'legacy' },
    })
    expect(id).toBe('initial')
    expect(warnSpy).not.toHaveBeenCalledWith(
      'agent_router.initial_named_variant_unregistered',
      expect.anything(),
    )
    warnSpy.mockRestore()
  })

  it('treats whitespace-only promptVersion as absent (no named-variant routing, no warn)', async function whitespaceOnly() {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(function () {})
    resolveProfileSpy.mockReturnValue(profile({
      name: 'ws',
      properties: { 'initial.promptVersion': '   ' },
    }))

    const id = await resolveAgent({
      appId: 'app_new',
      agentContext: { agentProfile: 'ws' },
    })
    expect(id).toBe('initial')
    expect(warnSpy).not.toHaveBeenCalledWith(
      'agent_router.initial_named_variant_unregistered',
      expect.anything(),
    )
    warnSpy.mockRestore()
  })

  describe('session agent (concrete ids verbatim; base develop → develop-<profile>)', function sessionAgent() {
    const appId = 'app_session_1'

    function sessionWithAgent(agent: string) {
      const stateManager = {
        getCurrentAgent: vi.fn().mockReturnValue(agent),
        getSessionMetadata: vi.fn().mockReturnValue({ appId }),
        switchAgent: vi.fn().mockResolvedValue(undefined),
        setSessionMetadata: vi.fn(),
      }
      return { sessionId: 'sock-1', stateManager }
    }

    it('returns develop when session is develop, regardless of profile flags (variants flattened)', async function sessionToDevelop() {
      resolveProfileSpy.mockReturnValue(profile({
        name: 'expdev',
        properties: { 'develop.promptOptimization': true },
      }))

      const id = await resolveAgent({
        appId,
        agentContext: { agentProfile: 'expdev' },
        session: sessionWithAgent('develop'),
      })
      // Profile-driven prompt/tool gating now happens per-turn inside the
      // single `develop` agent's resolvers — no per-profile variant routing.
      expect(id).toBe('develop')
    })

    it('returns base develop verbatim when the profile has no develop/skill flags', async function sessionDevelopPlain() {
      resolveProfileSpy.mockReturnValue(profile({
        name: 'plain',
        properties: { 'initial.promptVersion': '3.0' },
      }))

      const id = await resolveAgent({
        appId,
        agentContext: { agentProfile: 'plain' },
        session: sessionWithAgent('develop'),
      })
      expect(id).toBe('develop')
    })

    it('returns develop when session is develop and profile has skill.* flags (variants flattened)', async function sessionDevelopWithSkillFlags() {
      resolveProfileSpy.mockReturnValue(profile({
        name: 'skillonly',
        properties: { 'skill.inbox.enabled': true },
      }))

      const id = await resolveAgent({
        appId,
        session: sessionWithAgent('develop'),
      })
      expect(id).toBe('develop')
    })

    it('returns base develop verbatim when no profile resolves (null)', async function sessionDevelopNullProfile() {
      resolveProfileSpy.mockReturnValue(null)

      const id = await resolveAgent({
        appId,
        session: sessionWithAgent('develop'),
      })
      expect(id).toBe('develop')
    })

    it('clears the session and ignores the stale agent when the session is bound to a different app', async function sessionAppChanged() {
      // Session still holds 'develop' for a previous app; the message targets a new app.
      const stateManager = {
        getCurrentAgent: vi.fn().mockReturnValue('develop'),
        getSessionMetadata: vi.fn().mockReturnValue({ appId: 'old_app' }),
        switchAgent: vi.fn().mockResolvedValue(undefined),
        setSessionMetadata: vi.fn(),
        clearSession: vi.fn(),
      }

      // Default resolveAgent: hasMessagesForApp=false, no persisted agent → brand-new app path.
      const id = await resolveAgent({ appId, session: { sessionId: 'sock-1', stateManager } })

      expect(stateManager.clearSession).toHaveBeenCalledWith('sock-1')
      // The stale 'develop' must not leak through; the new app routes fresh to 'initial'.
      expect(id).toBe('initial')
    })
  })

  describe('persisted agent fallback (browser reload / SSE — cold session)', function persistedAgentFallback() {
    const appId = 'app_persisted_1'

    function coldSession() {
      // New socket id after reload: no current agent stored.
      const stateManager = {
        getCurrentAgent: vi.fn().mockReturnValue(undefined),
        getSessionMetadata: vi.fn().mockReturnValue(undefined),
        switchAgent: vi.fn().mockResolvedValue(undefined),
        setSessionMetadata: vi.fn(),
      }
      return { sessionId: 'sock-new', stateManager }
    }

    it('returns persisted initial even when the app already has messages (the reload bug)', async function persistedInitialBeatsHasMessages() {
      // hasMessagesForApp=true would have wrongly promoted to develop pre-fix.
      const resolve = createAgentRouter({
        hasMessagesForApp: () => true,
        getModeIds: () => [],
        getPersistedAgentForApp: async () => 'initial',
      })

      const id = await resolve({ appId })
      expect(id).toBe('initial')
    })

    it('preserves the persisted initial variant verbatim (no re-resolution)', async function persistedInitialVariant() {
      const resolve = createAgentRouter({
        hasMessagesForApp: () => true,
        getModeIds: () => [],
        getPersistedAgentForApp: async () => 'initial-v3-exp',
      })

      const id = await resolve({ appId, agentContext: { agentProfile: 'exp' } })
      expect(id).toBe('initial-v3-exp')
    })

    it('returns persisted develop verbatim even when profile has develop.* flags (variants flattened)', async function persistedDevelopVariant() {
      resolveProfileSpy.mockReturnValue(profile({
        name: 'expdev',
        properties: { 'develop.promptOptimization': true },
      }))
      const resolve = createAgentRouter({
        hasMessagesForApp: () => true,
        getModeIds: () => [],
        getPersistedAgentForApp: async () => 'develop',
      })

      // Per-profile develop variants were flattened (#4346): profile-driven
      // prompt/tool gating happens per turn inside the single `develop` agent,
      // so the router returns the persisted id unchanged.
      const id = await resolve({ appId, agentContext: { agentProfile: 'expdev' } })
      expect(id).toBe('develop')
    })

    it('returns persisted base develop verbatim when the profile has no develop/skill flags', async function persistedDevelopPlain() {
      resolveProfileSpy.mockReturnValue(profile({
        name: 'plain',
        properties: { 'initial.promptVersion': '3.0' },
      }))
      const resolve = createAgentRouter({
        hasMessagesForApp: () => true,
        getModeIds: () => [],
        getPersistedAgentForApp: async () => 'develop',
      })

      const id = await resolve({ appId, agentContext: { agentProfile: 'plain' } })
      expect(id).toBe('develop')
    })

    it('preserves the persisted design-system initial variant across reload (AIROBUILD-2079 / #4437)', async function persistedDesignSystemSurvivesReload() {
      // The reported regression: a JWT agentProfile no longer steered an app whose
      // conversation was already stored. The stored concrete id is now returned
      // verbatim regardless of the current JWT profile.
      const resolve = createAgentRouter({
        hasMessagesForApp: () => true,
        getModeIds: () => [],
        getPersistedAgentForApp: async () => 'initial-v3-initial-agent-design-system',
      })

      const id = await resolve({ appId, agentContext: { agentProfile: 'some-other-profile' } })
      expect(id).toBe('initial-v3-initial-agent-design-system')
    })

    it('falls through to hasMessagesForApp when there is no persisted agent (brand-new app)', async function noPersistedFallsThrough() {
      const resolve = createAgentRouter({
        hasMessagesForApp: () => false,
        getModeIds: () => [],
        getPersistedAgentForApp: async () => undefined,
      })

      const id = await resolve({ appId: 'app_brand_new' })
      expect(id).toBe('initial')
    })

    it('does not abort the turn when the persisted-agent store read throws (falls through to heuristic)', async function persistedReadThrowsFallsThrough() {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(function () {})
      const resolve = createAgentRouter({
        hasMessagesForApp: () => false,
        getModeIds: () => [],
        getPersistedAgentForApp: async () => { throw new Error('sqlite locked') },
      })

      const id = await resolve({ appId })
      expect(id).toBe('initial')
      expect(warnSpy).toHaveBeenCalledWith(
        'agent_router.persisted_agent_check_failed',
        expect.objectContaining({ appId }),
      )
      warnSpy.mockRestore()
    })

    it('degrades to develop when the store read throws and the app already has messages', async function persistedReadThrowsExistingApp() {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(function () {})
      const resolve = createAgentRouter({
        hasMessagesForApp: () => true,
        getModeIds: () => [],
        getPersistedAgentForApp: async () => { throw new Error('sqlite locked') },
      })

      const id = await resolve({ appId })
      expect(id).toBe('develop')
      warnSpy.mockRestore()
    })

    it('emits an alertable error and defaults to develop when BOTH the store read and the heuristic throw', async function doubleStoreOutage() {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(function () {})
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(function () {})
      const resolve = createAgentRouter({
        hasMessagesForApp: () => { throw new Error('heuristic down') },
        getModeIds: () => [],
        getPersistedAgentForApp: async () => { throw new Error('sqlite locked') },
      })

      const id = await resolve({ appId })
      expect(id).toBe('develop')
      expect(errorSpy).toHaveBeenCalledWith(
        'agent_router.agent_resolution_degraded',
        expect.objectContaining({ appId }),
      )
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    })

    it('returns the turn (no unhandled rejection) when session rehydrate switchAgent rejects', async function rehydrateSwitchAgentRejects() {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(function () {})
      const resolve = createAgentRouter({
        hasMessagesForApp: () => true,
        getModeIds: () => [],
        getPersistedAgentForApp: async () => 'initial',
      })
      const stateManager = {
        getCurrentAgent: vi.fn().mockReturnValue(undefined),
        getSessionMetadata: vi.fn().mockReturnValue(undefined),
        switchAgent: vi.fn().mockRejectedValue(new Error('session write failed')),
        setSessionMetadata: vi.fn(),
      }

      const id = await resolve({ appId, session: { sessionId: 'sock-new', stateManager } })
      expect(id).toBe('initial')
      // rehydrate is fire-and-forget; flush the rejected microtask and confirm it
      // was caught (warn logged) rather than surfacing as an unhandled rejection.
      await Promise.resolve()
      await Promise.resolve()
      expect(warnSpy).toHaveBeenCalledWith(
        'agent_router.session_rehydrate_error',
        expect.objectContaining({ appId, agentId: 'initial' }),
      )
      warnSpy.mockRestore()
    })

    it('rehydrates the cold session with the raw persisted id', async function rehydratesSession() {
      const resolve = createAgentRouter({
        hasMessagesForApp: () => true,
        getModeIds: () => [],
        getPersistedAgentForApp: async () => 'initial',
      })
      const session = coldSession()

      const id = await resolve({ appId, session })
      expect(id).toBe('initial')
      expect(session.stateManager.switchAgent).toHaveBeenCalledWith('sock-new', 'initial')
      // setSessionMetadata runs in the switchAgent .then() — flush the microtask.
      await Promise.resolve()
      expect(session.stateManager.setSessionMetadata).toHaveBeenCalledWith('sock-new', expect.objectContaining({ appId }))
    })

    it('does not consult the persisted fallback when the session already has a matching agent', async function warmSessionSkipsFallback() {
      const getPersistedAgentForApp = vi.fn(async () => 'develop')
      const resolve = createAgentRouter({
        hasMessagesForApp: () => true,
        getModeIds: () => [],
        getPersistedAgentForApp,
      })
      const stateManager = {
        getCurrentAgent: vi.fn().mockReturnValue('initial'),
        getSessionMetadata: vi.fn().mockReturnValue({ appId }),
        switchAgent: vi.fn().mockResolvedValue(undefined),
        setSessionMetadata: vi.fn(),
      }

      const id = await resolve({ appId, session: { sessionId: 'sock-warm', stateManager } })
      expect(id).toBe('initial')
      expect(getPersistedAgentForApp).not.toHaveBeenCalled()
    })


    it('keeps warm session and store on the base design-system agent across install timing', async function designKitWarmRaceInvariant() {
      // AIROBUILD-2696 GATE 1: drive the real SessionStateManager + router precedence.
      // The per-turn -attached choice is derived later; router warm cache and store remain base.
      const baseAgentId = 'initial-design-system-homepage-build'
      const persistedAgent = baseAgentId
      const getPersistedAgentForApp = vi.fn(async () => persistedAgent)
      const resolve = createAgentRouter({
        hasMessagesForApp: () => true,
        getModeIds: () => [],
        getPersistedAgentForApp,
      })
      const stateManager = createSessionStateManager({ defaultAgentId: 'initial' })
      const session = { sessionId: 'sock-design-kit', stateManager }

      try {
        const coldResolved = await resolve({ appId, session })
        expect(coldResolved).toBe(baseAgentId)
        await Promise.resolve()
        expect(stateManager.getCurrentAgent(session.sessionId)).toBe(baseAgentId)
        expect(stateManager.getSessionMetadata(session.sessionId)).toEqual(expect.objectContaining({ appId }))

        // Simulate the install completing between turns. The invariant is that neither
        // the durable store nor the warm session is rewritten to the derived -attached id.
        expect(persistedAgent).toBe(baseAgentId)

        const warmResolved = await resolve({ appId, session })
        expect(warmResolved).toBe(baseAgentId)
        expect(getPersistedAgentForApp).toHaveBeenCalledTimes(1)
        expect(stateManager.getCurrentAgent(session.sessionId)).toBe(baseAgentId)
        expect(persistedAgent).toBe(baseAgentId)
      } finally {
        stateManager.stopCleanup()
      }
    })
  })

  it('honors a /agent override above the stored agent', async function manualOverrideWins() {
    const resolve = createAgentRouter({
      hasMessagesForApp: () => true,
      getModeIds: () => [],
      getPersistedAgentForApp: async () => 'develop',
    })

    const id = await resolve({ appId: 'app_existing', manualAgentOverride: 'marketing' })
    expect(id).toBe('marketing')
  })

  it('honors a /agent override above a session agent without reading the store', async function manualOverrideBeatsSession() {
    const getPersistedAgentForApp = vi.fn(async () => 'develop')
    const resolve = createAgentRouter({
      hasMessagesForApp: () => true,
      getModeIds: () => [],
      getPersistedAgentForApp,
    })
    const stateManager = {
      getCurrentAgent: vi.fn().mockReturnValue('develop'),
      getSessionMetadata: vi.fn().mockReturnValue({ appId: 'app_existing' }),
      switchAgent: vi.fn().mockResolvedValue(undefined),
      setSessionMetadata: vi.fn(),
    }

    const id = await resolve({ appId: 'app_existing', manualAgentOverride: 'marketing', session: { sessionId: 'sock-1', stateManager } })
    expect(id).toBe('marketing')
    expect(stateManager.getCurrentAgent).not.toHaveBeenCalled()
    expect(getPersistedAgentForApp).not.toHaveBeenCalled()
  })

  it('routes to initial-v3 when modularPromptFiles is set even if promptVersion is 2.0', async function modularBeatsLegacyV2() {
    resolveProfileSpy.mockReturnValue(profile({
      name: 'mixed',
      properties: {
        'initial.modularPromptFiles': 'identity.md',
        'initial.promptVersion': '2.0',
      },
    }))

    const id = await resolveAgent({
      appId: 'app_new',
      agentContext: { agentProfile: 'mixed' },
    })
    // modularPromptFiles wins over promptVersion 2.0 — the modular branch
    // routes to base initial-v3 (no per-profile variant exists anymore).
    expect(id).toBe('initial-v3')
  })

  // Per-profile variant routing was removed — develop-{profile} and
  // initial-v3-{profile} no longer exist. Profile-driven prompt and tool
  // gating happens per turn inside the agent's resolvers (see agents/CLAUDE.md
  // and develop-agent.ts / initial-agent.ts).
})
