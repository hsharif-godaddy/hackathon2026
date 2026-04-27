/**
 * Causal Chain Detection Tests
 *
 * Tests for detecting edit→error→fix causal chains.
 * When an agent breaks something and fixes it mid-execution,
 * the entire chain should be attributed to GoDaddy.
 */

import { describe, it, expect } from 'vitest'
import {
  detectCausalChains,
  getCausalChainCallIds,
} from '../causal-chain-detection.js'
import type { ExecutionStep, StepContentItem, CausalChain } from '../types.js'

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

// detectCausalChains

describe('detectCausalChains', () => {
  it('returns empty array for empty steps', () => {
    const result = detectCausalChains([])
    expect(result).toEqual([])
  })

  it('returns empty array when no errors', () => {
    const steps = [
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/Button.tsx' })], 'call-1'),
      createStep([toolResult('terminal', { command: 'npm test' })], 'call-2'),
    ]
    const result = detectCausalChains(steps)
    expect(result).toEqual([])
  })

  it('returns empty array for error without preceding edit', () => {
    const steps = [
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-1'),
      createStep([toolError('terminal', { command: 'npm test' }, 'Error in unknown.ts')], 'call-2'),
    ]
    const result = detectCausalChains(steps)
    expect(result).toEqual([])
  })

  it('detects basic causal chain: edit → error mentioning file', () => {
    const steps = [
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/Button.tsx' })], 'call-1'),
      createStep([toolError('terminal', { command: 'npm test' }, 'Error in Button.tsx: undefined')], 'call-2'),
    ]
    const result = detectCausalChains(steps)
    expect(result).toHaveLength(1)
    expect(result[0]?.triggerCallId).toBe('call-1')
    expect(result[0]?.triggerTarget).toBe('src/Button.tsx')
    expect(result[0]?.errorCallId).toBe('call-2')
  })

  it('tracks fix calls that operate on the triggered file', () => {
    const steps = [
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/Button.tsx' })], 'call-1'),
      createStep([toolError('terminal', { command: 'npm test' }, 'Error in Button.tsx')], 'call-2'),
      createStep([toolResult('read_file', { path: 'src/Button.tsx' })], 'call-3'),
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/Button.tsx' })], 'call-4'),
    ]
    const result = detectCausalChains(steps)
    expect(result).toHaveLength(1)
    expect(result[0]?.fixCallIds).toContain('call-3')
    expect(result[0]?.fixCallIds).toContain('call-4')
  })

  it('marks verification when same tool type succeeds', () => {
    const steps = [
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/Button.tsx' })], 'call-1'),
      createStep([toolError('terminal', { command: 'npm test' }, 'Error in Button.tsx')], 'call-2'),
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/Button.tsx' })], 'call-3'),
      createStep([toolResult('terminal', { command: 'npm test' }, 'All tests passed')], 'call-4'),
    ]
    const result = detectCausalChains(steps)
    expect(result).toHaveLength(1)
    expect(result[0]?.verificationCallId).toBe('call-4')
  })

  it('stops attributing after verification is found', () => {
    const steps = [
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/Button.tsx' })], 'call-1'),
      createStep([toolError('terminal', { command: 'npm test' }, 'Error in Button.tsx')], 'call-2'),
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/Button.tsx' })], 'call-3'),
      createStep([toolResult('terminal', { command: 'npm test' }, 'ok')], 'call-4'), // verification
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/Button.tsx' })], 'call-5'), // after verification
      createStep([toolResult('read_file', { path: 'src/Button.tsx' })], 'call-6'), // after verification
    ]
    const result = detectCausalChains(steps)
    expect(result).toHaveLength(1)
    // call-5 and call-6 should NOT be in fixCallIds since they're after verification
    expect(result[0]?.fixCallIds).not.toContain('call-5')
    expect(result[0]?.fixCallIds).not.toContain('call-6')
    expect(result[0]?.verificationCallId).toBe('call-4')
  })

  it('only looks at edits within 5-step window', () => {
    const steps = [
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/Old.tsx' })], 'call-1'),
      // 6 intervening steps
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-2'),
      createStep([toolResult('read_file', { path: 'src/b.ts' })], 'call-3'),
      createStep([toolResult('read_file', { path: 'src/c.ts' })], 'call-4'),
      createStep([toolResult('read_file', { path: 'src/d.ts' })], 'call-5'),
      createStep([toolResult('read_file', { path: 'src/e.ts' })], 'call-6'),
      createStep([toolResult('read_file', { path: 'src/f.ts' })], 'call-7'),
      // Error is too far from the edit
      createStep([toolError('terminal', { command: 'npm test' }, 'Error in Old.tsx')], 'call-8'),
    ]
    const result = detectCausalChains(steps)
    expect(result).toEqual([])
  })

  it('matches edit within 5-step window', () => {
    const steps = [
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/Button.tsx' })], 'call-1'),
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-2'),
      createStep([toolResult('read_file', { path: 'src/b.ts' })], 'call-3'),
      createStep([toolResult('read_file', { path: 'src/c.ts' })], 'call-4'),
      createStep([toolResult('read_file', { path: 'src/d.ts' })], 'call-5'),
      // Error within 5 steps of edit
      createStep([toolError('terminal', { command: 'npm test' }, 'Error in Button.tsx')], 'call-6'),
    ]
    const result = detectCausalChains(steps)
    expect(result).toHaveLength(1)
  })

  it('skips steps without correlation ID', () => {
    const steps = [
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/Button.tsx' })]), // no ID
      createStep([toolError('terminal', { command: 'npm test' }, 'Error in Button.tsx')], 'call-2'),
    ]
    const result = detectCausalChains(steps)
    expect(result).toEqual([])
  })

  it('detects multiple independent chains', () => {
    const steps = [
      // First chain
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/Button.tsx' })], 'chain1-edit'),
      createStep([toolError('terminal', { command: 'npm test' }, 'Error in Button.tsx')], 'chain1-error'),
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/Button.tsx' })], 'chain1-fix'),
      createStep([toolResult('terminal', { command: 'npm test' }, 'ok')], 'chain1-verify'),
      // Second chain
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/Header.tsx' })], 'chain2-edit'),
      createStep([toolError('terminal', { command: 'npm build' }, 'Error in Header.tsx')], 'chain2-error'),
    ]
    const result = detectCausalChains(steps)
    expect(result).toHaveLength(2)
  })

  it('matches error by filename (last segment of path)', () => {
    const steps = [
      createStep([toolResult('str_replace_based_edit_tool', { path: '/app/src/components/Button.tsx' })], 'call-1'),
      createStep([toolError('terminal', { command: 'npm test' }, 'Error: Button.tsx:10 is undefined')], 'call-2'),
    ]
    const result = detectCausalChains(steps)
    expect(result).toHaveLength(1)
  })

  it('matches error by path segment', () => {
    const steps = [
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/components/Button.tsx' })], 'call-1'),
      createStep([toolError('terminal', { command: 'npm test' }, 'Failed in components folder')], 'call-2'),
    ]
    const result = detectCausalChains(steps)
    expect(result).toHaveLength(1)
  })

  it('handles error as string', () => {
    const steps = [
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/Button.tsx' })], 'call-1'),
      createStep([toolError('terminal', { command: 'npm test' }, 'Button.tsx:10 - TypeError')], 'call-2'),
    ]
    const result = detectCausalChains(steps)
    expect(result).toHaveLength(1)
  })

  it('handles error as object with message', () => {
    const steps = [
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/Button.tsx' })], 'call-1'),
      createStep([toolError('terminal', { command: 'npm test' }, { message: 'Error in Button.tsx' })], 'call-2'),
    ]
    const result = detectCausalChains(steps)
    expect(result).toHaveLength(1)
  })

  it('handles error as object with stderr', () => {
    const steps = [
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/Button.tsx' })], 'call-1'),
      createStep([toolError('terminal', { command: 'npm test' }, { stderr: 'Button.tsx failed to compile' })], 'call-2'),
    ]
    const result = detectCausalChains(steps)
    expect(result).toHaveLength(1)
  })

  it('recognizes edit tool alias', () => {
    const steps = [
      createStep([toolResult('edit', { path: 'src/Button.tsx' })], 'call-1'),
      createStep([toolError('terminal', { command: 'npm test' }, 'Error in Button.tsx')], 'call-2'),
    ]
    const result = detectCausalChains(steps)
    expect(result).toHaveLength(1)
  })

  it('does not treat write_to_file as edit tool (file creation, not targeted modification)', () => {
    // write_to_file is for creating entire files, not targeted edits
    // Causal chain detection only triggers on edit tools (str_replace_based_edit_tool, edit)
    // to catch edit→error→fix loops, not file creation that happens to fail
    const steps = [
      createStep([toolResult('write_to_file', { path: 'src/Button.tsx' })], 'call-1'),
      createStep([toolError('terminal', { command: 'npm test' }, 'Error in Button.tsx')], 'call-2'),
    ]
    const result = detectCausalChains(steps)
    expect(result).toHaveLength(0) // write_to_file is not an edit tool
  })
})

// getCausalChainCallIds

describe('getCausalChainCallIds', () => {
  it('returns empty set for empty chains', () => {
    const result = getCausalChainCallIds([])
    expect(result.size).toBe(0)
  })

  it('includes trigger and error call IDs', () => {
    const chains: CausalChain[] = [{
      triggerCallId: 'trigger-1',
      triggerTarget: 'src/a.ts',
      errorCallId: 'error-1',
      errorMessage: 'failed',
      fixCallIds: [],
    }]
    const result = getCausalChainCallIds(chains)
    expect(result.has('trigger-1')).toBe(true)
    expect(result.has('error-1')).toBe(true)
  })

  it('includes fix call IDs', () => {
    const chains: CausalChain[] = [{
      triggerCallId: 'trigger-1',
      triggerTarget: 'src/a.ts',
      errorCallId: 'error-1',
      errorMessage: 'failed',
      fixCallIds: ['fix-1', 'fix-2'],
    }]
    const result = getCausalChainCallIds(chains)
    expect(result.has('fix-1')).toBe(true)
    expect(result.has('fix-2')).toBe(true)
  })

  it('includes verification call ID when present', () => {
    const chains: CausalChain[] = [{
      triggerCallId: 'trigger-1',
      triggerTarget: 'src/a.ts',
      errorCallId: 'error-1',
      errorMessage: 'failed',
      fixCallIds: ['fix-1'],
      verificationCallId: 'verify-1',
    }]
    const result = getCausalChainCallIds(chains)
    expect(result.has('verify-1')).toBe(true)
  })

  it('deduplicates across multiple chains', () => {
    const chains: CausalChain[] = [
      {
        triggerCallId: 'shared-id',
        triggerTarget: 'src/a.ts',
        errorCallId: 'error-1',
        errorMessage: 'failed',
        fixCallIds: [],
      },
      {
        triggerCallId: 'trigger-2',
        triggerTarget: 'src/b.ts',
        errorCallId: 'shared-id', // same as trigger above
        errorMessage: 'failed',
        fixCallIds: [],
      },
    ]
    const result = getCausalChainCallIds(chains)
    expect(result.size).toBe(3) // shared-id, error-1, trigger-2
  })

  it('collects all IDs from multiple chains', () => {
    const chains: CausalChain[] = [
      {
        triggerCallId: 't1',
        triggerTarget: 'a.ts',
        errorCallId: 'e1',
        errorMessage: 'err',
        fixCallIds: ['f1'],
        verificationCallId: 'v1',
      },
      {
        triggerCallId: 't2',
        triggerTarget: 'b.ts',
        errorCallId: 'e2',
        errorMessage: 'err',
        fixCallIds: ['f2', 'f3'],
      },
    ]
    const result = getCausalChainCallIds(chains)
    expect(result.size).toBe(8)
    expect(result.has('t1')).toBe(true)
    expect(result.has('e1')).toBe(true)
    expect(result.has('f1')).toBe(true)
    expect(result.has('v1')).toBe(true)
    expect(result.has('t2')).toBe(true)
    expect(result.has('e2')).toBe(true)
    expect(result.has('f2')).toBe(true)
    expect(result.has('f3')).toBe(true)
  })
})
