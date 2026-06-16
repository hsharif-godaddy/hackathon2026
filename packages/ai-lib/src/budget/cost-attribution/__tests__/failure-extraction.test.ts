/**
 * Failure Extraction Tests
 *
 * Tests for extracting failed call IDs and targets from SDK execution steps.
 * This is the foundation layer - direct tool failures.
 */

import { describe, it, expect } from 'vitest'
import {
  extractFailedCallIds,
  extractFailedTargets,
  messageReferencesTarget,
} from '../failure-extraction.js'
import type { ExecutionStep, StepContentItem } from '../types.js'

// HELPERS

function createStep(content: StepContentItem[], correlationId?: string): ExecutionStep {
  return {
    content,
    response: correlationId ? { headers: { 'x-correlation-id': correlationId } } : undefined,
  }
}

function toolResult(toolName: string, args?: unknown, result?: unknown): StepContentItem {
  return { type: 'tool-result', toolName, args, result }
}

function toolError(toolName: string, args?: unknown, error?: unknown): StepContentItem {
  return { type: 'tool-error', toolName, args, error }
}

// extractFailedCallIds

describe('extractFailedCallIds', () => {
  it('returns empty set for empty steps', () => {
    const result = extractFailedCallIds([])
    expect(result.size).toBe(0)
  })

  it('returns empty set when no failures', () => {
    const steps = [
      createStep([toolResult('read_file', { path: 'src/a.ts' }, 'content')], 'call-1'),
      createStep([toolResult('edit', { path: 'src/b.ts' }, { success: true })], 'call-2'),
    ]
    const result = extractFailedCallIds(steps)
    expect(result.size).toBe(0)
  })

  it('extracts correlation ID for hard errors (tool-error)', () => {
    const steps = [
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-1'),
      createStep([toolError('terminal', { command: 'npm test' })], 'call-2'),
      createStep([toolResult('edit', { path: 'src/b.ts' })], 'call-3'),
    ]
    const result = extractFailedCallIds(steps)
    expect(result.size).toBe(1)
    expect(result.has('call-2')).toBe(true)
  })

  it('extracts correlation ID for soft failures ({ success: false })', () => {
    const steps = [
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-1'),
      createStep([toolResult('oauthConnect', {}, { success: false, error: 'denied' })], 'call-2'),
      createStep([toolResult('edit', { path: 'src/b.ts' })], 'call-3'),
    ]
    const result = extractFailedCallIds(steps)
    expect(result.size).toBe(1)
    expect(result.has('call-2')).toBe(true)
  })

  it('extracts correlation ID for JSON-string soft failures', () => {
    const steps = [
      createStep([toolResult('terminalCommand', { command: 'npm test' }, JSON.stringify({
        success: false,
        exitCode: 1,
        stderr: 'tests failed',
      }))], 'call-1'),
    ]
    const result = extractFailedCallIds(steps)
    expect(result.size).toBe(1)
    expect(result.has('call-1')).toBe(true)
  })

  it('extracts correlation ID for nonzero exitCode results', () => {
    const steps = [
      createStep([toolResult('terminalCommand', { command: 'npm test' }, { exitCode: 2 })], 'call-1'),
    ]
    const result = extractFailedCallIds(steps)
    expect(result.size).toBe(1)
    expect(result.has('call-1')).toBe(true)
  })

  it('treats explicit success true as authoritative over nonzero exitCode', () => {
    const steps = [
      createStep([toolResult('terminalCommand', { command: 'git diff --exit-code' }, {
        success: true,
        exitCode: 1,
      })], 'call-1'),
    ]
    const result = extractFailedCallIds(steps)
    expect(result.size).toBe(0)
  })

  it('extracts both hard and soft failures', () => {
    const steps = [
      createStep([toolError('terminal', { command: 'npm build' })], 'call-1'),
      createStep([toolResult('oauthConnect', {}, { success: false })], 'call-2'),
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-3'),
    ]
    const result = extractFailedCallIds(steps)
    expect(result.size).toBe(2)
    expect(result.has('call-1')).toBe(true)
    expect(result.has('call-2')).toBe(true)
  })

  it('skips steps without correlation ID', () => {
    const steps = [
      createStep([toolError('terminal', { command: 'npm test' })]), // no correlation ID
      createStep([toolError('terminal', { command: 'npm build' })], 'call-2'),
    ]
    const result = extractFailedCallIds(steps)
    expect(result.size).toBe(1)
    expect(result.has('call-2')).toBe(true)
  })

  it('deduplicates same correlation ID', () => {
    const steps = [
      createStep([
        toolError('terminal', { command: 'npm test' }),
        toolResult('edit', { path: 'src/a.ts' }, { success: false }),
      ], 'call-1'),
    ]
    const result = extractFailedCallIds(steps)
    expect(result.size).toBe(1)
  })

  it('handles multiple failures in same step', () => {
    const steps = [
      createStep([
        toolError('terminal', { command: 'npm test' }),
        toolError('bash', { command: 'make build' }),
      ], 'call-1'),
    ]
    const result = extractFailedCallIds(steps)
    expect(result.size).toBe(1)
    expect(result.has('call-1')).toBe(true)
  })
})

// extractFailedTargets

describe('extractFailedTargets', () => {
  it('returns empty array for empty steps', () => {
    const result = extractFailedTargets([])
    expect(result).toEqual([])
  })

  it('returns empty array when no failures', () => {
    const steps = [
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-1'),
      createStep([toolResult('terminal', { command: 'npm test' })], 'call-2'),
    ]
    const result = extractFailedTargets(steps)
    expect(result).toEqual([])
  })

  it('extracts file path from file tool failures', () => {
    const steps = [
      createStep([toolError('read_file', { path: 'src/missing.ts' })], 'call-1'),
    ]
    const result = extractFailedTargets(steps)
    expect(result).toContain('src/missing.ts')
  })

  it('extracts file_path variant', () => {
    const steps = [
      createStep([toolError('edit', { file_path: 'src/broken.ts' })], 'call-1'),
    ]
    const result = extractFailedTargets(steps)
    expect(result).toContain('src/broken.ts')
  })

  it('extracts filePath camelCase variant', () => {
    const steps = [
      createStep([toolError('write_to_file', { filePath: 'src/new.ts' })], 'call-1'),
    ]
    const result = extractFailedTargets(steps)
    expect(result).toContain('src/new.ts')
  })

  it('extracts command from terminal tool failures', () => {
    const steps = [
      createStep([toolError('terminal', { command: 'npm test --watch' })], 'call-1'),
    ]
    const result = extractFailedTargets(steps)
    // Should extract just the command name, not args
    expect(result).toContain('npm')
  })

  it('extracts command from bash tool failures', () => {
    const steps = [
      createStep([toolError('bash', { command: 'make build' })], 'call-1'),
    ]
    const result = extractFailedTargets(steps)
    expect(result).toContain('make')
  })

  it('extracts query from search tool failures', () => {
    const steps = [
      createStep([toolError('grep', { pattern: 'function handleSubmit' })], 'call-1'),
    ]
    const result = extractFailedTargets(steps)
    expect(result).toContain('function handleSubmit')
  })

  it('extracts query from search_files with query arg', () => {
    const steps = [
      createStep([toolError('search_files', { query: 'className=' })], 'call-1'),
    ]
    const result = extractFailedTargets(steps)
    expect(result).toContain('className=')
  })

  it('extracts from soft failures', () => {
    const steps = [
      createStep([toolResult('read_file', { path: 'src/missing.ts' }, { success: false })], 'call-1'),
    ]
    const result = extractFailedTargets(steps)
    expect(result).toContain('src/missing.ts')
  })

  it('extracts terminal target from JSON-string soft failures', () => {
    const steps = [
      createStep([toolResult('terminalCommand', { command: 'npm test --watch' }, JSON.stringify({
        success: false,
        exitCode: 1,
      }))], 'call-1'),
    ]
    const result = extractFailedTargets(steps)
    expect(result).toContain('npm')
  })

  it('deduplicates targets', () => {
    const steps = [
      createStep([toolError('read_file', { path: 'src/a.ts' })], 'call-1'),
      createStep([toolError('edit', { path: 'src/a.ts' })], 'call-2'),
    ]
    const result = extractFailedTargets(steps)
    expect(result.filter(t => t === 'src/a.ts')).toHaveLength(1)
  })

  it('extracts multiple target types', () => {
    const steps = [
      createStep([toolError('read_file', { path: 'src/a.ts' })], 'call-1'),
      createStep([toolError('terminal', { command: 'npm test' })], 'call-2'),
      createStep([toolError('grep', { pattern: 'TODO' })], 'call-3'),
    ]
    const result = extractFailedTargets(steps)
    expect(result).toContain('src/a.ts')
    expect(result).toContain('npm')
    expect(result).toContain('TODO')
  })

  it('ignores failures without extractable targets', () => {
    const steps = [
      createStep([toolError('unknown_tool', {})], 'call-1'),
      createStep([toolError('read_file', {})], 'call-2'), // no path
    ]
    const result = extractFailedTargets(steps)
    expect(result).toEqual([])
  })
})

// messageReferencesTarget

describe('messageReferencesTarget', () => {
  describe('file paths', () => {
    it('matches filename in message', () => {
      expect(messageReferencesTarget('fix the Button component', 'src/components/Button.tsx')).toBe(true)
    })

    it('matches filename without extension', () => {
      expect(messageReferencesTarget('the button is broken', 'src/components/Button.tsx')).toBe(true)
    })

    it('matches full filename with extension', () => {
      expect(messageReferencesTarget('fix index.ts', 'src/index.ts')).toBe(true)
    })

    it('case insensitive match', () => {
      expect(messageReferencesTarget('FIX THE BUTTON', 'src/Button.tsx')).toBe(true)
    })

    it('uses word boundaries to avoid partial matches', () => {
      // "button" should not match in "unbutton"
      expect(messageReferencesTarget('unbutton the shirt', 'src/Button.tsx')).toBe(false)
    })

    it('does not match very short filenames (2 chars)', () => {
      expect(messageReferencesTarget('check a', 'src/a.ts')).toBe(false)
    })

    it('does not match without word boundary', () => {
      expect(messageReferencesTarget('the submission failed', 'src/submit.ts')).toBe(false)
    })
  })

  describe('commands', () => {
    it('matches command name', () => {
      expect(messageReferencesTarget('run npm again', 'npm')).toBe(true)
    })

    it('uses word boundaries', () => {
      expect(messageReferencesTarget('the snpm tool is broken', 'npm')).toBe(false)
    })

    it('case insensitive', () => {
      expect(messageReferencesTarget('try NPM install', 'npm')).toBe(true)
    })

    it('does not match very short commands (2 chars)', () => {
      expect(messageReferencesTarget('use ls', 'ls')).toBe(false)
    })
  })

  describe('search queries', () => {
    it('matches camelCase identifier from query', () => {
      // "function handleSubmit" - should match on handleSubmit, not "function"
      expect(messageReferencesTarget('fix handleSubmit', 'function handleSubmit')).toBe(true)
    })

    it('does not match generic words from query', () => {
      // "function handleSubmit" - should NOT match on just "function"
      expect(messageReferencesTarget('add a new function', 'function handleSubmit')).toBe(false)
    })

    it('matches snake_case identifier from query', () => {
      expect(messageReferencesTarget('fix user_profile', 'const user_profile = ')).toBe(true)
    })

    it('matches PascalCase identifier from query', () => {
      expect(messageReferencesTarget('check the UserProfile', 'class UserProfile')).toBe(true)
    })

    it('does not match if no identifiers in query', () => {
      // "const foo" has no camelCase/snake_case identifiers >= 4 chars
      expect(messageReferencesTarget('check the foo', 'const foo')).toBe(false)
    })

    it('case insensitive identifier matching', () => {
      expect(messageReferencesTarget('FIX HANDLESUBMIT', 'function handleSubmit')).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('empty message returns false', () => {
      expect(messageReferencesTarget('', 'src/Button.tsx')).toBe(false)
    })

    it('empty target returns false', () => {
      expect(messageReferencesTarget('fix the button', '')).toBe(false)
    })

    it('handles special regex characters in target', () => {
      expect(messageReferencesTarget('check the hook', 'src/hooks/use[State].ts')).toBe(false)
    })

    it('matches with punctuation around word', () => {
      expect(messageReferencesTarget('the Button, which is broken', 'src/Button.tsx')).toBe(true)
    })

    it('matches at start of message', () => {
      expect(messageReferencesTarget('Button component needs fixing', 'src/Button.tsx')).toBe(true)
    })

    it('matches at end of message', () => {
      expect(messageReferencesTarget('please fix Button', 'src/Button.tsx')).toBe(true)
    })
  })
})
