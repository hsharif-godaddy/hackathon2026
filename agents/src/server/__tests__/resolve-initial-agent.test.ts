import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as profiles from '../../profiles/index.js'
import { resolveInitialAgentId } from '../resolve-initial-agent.js'
import { setRegisteredInitialNamedVariantIds } from '../../agents/registered-initial-named-variant-ids.js'
import { logger } from '../../logging/index.js'
import type { ProfileData } from '../../profiles/types.js'

describe('resolveInitialAgentId', function resolveInitialAgentTests() {
  const noTemplates = () => [] as string[]
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
    return { description: '', ...partial }
  }

  describe('create-time priority order', function priority() {
    it('1. ?template= wins over the JWT profile', function templateBeatsJwt() {
      resolveProfileSpy.mockReturnValue(profile({ name: 'jwtp', properties: { 'initial.promptVersion': '3.0' } }))

      const id = resolveInitialAgentId({
        appId: 'app_new',
        templateId: 'v8',
        jwtAgentProfile: 'jwtp',
        getModeIds: () => ['v8'],
      })
      expect(id).toBe('initial-v8')
      // The JWT profile branch must not have been consulted once the template matched.
      expect(resolveProfileSpy).not.toHaveBeenCalled()
    })

    it('2. JWT profile is used when there is no template', function jwtProfile() {
      resolveProfileSpy.mockReturnValue(profile({ name: 'jwtp', properties: { 'initial.promptVersion': '3.0' } }))

      const id = resolveInitialAgentId({
        appId: 'app_new',
        jwtAgentProfile: 'jwtp',
        getModeIds: noTemplates,
      })
      expect(id).toBe('initial-v3')
    })

    it('3. defaults to initial-v3 when nothing applies', function defaultInitial() {
      resolveProfileSpy.mockReturnValue(null)
      const id = resolveInitialAgentId({ appId: 'app_new', getModeIds: noTemplates })
      expect(id).toBe('initial-v3')
    })

    it('ignores an unregistered template', function unregisteredTemplate() {
      resolveProfileSpy.mockReturnValue(null)
      const id = resolveInitialAgentId({
        appId: 'app_new',
        templateId: 'not-a-template',
        getModeIds: () => ['v8'],
      })
      expect(id).toBe('initial-v3')
    })
  })

  describe('internal start-as override (?agent=)', function startOverride() {
    const startable = () => ['initial-v3', 'develop', 'marketing', 'deep-build', 'initial-logo-designer']

    it('overrides ?template= AND the JWT profile when enabled + valid', function overrideWins() {
      resolveProfileSpy.mockReturnValue(profile({ name: 'jwtp', properties: { 'initial.promptVersion': '3.0' } }))
      const id = resolveInitialAgentId({
        appId: 'app_new',
        overrideAgentId: 'develop',
        startOverrideEnabled: true,
        getStartableAgentIds: startable,
        templateId: 'logo-designer',
        jwtAgentProfile: 'jwtp',
        getModeIds: () => ['logo-designer'],
      })
      expect(id).toBe('develop')
      // Winning at priority 0 means neither the template nor the profile branch runs.
      expect(resolveProfileSpy).not.toHaveBeenCalled()
    })

    it('can start any registered top-level agent, e.g. deep-build', function anyStartable() {
      const id = resolveInitialAgentId({
        appId: 'app_new',
        overrideAgentId: 'deep-build',
        startOverrideEnabled: true,
        getStartableAgentIds: startable,
        getModeIds: noTemplates,
      })
      expect(id).toBe('deep-build')
    })

    it('is ignored when not gated (falls through to template)', function notGated() {
      resolveProfileSpy.mockReturnValue(null)
      const id = resolveInitialAgentId({
        appId: 'app_new',
        overrideAgentId: 'develop',
        startOverrideEnabled: false,
        getStartableAgentIds: startable,
        templateId: 'logo-designer',
        getModeIds: () => ['logo-designer'],
      })
      expect(id).toBe('initial-logo-designer')
    })

    it('is ignored + warns when the id is not a startable agent (falls through to default)', function invalidId() {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(function () {})
      resolveProfileSpy.mockReturnValue(null)
      const id = resolveInitialAgentId({
        appId: 'app_new',
        overrideAgentId: 'planning', // a sub-agent — never in the startable set
        startOverrideEnabled: true,
        getStartableAgentIds: startable,
        getModeIds: noTemplates,
      })
      expect(id).toBe('initial-v3')
      expect(warnSpy).toHaveBeenCalledWith('agent_router.start_override_invalid', expect.objectContaining({ overrideAgentId: 'planning' }))
      warnSpy.mockRestore()
    })

    it('is ignored when overrideAgentId is absent (normal resolution)', function absent() {
      resolveProfileSpy.mockReturnValue(null)
      const id = resolveInitialAgentId({
        appId: 'app_new',
        startOverrideEnabled: true,
        getStartableAgentIds: startable,
        getModeIds: noTemplates,
      })
      expect(id).toBe('initial-v3')
    })
  })

  describe('concrete initial variant from a resolved profile', function variants() {
    function withJwtProfile(p: ProfileData) {
      resolveProfileSpy.mockReturnValue(p)
      return resolveInitialAgentId({ appId: 'app_new', jwtAgentProfile: p.name, getModeIds: noTemplates })
    }

    it('routes to base initial-v3 when modularPromptFiles is configured (variants flattened)', function modularFlattened() {
      expect(withJwtProfile(profile({ name: 'exp', properties: { 'initial.modularPromptFiles': 'identity.md' } }))).toBe('initial-v3')
    })

    it('looks up the trimmed promptVersion for named variants (padded value resolves)', function paddedNamedVariant() {
      setRegisteredInitialNamedVariantIds(new Map([['design-system', 'initial-design-system']]))
      expect(withJwtProfile(profile({ name: 'ds', properties: { 'initial.promptVersion': '  design-system  ' } }))).toBe('initial-design-system')
    })

    it('prefers the modular branch over promptVersion 3.0 (both resolve to initial-v3)', function modularBeatsV3() {
      expect(withJwtProfile(profile({ name: 'both', properties: { 'initial.modularPromptFiles': 'identity.md', 'initial.promptVersion': '3.0' } }))).toBe('initial-v3')
    })

    it('routes to initial-v3 for promptVersion 3.0', function v3Only() {
      expect(withJwtProfile(profile({ name: 'v3only', properties: { 'initial.promptVersion': '3.0' } }))).toBe('initial-v3')
    })

    it('falls back to initial-v3 for legacy numeric promptVersion 2.0', function v2Removed() {
      expect(withJwtProfile(profile({ name: 'v2prod', properties: { 'initial.promptVersion': '2.0' } }))).toBe('initial-v3')
    })

    it('routes to a registered named manifest variant', function namedVariantRegistered() {
      setRegisteredInitialNamedVariantIds(new Map([['design-system', 'initial-design-system']]))
      expect(withJwtProfile(profile({ name: 'ds', properties: { 'initial.promptVersion': 'design-system' } }))).toBe('initial-design-system')
    })

    it('falls back to initial-v3 and warns when a named variant is unregistered', function namedVariantMissing() {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(function () {})
      expect(withJwtProfile(profile({ name: 'typo', properties: { 'initial.promptVersion': 'prompt_enhancer' } }))).toBe('initial-v3')
      expect(warnSpy).toHaveBeenCalledWith('agent_router.initial_named_variant_unregistered', expect.objectContaining({ profileName: 'typo', promptVersion: 'prompt_enhancer' }))
      warnSpy.mockRestore()
    })

    it('does not enter the named-variant branch when promptVersion is absent', function noVersion() {
      setRegisteredInitialNamedVariantIds(new Map([['design-system', 'initial-design-system']]))
      expect(withJwtProfile(profile({ name: 'no-version', properties: {} }))).toBe('initial-v3')
    })

    it('routes the experimental profile (model/skill overrides, no promptVersion) to initial-v3', function experimentalToV3() {
      expect(withJwtProfile(profile({ name: 'experimental', properties: { 'model.default': 'claude-opus-4-6' } }))).toBe('initial-v3')
    })
  })
})
