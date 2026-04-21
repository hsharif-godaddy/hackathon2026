import { describe, expect, it } from 'vitest'

import { runWithProfile } from '../profile-context.js'
import {
  activeProfileName,
  hasActiveProfile,
  profileFlag,
  profileValue,
} from '../profile-accessor.js'
import type { ProfileData } from '../types.js'

const testProfile: ProfileData = {
  name: 'test-profile',
  description: 'Test',
  properties: {
    'model.default': 'claude-opus-4-6',
    'feature.enabled': true,
    'feature.disabled': false,
    'context.maxHistory': 50,
    'nullable.key': null,
  },
}

describe('profile-accessor', function profileAccessorTests() {
  describe('profileValue', function profileValueTests() {
    it('returns default when no profile is active', function noProfile() {
      expect(profileValue('model.default', 'claude-sonnet-4-6')).toBe('claude-sonnet-4-6')
    })

    it('returns profile value when profile is active', function withProfile() {
      runWithProfile(testProfile, () => {
        expect(profileValue('model.default', 'claude-sonnet-4-6')).toBe('claude-opus-4-6')
      })
    })

    it('returns default when key is not in profile', function missingKey() {
      runWithProfile(testProfile, () => {
        expect(profileValue('nonexistent.key', 'fallback')).toBe('fallback')
      })
    })

    it('returns number values', function numberValue() {
      runWithProfile(testProfile, () => {
        expect(profileValue('context.maxHistory', 10)).toBe(50)
      })
    })

    it('returns default when profile value is null', function nullValue() {
      runWithProfile(testProfile, () => {
        expect(profileValue('nullable.key', 'default')).toBe('default')
      })
    })

    it('returns default when profile value type mismatches', function typeMismatch() {
      runWithProfile(testProfile, () => {
        expect(profileValue('feature.enabled', 'string-default')).toBe('string-default')
        expect(profileValue('model.default', 42)).toBe(42)
      })
    })
  })

  describe('profileFlag', function profileFlagTests() {
    it('returns false by default when no profile is active', function noProfileDefault() {
      expect(profileFlag('feature.enabled')).toBe(false)
    })

    it('returns custom default when no profile is active', function customDefault() {
      expect(profileFlag('feature.enabled', true)).toBe(true)
    })

    it('returns true when flag is true in profile', function trueFlag() {
      runWithProfile(testProfile, () => {
        expect(profileFlag('feature.enabled')).toBe(true)
      })
    })

    it('returns false when flag is false in profile', function falseFlag() {
      runWithProfile(testProfile, () => {
        expect(profileFlag('feature.disabled', true)).toBe(false)
      })
    })

    it('returns default when flag key is missing from profile', function missingFlag() {
      runWithProfile(testProfile, () => {
        expect(profileFlag('feature.nonexistent', true)).toBe(true)
      })
    })
  })

  describe('hasActiveProfile', function hasActiveProfileTests() {
    it('returns false when no profile is active', function inactive() {
      expect(hasActiveProfile()).toBe(false)
    })

    it('returns true when profile is active', function active() {
      runWithProfile(testProfile, () => {
        expect(hasActiveProfile()).toBe(true)
      })
    })
  })

  describe('activeProfileName', function activeProfileNameTests() {
    it('returns null when no profile is active', function inactive() {
      expect(activeProfileName()).toBeNull()
    })

    it('returns the profile name when active', function active() {
      runWithProfile(testProfile, () => {
        expect(activeProfileName()).toBe('test-profile')
      })
    })
  })
})
