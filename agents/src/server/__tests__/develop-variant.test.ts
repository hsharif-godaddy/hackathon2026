import { describe, it, expect, vi } from 'vitest'
import { concreteDevelopForProfile, persistHandoffAgent, profileHasDevelopFlags } from '../develop-variant.js'
import { runWithProfile } from '../../profiles/index.js'
import type { ProfileData } from '../../profiles/types.js'

function profile(partial: Partial<ProfileData> & Pick<ProfileData, 'name' | 'properties'>): ProfileData {
  return { description: '', ...partial }
}

describe('develop-variant', function developVariantTests() {
  describe('profileHasDevelopFlags', function flags() {
    it('is true for a develop.* property', function develop() {
      expect(profileHasDevelopFlags(profile({ name: 'x', properties: { 'develop.promptOptimization': true } }))).toBe(true)
    })
    it('is true for a skill.* property', function skill() {
      expect(profileHasDevelopFlags(profile({ name: 'x', properties: { 'skill.inbox.enabled': true } }))).toBe(true)
    })
    it('is false for an initial-only profile', function initialOnly() {
      expect(profileHasDevelopFlags(profile({ name: 'x', properties: { 'initial.promptVersion': '3.0' } }))).toBe(false)
    })
    it('is false for null', function none() {
      expect(profileHasDevelopFlags(null)).toBe(false)
    })
  })

  describe('concreteDevelopForProfile (pass-through after variant flattening #4346)', function map() {
    it('returns base develop unchanged even when the profile has develop/skill flags', function noMap() {
      expect(concreteDevelopForProfile('develop', profile({ name: 'experimental', properties: { 'skill.inbox.enabled': true } }))).toBe('develop')
    })
    it('returns base develop unchanged when the profile has no develop/skill flags', function noFlags() {
      expect(concreteDevelopForProfile('develop', profile({ name: 'ds', properties: { 'initial.promptVersion': 'design-system' } }))).toBe('develop')
    })
    it('returns base develop unchanged when there is no profile', function noProfile() {
      expect(concreteDevelopForProfile('develop', null)).toBe('develop')
    })
    it('passes through non-develop agents unchanged', function others() {
      const p = profile({ name: 'experimental', properties: { 'skill.inbox.enabled': true } })
      expect(concreteDevelopForProfile('initial', p)).toBe('initial')
      expect(concreteDevelopForProfile('marketing', p)).toBe('marketing')
    })
  })

  describe('persistHandoffAgent', function persist() {
    function store() {
      return { updateAgentId: vi.fn().mockResolvedValue(undefined) }
    }

    it('persists base develop unchanged even when active profile has develop/skill flags (variants flattened)', async function flagged() {
      const s = store()
      const returned = await runWithProfile(
        profile({ name: 'experimental', properties: { 'skill.inbox.enabled': true } }),
        () => persistHandoffAgent(s, 'conv-1', 'develop'),
      )
      expect(s.updateAgentId).toHaveBeenCalledWith('conv-1', 'develop')
      expect(returned).toBe('develop')
    })

    it('persists base develop when the active profile has no develop/skill flags', async function noFlags() {
      const s = store()
      await runWithProfile(
        profile({ name: 'ds', properties: { 'initial.promptVersion': 'design-system' } }),
        () => persistHandoffAgent(s, 'conv-1', 'develop'),
      )
      expect(s.updateAgentId).toHaveBeenCalledWith('conv-1', 'develop')
    })

    it('persists base develop verbatim when no profile is active', async function noProfile() {
      const s = store()
      await persistHandoffAgent(s, 'conv-1', 'develop')
      expect(s.updateAgentId).toHaveBeenCalledWith('conv-1', 'develop')
    })

    it('propagates a store failure (fatal handoff contract)', async function propagates() {
      const s = { updateAgentId: vi.fn().mockRejectedValue(new Error('sqlite locked')) }
      await expect(persistHandoffAgent(s, 'conv-1', 'develop')).rejects.toThrow('sqlite locked')
    })
  })
})
