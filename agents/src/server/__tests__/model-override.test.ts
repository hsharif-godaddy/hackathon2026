import { describe, expect, it } from 'vitest'

import { ALLOWED_OVERRIDE_MODELS } from '../constants.js'
import {
  guardAllowedOverrideModel,
  resolveOverride,
} from '../model-override.js'

describe('model-override', function modelOverrideSuite() {
  describe('#resolveOverride', function resolveOverrideTests() {
    it('returns undefined when no override in context and no JWT modelOverride', function emptyOverrides() {
      expect(resolveOverride({
        modelSelectorEnabled: true,
        perProjectModel: undefined,
        jwtModelOverride: undefined,
      })).toBeUndefined()
    })

    it('uses per-project override when modelSelectorEnabled is true', function perProjectWins() {
      expect(resolveOverride({
        modelSelectorEnabled: true,
        perProjectModel: 'haiku',
        jwtModelOverride: 'sonnet',
      })).toBe('haiku')
    })

    it('ignores per-project override when modelSelectorEnabled is false', function ignoresPerProject() {
      expect(resolveOverride({
        modelSelectorEnabled: false,
        perProjectModel: 'haiku',
        jwtModelOverride: 'sonnet',
      })).toBe('sonnet')
    })

    it('falls back to JWT modelOverride when no per-project override', function jwtFallback() {
      expect(resolveOverride({
        modelSelectorEnabled: true,
        perProjectModel: undefined,
        jwtModelOverride: 'claude-sonnet-4-5',
      })).toBe('claude-sonnet-4-5')
    })

    it('per-project override takes priority over JWT modelOverride', function perProjectPriority() {
      expect(resolveOverride({
        modelSelectorEnabled: true,
        perProjectModel: 'claude-sonnet-4-6',
        jwtModelOverride: 'claude-sonnet-4-5',
      })).toBe('claude-sonnet-4-6')
    })
  })

  describe('#guardAllowedOverrideModel', function guardTests() {
    it('returns the model when it is in the allowed set', function allowed() {
      expect(guardAllowedOverrideModel('claude-sonnet-4-6', 'develop', () => {})).toBe('claude-sonnet-4-6')
    })

    it('returns undefined and warns when model is not in allowed set', function rejected() {
      const warnings: Array<{ event: string; data: Record<string, unknown> }> = []
      expect(guardAllowedOverrideModel('gpt-4', 'develop', (event, data) => {
        warnings.push({ event, data })
      })).toBeUndefined()
      expect(warnings).toHaveLength(1)
      expect(warnings[0].event).toBe('model.override.rejected')
    })

    it('returns undefined when effectiveOverride is undefined', function undefinedOverride() {
      expect(guardAllowedOverrideModel(undefined, 'develop', () => {})).toBeUndefined()
    })
  })

  it('contains expected canonical models', function canonicalModels() {
    expect(ALLOWED_OVERRIDE_MODELS.has('claude-sonnet-4-6')).toBe(true)
    expect(ALLOWED_OVERRIDE_MODELS.has('claude-sonnet-4-5')).toBe(true)
    expect(ALLOWED_OVERRIDE_MODELS.has('claude-sonnet-4-5-20250929')).toBe(true)
    expect(ALLOWED_OVERRIDE_MODELS.has('claude-haiku-4-5')).toBe(true)
    expect(ALLOWED_OVERRIDE_MODELS.has('azure/Kimi-K2.6')).toBe(true)
    expect(ALLOWED_OVERRIDE_MODELS.has('azure/Kimi-K2.6-thinking')).toBe(true)
    expect(ALLOWED_OVERRIDE_MODELS.has('sonnet')).toBe(true)
    expect(ALLOWED_OVERRIDE_MODELS.has('haiku')).toBe(true)
  })
})
