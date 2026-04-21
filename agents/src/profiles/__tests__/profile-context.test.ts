import { describe, expect, it } from 'vitest'

import type { ProfileData } from '../types.js'
import {
  getActiveProfile,
  runWithProfile,
} from '../profile-context.js'

const testProfile: ProfileData = {
  name: 'test-profile',
  description: 'Test',
  properties: {
    'model.default': 'claude-opus-4-6',
    'feature.test': true,
  },
}

describe('profile-context', function profileContextTests() {
  it('returns null when no profile is active', function noProfile() {
    expect(getActiveProfile()).toBeNull()
  })

  it('returns the active profile inside runWithProfile', function activeProfile() {
    runWithProfile(testProfile, () => {
      const active = getActiveProfile()
      expect(active).not.toBeNull()
      expect(active!.name).toBe('test-profile')
      expect(active!.properties['model.default']).toBe('claude-opus-4-6')
    })
  })

  it('returns null after runWithProfile completes', function afterRun() {
    runWithProfile(testProfile, () => {})
    expect(getActiveProfile()).toBeNull()
  })

  it('supports nested runWithProfile (inner overrides outer)', function nested() {
    const innerProfile: ProfileData = {
      name: 'inner',
      description: 'Inner',
      properties: { 'model.default': 'claude-haiku-4-5' },
    }
    runWithProfile(testProfile, () => {
      expect(getActiveProfile()!.name).toBe('test-profile')
      runWithProfile(innerProfile, () => {
        expect(getActiveProfile()!.name).toBe('inner')
      })
      expect(getActiveProfile()!.name).toBe('test-profile')
    })
  })

  it('propagates through async calls', async function asyncPropagation() {
    await runWithProfile(testProfile, async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(getActiveProfile()!.name).toBe('test-profile')
    })
  })
})
