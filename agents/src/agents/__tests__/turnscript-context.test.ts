import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetShopperFlag } = vi.hoisted(() => ({ mockGetShopperFlag: vi.fn() }))

vi.mock('../../services/switchboard.js', () => ({
  getShopperFlag: mockGetShopperFlag,
}))

import {
  resolveTurnscriptEnabled,
  runWithTurnscript,
  isTurnscriptEnabled,
} from '../turnscript-context.js'

const TLA = 'abc' // 3-char internal account
const REGULAR = '4367373'

/** Make getShopperFlag(setting) return the given map of setting → boolean (default false). */
function flags(map: Partial<Record<'appbuilder-turnscript' | 'appbuilder-turnscript-tla-only', boolean>>): void {
  mockGetShopperFlag.mockImplementation((setting: string) => map[setting as keyof typeof map] ?? false)
}

describe('turnscript-context', () => {
  const ENV_KEYS = ['TURNSCRIPT_ENABLED', 'TURNSCRIPT_TLA_ONLY'] as const
  function clearEnv(): void {
    for (const key of ENV_KEYS) delete process.env[key]
  }

  beforeEach(() => {
    clearEnv()
    mockGetShopperFlag.mockReset()
    flags({})
  })
  afterEach(clearEnv)

  describe('#resolveTurnscriptEnabled', () => {
    it('off when neither the Switchboard flag nor the env enables it', () => {
      expect(resolveTurnscriptEnabled(TLA)).toBe(false)
      expect(resolveTurnscriptEnabled(REGULAR)).toBe(false)
      expect(resolveTurnscriptEnabled(undefined)).toBe(false)
    })

    it('the appbuilder-turnscript flag enables it for everyone (no env needed)', () => {
      flags({ 'appbuilder-turnscript': true })
      expect(resolveTurnscriptEnabled(undefined)).toBe(true)
      expect(resolveTurnscriptEnabled(REGULAR)).toBe(true)
      expect(resolveTurnscriptEnabled(TLA)).toBe(true)
    })

    it('env TURNSCRIPT_ENABLED enables it as a fallback (PaaS/eval/ops)', () => {
      process.env.TURNSCRIPT_ENABLED = 'true'
      expect(resolveTurnscriptEnabled(REGULAR)).toBe(true)
    })

    it('the tla-only flag restricts to TLA accounts', () => {
      flags({ 'appbuilder-turnscript': true, 'appbuilder-turnscript-tla-only': true })
      expect(resolveTurnscriptEnabled(TLA)).toBe(true)
      expect(resolveTurnscriptEnabled(REGULAR)).toBe(false)
      expect(resolveTurnscriptEnabled(undefined)).toBe(false)
    })

    it('TURNSCRIPT_TLA_ONLY env var also restricts (fallback)', () => {
      flags({ 'appbuilder-turnscript': true })
      process.env.TURNSCRIPT_TLA_ONLY = 'true'
      expect(resolveTurnscriptEnabled(TLA)).toBe(true)
      expect(resolveTurnscriptEnabled(REGULAR)).toBe(false)
    })

    it('enable gate beats TLA: tla-only with a TLA account is still off when L1 is off', () => {
      flags({ 'appbuilder-turnscript-tla-only': true })
      expect(resolveTurnscriptEnabled(TLA)).toBe(false)
    })
  })

  describe('#runWithTurnscript / #isTurnscriptEnabled', () => {
    it('reads false outside any run scope', () => {
      expect(isTurnscriptEnabled()).toBe(false)
    })

    it('exposes the enabled flag inside the run scope', () => {
      runWithTurnscript(true, () => {
        expect(isTurnscriptEnabled()).toBe(true)
      })
      runWithTurnscript(false, () => {
        expect(isTurnscriptEnabled()).toBe(false)
      })
      // Scope does not leak out.
      expect(isTurnscriptEnabled()).toBe(false)
    })
  })
})
