import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RuntimeErrorContextRenderer } from '../RuntimeErrorContextRenderer.js'
import type { ContextAttachment } from '@airo/shared/context-attachment'

vi.mock('../../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

function makeAttachment(data: Record<string, unknown>): ContextAttachment<any> {
  return {
    type: 'runtime_error',
    data,
    persistence: 'ephemeral',
    source: 'error-boundary'
  } as ContextAttachment<any>
}

describe('RuntimeErrorContextRenderer', () => {
  let renderer: RuntimeErrorContextRenderer

  beforeEach(() => {
    renderer = new RuntimeErrorContextRenderer()
    vi.clearAllMocks()
  })

  describe('canHandle', () => {
    it('returns true for runtime_error', () => {
      expect(renderer.canHandle('runtime_error')).toBe(true)
    })

    it('returns false for other types', () => {
      expect(renderer.canHandle('visual_context')).toBe(false)
    })
  })

  describe('render', () => {
    it('renders runtime error with stack trace', async () => {
      const result = await renderer.render(
        makeAttachment({
          message: 'Cannot read properties of undefined',
          name: 'TypeError',
          stack: 'TypeError: Cannot read properties of undefined\n    at App.tsx:10:5'
        }),
        'fix this'
      )

      expect(result).not.toBeNull()
      expect(result!.content).toContain('### Runtime Error Occurred')
      expect(result!.content).toContain('**Error Type:** TypeError')
      expect(result!.content).toContain('Cannot read properties of undefined')
      expect(result!.content).toContain('JavaScript Stack Trace')
      expect(result!.insertionOrder).toBe('after_history')
    })

    it('renders compile error without Error Type', async () => {
      const result = await renderer.render(
        makeAttachment({
          message: 'Module not found: ./missing',
          name: 'CompileError',
          stack: '  at src/App.tsx:1:1'
        }),
        'fix this'
      )

      expect(result).not.toBeNull()
      expect(result!.content).toContain('### Compile Error Detected')
      expect(result!.content).not.toContain('**Error Type:**')
    })

    it('returns null for empty errors', async () => {
      const result = await renderer.render(
        makeAttachment({ message: '', name: 'Error' }),
        'fix this'
      )

      expect(result).toBeNull()
    })

    it('includes attempt warning when attemptNumber > 1', async () => {
      const result = await renderer.render(
        makeAttachment({
          message: 'Error',
          name: 'TypeError',
          attemptNumber: 2
        }),
        'fix this'
      )

      expect(result).not.toBeNull()
      expect(result!.content).toContain('**Fix Attempt:** 2')
      expect(result!.content).toContain('Previous fix attempts failed')
      expect(result!.content).toContain('Do NOT restart the server')
    })

    it('omits attempt warning when attemptNumber is 1', async () => {
      const result = await renderer.render(
        makeAttachment({
          message: 'Error',
          name: 'TypeError',
          attemptNumber: 1
        }),
        'fix this'
      )

      expect(result).not.toBeNull()
      expect(result!.content).not.toContain('Fix Attempt')
    })

    it('omits attempt warning when attemptNumber is absent', async () => {
      const result = await renderer.render(
        makeAttachment({
          message: 'Error',
          name: 'TypeError'
        }),
        'fix this'
      )

      expect(result).not.toBeNull()
      expect(result!.content).not.toContain('Fix Attempt')
    })
  })
})
