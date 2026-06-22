import { describe, expect, it, vi, beforeEach } from 'vitest'

import type { ProfileData } from '../types.js'

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('../../logging/index.js', () => ({
  logger: mockLogger,
}))

import { getProfileRegistry, resolveProfile } from '../index.js'

describe('profile-registry', function registryTests() {
  beforeEach(function resetMocks() {
    mockLogger.info.mockReset()
    mockLogger.warn.mockReset()
    mockLogger.error.mockReset()
    mockLogger.debug.mockReset()
  })

  describe('getProfileRegistry', function getRegistryTests() {
    it('loads the experimental profile', function loadsExperimental() {
      const registry = getProfileRegistry()
      expect(registry.has('experimental')).toBe(true)
      const profile = registry.get('experimental')!
      expect(profile.name).toBe('experimental')
      expect(profile.description).toBeTruthy()
    })

    it('loads the content-system profile with develop.contentSystem enabled', function loadsContentSystem() {
      const registry = getProfileRegistry()
      expect(registry.has('content-system')).toBe(true)
      expect(registry.get('content-system')!.properties['develop.contentSystem']).toBe(true)
    })
  })

  describe('resolveProfile', function resolveTests() {
    it('returns null when no override specified', function noOverride() {
      const result = resolveProfile({
        agentProfileSelectorEnabled: true,
        perProjectProfile: undefined,
        jwtAgentProfile: undefined,
      })
      expect(result).toBeNull()
    })

    it('returns profile from JWT claim', function jwtProfile() {
      const result = resolveProfile({
        agentProfileSelectorEnabled: false,
        perProjectProfile: undefined,
        jwtAgentProfile: 'experimental',
      })
      expect(result).not.toBeNull()
      expect(result!.name).toBe('experimental')
    })

    it('per-project overrides JWT when selector enabled', function perProjectPriority() {
      const result = resolveProfile({
        agentProfileSelectorEnabled: true,
        perProjectProfile: 'experimental',
        jwtAgentProfile: undefined,
      })
      expect(result).not.toBeNull()
      expect(result!.name).toBe('experimental')
    })

    it('ignores per-project when selector disabled', function selectorDisabled() {
      const result = resolveProfile({
        agentProfileSelectorEnabled: false,
        perProjectProfile: 'experimental',
        jwtAgentProfile: undefined,
      })
      expect(result).toBeNull()
    })

    it('returns null and logs warning for unknown profile', function unknownProfile() {
      const result = resolveProfile({
        agentProfileSelectorEnabled: true,
        perProjectProfile: 'nonexistent',
        jwtAgentProfile: undefined,
      })
      expect(result).toBeNull()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'profile.resolve.unknown',
        expect.objectContaining({ profileName: 'nonexistent' }),
      )
    })

    it('returns null for "default" profile name from JWT', function defaultProfile() {
      const result = resolveProfile({
        agentProfileSelectorEnabled: false,
        perProjectProfile: undefined,
        jwtAgentProfile: 'default',
      })
      expect(result).toBeNull()
    })

    it('returns null for empty string profile name', function emptyString() {
      const result = resolveProfile({
        agentProfileSelectorEnabled: false,
        perProjectProfile: undefined,
        jwtAgentProfile: '',
      })
      expect(result).toBeNull()
    })
  })
})
