import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as profiles from '../../profiles/index.js'
import { createAgentRouter } from '../agent-router.js'
import {
  getRegisteredInitialV3ModularAgentIds,
  setRegisteredInitialV3ModularAgentIds,
} from '../../agents/registered-initial-modular-agent-ids.js'
import { setRegisteredInitialNamedVariantIds } from '../../agents/registered-initial-named-variant-ids.js'
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
    setRegisteredInitialNamedVariantIds(new Map())
  })

  afterEach(function teardown() {
    resolveProfileSpy.mockRestore()
    setRegisteredInitialV3ModularAgentIds(new Set())
    setRegisteredInitialNamedVariantIds(new Map())
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
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
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
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
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
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
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

    it('returns develop when session is develop but profile has no develop.* or skill.* keys', async function sessionDevelopNoFlags() {
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

    it('returns develop-<profile> when session is develop and profile has skill.* flags', async function sessionToDevelopVariantSkillFlags() {
      resolveProfileSpy.mockReturnValue(profile({
        name: 'skillonly',
        properties: { 'skill.conversations.enabled': true },
      }))

      const id = await resolveAgent({
        appId,
        agentContext: { agentProfile: 'skillonly' },
        session: sessionWithAgent('develop'),
      })
      expect(id).toBe('develop-skillonly')
    })
  })

  it('routes to develop-<profile> for existing app when profile has skill.* flags', async function existingAppSkillFlags() {
    const resolveAgentWithMessages = createAgentRouter({
      hasMessagesForApp: () => true,
      getTemplateIds: () => [],
    })
    resolveProfileSpy.mockReturnValue(profile({
      name: 'skillonly',
      properties: { 'skill.conversations.enabled': true },
    }))

    const id = await resolveAgentWithMessages({
      appId: 'app_existing',
      agentContext: { agentProfile: 'skillonly' },
    })
    expect(id).toBe('develop-skillonly')
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
