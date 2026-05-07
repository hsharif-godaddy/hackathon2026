import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as profiles from '../../profiles/index.js'
import { createAgentRouter } from '../agent-router.js'
import {
  getRegisteredInitialV3ModularAgentIds,
  setRegisteredInitialV3ModularAgentIds,
} from '../../agents/registered-initial-modular-agent-ids.js'
import { logger } from '../../logging/index.js'
import type { ProfileData } from '../../profiles/types.js'

describe('agent-router', function agentRouterTests() {
  const resolveAgent = createAgentRouter({
    hasMessagesForApp: () => false,
    getTemplateIds: () => [],
  })

  let resolveProfileSpy: ReturnType<typeof vi.spyOn>

  beforeEach(function setup() {
    resolveProfileSpy = vi.spyOn(profiles, 'resolveProfile')
    setRegisteredInitialV3ModularAgentIds(new Set())
  })

  afterEach(function teardown() {
    resolveProfileSpy.mockRestore()
    setRegisteredInitialV3ModularAgentIds(new Set())
  })

  function profile(partial: Partial<ProfileData> & Pick<ProfileData, 'name' | 'properties'>): ProfileData {
    return {
      description: '',
      ...partial,
    }
  }

  it('routes to initial-v3-<profile> when modular prompt override is registered', async function modularRegistered() {
    resolveProfileSpy.mockReturnValue(profile({
      name: 'exp',
      properties: { 'initial.modularPromptFiles': 'identity.md' },
    }))
    setRegisteredInitialV3ModularAgentIds(new Set(['initial-v3-exp']))

    const id = await resolveAgent({
      appId: 'app_new',
      agentContext: { agentProfile: 'exp' },
    })
    expect(id).toBe('initial-v3-exp')
  })

  it('falls back to initial-v3 when modular variant failed to register at startup', async function modularMissing() {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    resolveProfileSpy.mockReturnValue(profile({
      name: 'broken',
      properties: { 'initial.modularPromptFiles': 'identity.md' },
    }))
    expect(getRegisteredInitialV3ModularAgentIds().has('initial-v3-broken')).toBe(false)

    const id = await resolveAgent({
      appId: 'app_new',
      agentContext: { agentProfile: 'broken' },
    })
    expect(id).toBe('initial-v3')
    expect(warnSpy).toHaveBeenCalledWith(
      'agent_router.initial_modular_variant_unregistered',
      expect.objectContaining({
        appId: 'app_new',
        profileName: 'broken',
        variantId: 'initial-v3-broken',
        fallbackAgentId: 'initial-v3',
      }),
    )
    warnSpy.mockRestore()
  })

  it('prefers modular branch over promptVersion 3.0 when both are set', async function modularBeatsV3() {
    resolveProfileSpy.mockReturnValue(profile({
      name: 'both',
      properties: {
        'initial.modularPromptFiles': 'identity.md',
        'initial.promptVersion': '3.0',
      },
    }))
    setRegisteredInitialV3ModularAgentIds(new Set(['initial-v3-both']))

    const id = await resolveAgent({
      appId: 'app_new',
      agentContext: { agentProfile: 'both' },
    })
    expect(id).toBe('initial-v3-both')
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

  it('routes to initial-v2 when only promptVersion 2.0 is set', async function v2Only() {
    resolveProfileSpy.mockReturnValue(profile({
      name: 'v2prod',
      properties: { 'initial.promptVersion': '2.0' },
    }))

    const id = await resolveAgent({
      appId: 'app_new',
      agentContext: { agentProfile: 'v2prod' },
    })
    expect(id).toBe('initial-v2')
  })

  describe('session develop reroute', function sessionDevelopReroute() {
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

    it('returns develop-<profile> when session is develop and profile has develop.* flags', async function sessionToDevelopVariant() {
      resolveProfileSpy.mockReturnValue(profile({
        name: 'expdev',
        properties: { 'develop.promptOptimization': true },
      }))

      const id = await resolveAgent({
        appId,
        agentContext: { agentProfile: 'expdev' },
        session: sessionWithAgent('develop'),
      })
      expect(id).toBe('develop-expdev')
    })

    it('returns develop when session is develop but resolveProfile returns null', async function sessionDevelopNoProfile() {
      resolveProfileSpy.mockReturnValue(null)

      const id = await resolveAgent({
        appId,
        agentContext: { agentProfile: 'expdev' },
        session: sessionWithAgent('develop'),
      })
      expect(id).toBe('develop')
    })

    it('returns develop when session is develop but profile has no develop.* keys', async function sessionDevelopNoFlags() {
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
  })

  it('router prefers modular branch when both modularPromptFiles and promptVersion 2.0 are set', async function modularBeatsV2InRouter() {
    resolveProfileSpy.mockReturnValue(profile({
      name: 'mixed',
      properties: {
        'initial.modularPromptFiles': 'identity.md',
        'initial.promptVersion': '2.0',
      },
    }))
    setRegisteredInitialV3ModularAgentIds(new Set(['initial-v3-mixed']))

    const id = await resolveAgent({
      appId: 'app_new',
      agentContext: { agentProfile: 'mixed' },
    })
    expect(id).toBe('initial-v3-mixed')
  })
})
