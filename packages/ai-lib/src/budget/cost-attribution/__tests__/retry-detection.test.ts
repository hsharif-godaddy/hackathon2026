/**
 * Retry Detection Tests
 *
 * Tests for detecting when users retry previously failed work.
 */

import { describe, it, expect } from 'vitest'
import {
  createExecutionHistory,
  detectRetry,
} from '../retry-detection.js'
import { RETRY_DETECTION_CONFIG } from '../types.js'

describe('createExecutionHistory', () => {
  it('creates history with failures and targets', () => {
    const history = createExecutionHistory(true, ['src/Button.tsx', 'npm install'])

    expect(history.hadFailures).toBe(true)
    expect(history.failedTargets).toEqual(['src/Button.tsx', 'npm install'])
    expect(history.timestamp).toBeGreaterThan(0)
  })

  it('creates history without failures', () => {
    const history = createExecutionHistory(false, [])

    expect(history.hadFailures).toBe(false)
    expect(history.failedTargets).toEqual([])
  })

  it('filters out short targets', () => {
    const history = createExecutionHistory(true, ['a', 'ab', 'abc', 'abcd'])

    // 'a' and 'ab' should be filtered (< MIN_TARGET_LENGTH)
    expect(history.failedTargets).toEqual(['abc', 'abcd'])
  })

  it('limits number of targets', () => {
    const manyTargets = Array.from({ length: 50 }, (_, i) => `target-${i}`)
    const history = createExecutionHistory(true, manyTargets)

    expect(history.failedTargets.length).toBe(RETRY_DETECTION_CONFIG.MAX_TARGETS_PER_EXECUTION)
  })
})

describe('detectRetry', () => {
  describe('returns isRetry: false when', () => {
    it('no history exists', () => {
      const result = detectRetry('fix the button', undefined)

      expect(result.isRetry).toBe(false)
      expect(result.hadPreviousFailures).toBe(false)
      expect(result.previousFailedTargets).toEqual([])
    })

    it('previous execution had no failures', () => {
      const history = createExecutionHistory(false, [])
      const result = detectRetry('fix the button', history)

      expect(result.isRetry).toBe(false)
      expect(result.hadPreviousFailures).toBe(false)
    })

    it('previous execution had failures but no targets', () => {
      const history = createExecutionHistory(true, [])
      const result = detectRetry('fix the button', history)

      expect(result.isRetry).toBe(false)
      expect(result.hadPreviousFailures).toBe(true)
    })

    it('message does not reference any failed targets', () => {
      const history = createExecutionHistory(true, ['src/Header.tsx', 'npm run build'])
      const result = detectRetry('add a footer component', history)

      expect(result.isRetry).toBe(false)
      expect(result.hadPreviousFailures).toBe(true)
      expect(result.previousFailedTargets).toEqual(['src/Header.tsx', 'npm run build'])
    })
  })

  describe('returns isRetry: true when', () => {
    it('message references failed file by name', () => {
      const history = createExecutionHistory(true, ['src/components/Button.tsx'])
      const result = detectRetry('fix the Button component', history)

      expect(result.isRetry).toBe(true)
      expect(result.matchedTarget).toBe('src/components/Button.tsx')
    })

    it('message references failed file with full filename', () => {
      const history = createExecutionHistory(true, ['src/index.ts'])
      const result = detectRetry('try index.ts again', history)

      expect(result.isRetry).toBe(true)
      expect(result.matchedTarget).toBe('src/index.ts')
    })

    it('message references failed command', () => {
      const history = createExecutionHistory(true, ['npm install'])
      const result = detectRetry('run npm again', history)

      expect(result.isRetry).toBe(true)
      expect(result.matchedTarget).toBe('npm install')
    })

    it('matching is case-insensitive', () => {
      const history = createExecutionHistory(true, ['src/BUTTON.tsx'])
      const result = detectRetry('fix button', history)

      expect(result.isRetry).toBe(true)
    })

    it('matches first target when multiple could match', () => {
      const history = createExecutionHistory(true, [
        'src/Button.tsx',
        'src/ButtonGroup.tsx',
      ])
      const result = detectRetry('fix the button please', history)

      expect(result.isRetry).toBe(true)
      expect(result.matchedTarget).toBe('src/Button.tsx')
    })
  })

  describe('edge cases', () => {
    it('handles empty message', () => {
      const history = createExecutionHistory(true, ['src/Button.tsx'])
      const result = detectRetry('', history)

      expect(result.isRetry).toBe(false)
    })

    it('does not match partial words within larger words', () => {
      const history = createExecutionHistory(true, ['src/but.tsx'])
      // "button" contains "but" but should not match due to word boundaries
      const result = detectRetry('fix the button', history)

      expect(result.isRetry).toBe(false)
    })

    it('handles special characters in targets', () => {
      const history = createExecutionHistory(true, ['src/my-component.tsx'])
      const result = detectRetry('fix my-component', history)

      // Should match the component name
      expect(result.isRetry).toBe(true)
    })
  })
})

describe('integration scenarios', () => {
  it('typical retry after npm install failure', () => {
    // Simulate: user asked to install, it failed, user asks again
    const history = createExecutionHistory(true, ['npm install', 'package.json'])

    const result = detectRetry('try npm install again', history)

    expect(result.isRetry).toBe(true)
    expect(result.matchedTarget).toBe('npm install')
  })

  it('typical retry after file edit failure', () => {
    // Simulate: user asked to edit file, it failed, user asks to fix it
    const history = createExecutionHistory(true, ['src/pages/Home.tsx'])

    const result = detectRetry('can you fix Home.tsx?', history)

    expect(result.isRetry).toBe(true)
  })

  it('new request after failure (not retry)', () => {
    // Simulate: user had failure, but now asking for something different
    const history = createExecutionHistory(true, ['src/Button.tsx', 'npm test'])

    const result = detectRetry('add a new Footer component', history)

    expect(result.isRetry).toBe(false)
    expect(result.hadPreviousFailures).toBe(true)
  })

  it('handles successful execution history', () => {
    // Simulate: previous execution was successful
    const history = createExecutionHistory(false, [])

    const result = detectRetry('make another change', history)

    expect(result.isRetry).toBe(false)
    expect(result.hadPreviousFailures).toBe(false)
  })
})
