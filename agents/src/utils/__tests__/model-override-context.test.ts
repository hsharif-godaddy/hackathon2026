import { describe, expect, it } from 'vitest'

import { getActiveModelOverride, runWithModelOverride } from '@airo/ai-lib'

describe('@airo/agents', function packageTests() {
  describe('#model-override-context', function contextTests() {
    it('returns null when no override is active', function returnsNull() {
      expect(getActiveModelOverride()).toBeNull()
    })

    it('returns the override value inside runWithModelOverride', function returnsOverride() {
      runWithModelOverride('claude-sonnet-4-5', function check() {
        expect(getActiveModelOverride()).toBe('claude-sonnet-4-5')
      })
    })

    it('returns null after runWithModelOverride completes', function cleansUp() {
      runWithModelOverride('claude-sonnet-4-5', function noop() {
        // override is active here
      })
      expect(getActiveModelOverride()).toBeNull()
    })

    it('propagates through nested async calls', async function propagatesAsync() {
      await runWithModelOverride('claude-haiku-4-5', async function check() {
        await new Promise(function delay(resolve) { setTimeout(resolve, 10) })
        expect(getActiveModelOverride()).toBe('claude-haiku-4-5')
      })
    })

    it('isolates concurrent overrides', async function isolates() {
      const results: string[] = []

      await Promise.all([
        runWithModelOverride('model-a', async function checkA() {
          await new Promise(function delay(resolve) { setTimeout(resolve, 20) })
          results.push(`a:${getActiveModelOverride()}`)
        }),
        runWithModelOverride('model-b', async function checkB() {
          await new Promise(function delay(resolve) { setTimeout(resolve, 10) })
          results.push(`b:${getActiveModelOverride()}`)
        }),
      ])

      expect(results).toContain('a:model-a')
      expect(results).toContain('b:model-b')
    })
  })
})
