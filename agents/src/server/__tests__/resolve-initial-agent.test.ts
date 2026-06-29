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
        getTemplateIds: () => ['v8'],
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
        getTemplateIds: noTemplates,
      })
      expect(id).toBe('initial-v3')
    })

    it('3. defaults to base initial when nothing applies', function defaultInitial() {
      resolveProfileSpy.mockReturnValue(null)
      const id = resolveInitialAgentId({ appId: 'app_new', getTemplateIds: noTemplates })
      expect(id).toBe('initial')
    })

    it('ignores an unregistered template', function unregisteredTemplate() {
      resolveProfileSpy.mockReturnValue(null)
      const id = resolveInitialAgentId({
        appId: 'app_new',
        templateId: 'not-a-template',
        getTemplateIds: () => ['v8'],
      })
      expect(id).toBe('initial')
    })
  })

  describe('concrete initial variant from a resolved profile', function variants() {
    function withJwtProfile(p: ProfileData) {
      resolveProfileSpy.mockReturnValue(p)
      return resolveInitialAgentId({ appId: 'app_new', jwtAgentProfile: p.name, getTemplateIds: noTemplates })
    }

    it('routes to base initial-v3 when modularPromptFiles is configured (variants flattened)', function modularFlattened() {
      expect(withJwtProfile(profile({ name: 'exp', properties: { 'initial.modularPromptFiles': 'identity.md' } }))).toBe('initial-v3')
    })

    it('looks up the trimmed promptVersion for named variants (padded value resolves)', function paddedNamedVariant() {
      setRegisteredInitialNamedVariantIds(new Map([['prompt-enhancer', 'initial-prompt-enhancer']]))
      expect(withJwtProfile(profile({ name: 'enhancer', properties: { 'initial.promptVersion': '  prompt-enhancer  ' } }))).toBe('initial-prompt-enhancer')
    })

    it('prefers the modular branch over promptVersion 3.0 (both resolve to initial-v3)', function modularBeatsV3() {
      expect(withJwtProfile(profile({ name: 'both', properties: { 'initial.modularPromptFiles': 'identity.md', 'initial.promptVersion': '3.0' } }))).toBe('initial-v3')
    })

    it('routes to initial-v3 for promptVersion 3.0', function v3Only() {
      expect(withJwtProfile(profile({ name: 'v3only', properties: { 'initial.promptVersion': '3.0' } }))).toBe('initial-v3')
    })

    it('falls back to initial for legacy promptVersion 2.0', function v2Removed() {
      expect(withJwtProfile(profile({ name: 'v2prod', properties: { 'initial.promptVersion': '2.0' } }))).toBe('initial')
    })

    it('routes to a registered named manifest variant', function namedVariantRegistered() {
      setRegisteredInitialNamedVariantIds(new Map([['prompt-enhancer', 'initial-prompt-enhancer']]))
      expect(withJwtProfile(profile({ name: 'enhancer', properties: { 'initial.promptVersion': 'prompt-enhancer' } }))).toBe('initial-prompt-enhancer')
    })

    it('falls back to initial and warns when a named variant is unregistered', function namedVariantMissing() {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(function () {})
      expect(withJwtProfile(profile({ name: 'typo', properties: { 'initial.promptVersion': 'prompt_enhancer' } }))).toBe('initial')
      expect(warnSpy).toHaveBeenCalledWith('agent_router.initial_named_variant_unregistered', expect.objectContaining({ profileName: 'typo', promptVersion: 'prompt_enhancer' }))
      warnSpy.mockRestore()
    })

    it('does not enter the named-variant branch when promptVersion is absent', function noVersion() {
      setRegisteredInitialNamedVariantIds(new Map([['prompt-enhancer', 'initial-prompt-enhancer']]))
      expect(withJwtProfile(profile({ name: 'no-version', properties: {} }))).toBe('initial')
    })

    it('does not warn for legacy numeric promptVersion 1.0', function legacyNumeric() {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(function () {})
      expect(withJwtProfile(profile({ name: 'legacy', properties: { 'initial.promptVersion': '1.0' } }))).toBe('initial')
      expect(warnSpy).not.toHaveBeenCalledWith('agent_router.initial_named_variant_unregistered', expect.anything())
      warnSpy.mockRestore()
    })
  })
})
