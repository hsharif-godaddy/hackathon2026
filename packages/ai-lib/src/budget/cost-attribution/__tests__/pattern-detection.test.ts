/**
 * Pattern Detection Tests
 *
 * Tests for severity-based pattern detection.
 */

import { describe, it, expect } from 'vitest'
import {
  detectHighConfidencePatterns,
  severityCurve,
} from '../pattern-detection.js'
import { PatternType, ZERO_PATTERN_COUNTS } from '../types.js'
import type { ExecutionStep, PatternCounts, StepContentItem } from '../types.js'

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

function toolError(toolName: string, args?: unknown): StepContentItem {
  return { type: 'tool-error', toolName, args }
}

// SEVERITY CURVE

describe('severityCurve', () => {
  it('returns 0 at threshold', () => {
    expect(severityCurve(3, 3)).toBe(0)
    expect(severityCurve(5, 5)).toBe(0)
  })

  it('returns 0 below threshold', () => {
    expect(severityCurve(1, 3)).toBe(0)
    expect(severityCurve(0, 5)).toBe(0)
  })

  it('returns 1 at 5x threshold', () => {
    expect(severityCurve(15, 3)).toBeCloseTo(1.0, 5)
    expect(severityCurve(25, 5)).toBeCloseTo(1.0, 5)
  })

  it('caps at 1 above 5x threshold', () => {
    expect(severityCurve(100, 3)).toBe(1)
    expect(severityCurve(1000, 5)).toBe(1)
  })

  it('returns intermediate values', () => {
    // severity_curve(8, 3) = log(8/3)/log(5) ≈ 0.61
    expect(severityCurve(8, 3)).toBeCloseTo(0.61, 1)

    // severity_curve(4, 3) = log(4/3)/log(5) ≈ 0.18
    expect(severityCurve(4, 3)).toBeCloseTo(0.18, 1)
  })

  it('handles threshold of 0', () => {
    expect(severityCurve(5, 0)).toBe(0)
  })
})

// REPEATED READS

describe('repeated_reads pattern', () => {
  it('not detected when reads < 3', () => {
    const steps = [
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-1'),
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-2'),
    ]
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.RepeatedReads)).toBeUndefined()
  })

  it('detected when same file read >= 3 times with severity > 0', () => {
    const steps = [
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-1'),
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-2'),
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-3'),
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-4'),
    ]
    const { patterns } = detectHighConfidencePatterns(steps)
    const pattern = patterns.find(p => p.type === PatternType.RepeatedReads)
    expect(pattern).toBeDefined()
    // severity_curve(4, 3) ≈ 0.18
    expect(pattern!.severity).toBeCloseTo(0.18, 1)
  })

  it('uses max across files', () => {
    const steps = [
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-1'),
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-2'),
      createStep([toolResult('read_file', { path: 'src/b.ts' })], 'call-3'),
      createStep([toolResult('read_file', { path: 'src/b.ts' })], 'call-4'),
      createStep([toolResult('read_file', { path: 'src/b.ts' })], 'call-5'),
      createStep([toolResult('read_file', { path: 'src/b.ts' })], 'call-6'),
      createStep([toolResult('read_file', { path: 'src/b.ts' })], 'call-7'),
    ]
    const { patterns } = detectHighConfidencePatterns(steps)
    const pattern = patterns.find(p => p.type === PatternType.RepeatedReads)
    expect(pattern).toBeDefined()
    // Max is 5 reads of b.ts → severity_curve(5, 3) ≈ 0.32
    expect(pattern!.severity).toBeCloseTo(0.32, 1)
  })

  it('severity = 0 at exactly threshold (3 reads) → not in results', () => {
    const steps = [
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-1'),
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-2'),
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-3'),
    ]
    const { patterns } = detectHighConfidencePatterns(steps)
    // At exactly threshold, severity_curve returns 0 → filtered out
    expect(patterns.find(p => p.type === PatternType.RepeatedReads)).toBeUndefined()
  })
})

// REPEATED EDITS

describe('repeated_edits pattern', () => {
  it('not detected when edits < 5', () => {
    const steps = Array.from({ length: 4 }, (_, i) =>
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/a.ts' })], `call-${i}`)
    )
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.RepeatedEdits)).toBeUndefined()
  })

  it('detected when same file edited >= 6 times', () => {
    const steps = Array.from({ length: 6 }, (_, i) =>
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/a.ts' })], `call-${i}`)
    )
    const { patterns } = detectHighConfidencePatterns(steps)
    const pattern = patterns.find(p => p.type === PatternType.RepeatedEdits)
    expect(pattern).toBeDefined()
    // severity_curve(6, 5) ≈ 0.11
    expect(pattern!.severity).toBeCloseTo(0.11, 1)
  })

  it('excludes write_to_file from edit count', () => {
    const steps = Array.from({ length: 6 }, (_, i) =>
      createStep([toolResult('write_to_file', { path: 'src/a.ts' })], `call-${i}`)
    )
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.RepeatedEdits)).toBeUndefined()
  })
})

// GREP SPIRAL

describe('grep_spiral pattern', () => {
  it('not detected when total greps < 5', () => {
    const steps = Array.from({ length: 4 }, (_, i) =>
      createStep([toolResult('grep', { pattern: 'test' }, '')], `call-${i}`)
    )
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.GrepSpiral)).toBeUndefined()
  })

  it('zero severity when all greps find results', () => {
    const steps = Array.from({ length: 10 }, (_, i) =>
      createStep([toolResult('grep', { pattern: 'test' }, 'found something')], `call-${i}`)
    )
    const { patterns } = detectHighConfidencePatterns(steps)
    // empty_result_ratio = 0 → severity = (10/5) * 0 = 0 → filtered out
    expect(patterns.find(p => p.type === PatternType.GrepSpiral)).toBeUndefined()
  })

  it('severity = 1.0 when 19 greps all empty', () => {
    const steps = Array.from({ length: 19 }, (_, i) =>
      createStep([toolResult('grep', { pattern: 'test' }, '')], `call-${i}`)
    )
    const { patterns } = detectHighConfidencePatterns(steps)
    const pattern = patterns.find(p => p.type === PatternType.GrepSpiral)
    expect(pattern).toBeDefined()
    // min((19/5) * 1.0, 1.0) = min(3.8, 1.0) = 1.0
    expect(pattern!.severity).toBe(1.0)
  })

  it('scales with empty ratio', () => {
    // 6 greps: 3 empty, 3 with results → ratio = 0.5
    const steps = [
      createStep([toolResult('grep', { pattern: 'a' }, '')], 'call-1'),
      createStep([toolResult('grep', { pattern: 'b' }, 'found')], 'call-2'),
      createStep([toolResult('grep', { pattern: 'c' }, '')], 'call-3'),
      createStep([toolResult('grep', { pattern: 'd' }, 'found')], 'call-4'),
      createStep([toolResult('grep', { pattern: 'e' }, '')], 'call-5'),
      createStep([toolResult('grep', { pattern: 'f' }, 'found')], 'call-6'),
    ]
    const { patterns } = detectHighConfidencePatterns(steps)
    const pattern = patterns.find(p => p.type === PatternType.GrepSpiral)
    expect(pattern).toBeDefined()
    // min((6/5) * 0.5, 1.0) = min(0.6, 1.0) = 0.6
    expect(pattern!.severity).toBeCloseTo(0.6, 1)
  })

  it('recognizes search_files as a search tool', () => {
    const steps = Array.from({ length: 6 }, (_, i) =>
      createStep([toolResult('search_files', { query: 'test' }, '')], `call-${i}`)
    )
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.GrepSpiral)).toBeDefined()
  })
})

// TERMINAL FAILURES

describe('terminal_failures pattern', () => {
  it('not detected when failures < 3', () => {
    const steps = [
      createStep([toolError('terminal', { command: 'npm test' })], 'call-1'),
      createStep([toolError('terminal', { command: 'npm test' })], 'call-2'),
    ]
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.TerminalFailures)).toBeUndefined()
  })

  it('detected with 4 failures out of 4 commands', () => {
    const steps = Array.from({ length: 4 }, (_, i) =>
      createStep([toolError('terminal', { command: 'npm test' })], `call-${i}`)
    )
    const { patterns } = detectHighConfidencePatterns(steps)
    const pattern = patterns.find(p => p.type === PatternType.TerminalFailures)
    expect(pattern).toBeDefined()
    // severity_curve(4, 3) * (4/4) ≈ 0.18 * 1.0 = 0.18
    expect(pattern!.severity).toBeCloseTo(0.18, 1)
  })

  it('severity scales down with low fail ratio', () => {
    // 4 failures + 16 successes = 20 total, ratio = 0.2
    const failures = Array.from({ length: 4 }, (_, i) =>
      createStep([toolError('terminal', { command: 'npm test' })], `fail-${i}`)
    )
    const successes = Array.from({ length: 16 }, (_, i) =>
      createStep([toolResult('terminal', { command: 'npm test' }, 'ok')], `ok-${i}`)
    )
    const { patterns } = detectHighConfidencePatterns([...failures, ...successes])
    const pattern = patterns.find(p => p.type === PatternType.TerminalFailures)
    expect(pattern).toBeDefined()
    // severity_curve(4, 3) * 0.2 ≈ 0.18 * 0.2 = 0.036
    expect(pattern!.severity).toBeCloseTo(0.036, 2)
  })

  it('recognizes bash as terminal tool', () => {
    const steps = Array.from({ length: 4 }, (_, i) =>
      createStep([toolError('bash', { command: 'make build' })], `call-${i}`)
    )
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.TerminalFailures)).toBeDefined()
  })

  it('counts JSON-string terminal soft failures', () => {
    const steps = Array.from({ length: 4 }, (_, i) =>
      createStep([toolResult('terminalCommand', { command: 'npm test' }, JSON.stringify({
        success: false,
        exitCode: 1,
        stderr: 'tests failed',
      }))], `call-${i}`)
    )
    const { patterns } = detectHighConfidencePatterns(steps)
    const pattern = patterns.find(p => p.type === PatternType.TerminalFailures)
    expect(pattern).toBeDefined()
    expect(pattern!.callIds).toEqual(['call-0', 'call-1', 'call-2', 'call-3'])
  })

  it('counts nonzero exitCode terminal results as failures', () => {
    const steps = Array.from({ length: 4 }, (_, i) =>
      createStep([toolResult('terminalCommand', { command: 'npm test' }, { exitCode: 1 })], `call-${i}`)
    )
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.TerminalFailures)).toBeDefined()
  })

  it('does not count explicit success true with nonzero exitCode as a failure', () => {
    const steps = Array.from({ length: 4 }, (_, i) =>
      createStep([toolResult('terminalCommand', { command: 'git diff --exit-code' }, {
        success: true,
        exitCode: 1,
      })], `call-${i}`)
    )
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.TerminalFailures)).toBeUndefined()
  })
})

// EDIT-READ LOOPS

describe('edit_read_loops pattern', () => {
  it('not detected with fewer than 3 cycles', () => {
    // 2 transitions = 1 cycle (floor(2/2) = 1) → below threshold 3
    const steps = [
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/a.ts' })], 'call-1'),
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-2'),
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/a.ts' })], 'call-3'),
    ]
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.EditReadLoop)).toBeUndefined()
  })

  it('not detected at exactly 3 cycles (severity = 0 at threshold)', () => {
    // edit→read→edit→read→edit→read→edit = 6 transitions = floor(6/2) = 3 cycles
    // severity_curve(3, 3) = 0 → filtered out
    const steps = [
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/a.ts' })], 'call-1'),
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-2'),
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/a.ts' })], 'call-3'),
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-4'),
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/a.ts' })], 'call-5'),
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-6'),
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/a.ts' })], 'call-7'),
    ]
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.EditReadLoop)).toBeUndefined()
  })

  it('detected with > 3 cycles (severity > 0)', () => {
    // edit→read→edit→read→edit→read→edit→read→edit = 8 transitions = floor(8/2) = 4 cycles
    const steps = [
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/a.ts' })], 'call-1'),
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-2'),
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/a.ts' })], 'call-3'),
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-4'),
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/a.ts' })], 'call-5'),
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-6'),
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/a.ts' })], 'call-7'),
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-8'),
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/a.ts' })], 'call-9'),
    ]
    const { patterns } = detectHighConfidencePatterns(steps)
    const pattern = patterns.find(p => p.type === PatternType.EditReadLoop)
    expect(pattern).toBeDefined()
    // severity_curve(4, 3) ≈ 0.18
    expect(pattern!.severity).toBeCloseTo(0.18, 1)
  })

  it('uses max loop count across files', () => {
    // File a: edit→read = 1 transition = 0 cycles
    // File b: edit→read→edit→read→edit→read→edit→read→edit = 8 transitions = 4 cycles
    const steps = [
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/a.ts' })], 'a-1'),
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'a-2'),
      ...Array.from({ length: 9 }, (_, i) => {
        const tool = i % 2 === 0 ? 'str_replace_based_edit_tool' : 'read_file'
        return createStep([toolResult(tool, { path: 'src/b.ts' })], `b-${i}`)
      }),
    ]
    const { patterns } = detectHighConfidencePatterns(steps)
    const pattern = patterns.find(p => p.type === PatternType.EditReadLoop)
    expect(pattern).toBeDefined()
    // b.ts: 8 transitions → 4 cycles → severity_curve(4, 3) ≈ 0.18
    expect(pattern!.severity).toBeCloseTo(0.18, 1)
  })
})

// EDGE CASES

describe('edge cases', () => {
  it('handles empty steps array', () => {
    const { patterns } = detectHighConfidencePatterns([])
    expect(patterns).toEqual([])
  })

  it('skips steps without correlation ID', () => {
    const steps = [
      createStep([toolResult('read_file', { path: 'src/a.ts' })]), // no correlationId
      createStep([toolResult('read_file', { path: 'src/a.ts' })]),
      createStep([toolResult('read_file', { path: 'src/a.ts' })]),
      createStep([toolResult('read_file', { path: 'src/a.ts' })]),
    ]
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns).toEqual([])
  })

  it('ignores unknown file paths', () => {
    const steps = Array.from({ length: 5 }, (_, i) =>
      createStep([toolResult('read_file', {})], `call-${i}`) // no path → 'unknown'
    )
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.RepeatedReads)).toBeUndefined()
  })

  it('multiple patterns can fire simultaneously', () => {
    const steps = [
      // 4 reads of same file
      ...Array.from({ length: 4 }, (_, i) =>
        createStep([toolResult('read_file', { path: 'src/a.ts' })], `read-${i}`)
      ),
      // 6 empty greps
      ...Array.from({ length: 6 }, (_, i) =>
        createStep([toolResult('grep', { pattern: 'x' }, '')], `grep-${i}`)
      ),
    ]
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.RepeatedReads)).toBeDefined()
    expect(patterns.find(p => p.type === PatternType.GrepSpiral)).toBeDefined()
  })
})

// TOOL RETRY

describe('tool_retry pattern', () => {
  it('not detected when same tool called < 3 times', () => {
    const steps = [
      createStep([toolResult('oauthConnect', {})], 'call-1'),
      createStep([toolResult('oauthConnect', {})], 'call-2'),
    ]
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.ToolRetry)).toBeUndefined()
  })

  it('detected when same tool + same args called 4 times across steps', () => {
    const steps = Array.from({ length: 4 }, (_, i) =>
      createStep([toolResult('oauthConnect', { provider: 'godaddy' })], `call-${i}`)
    )
    const { patterns } = detectHighConfidencePatterns(steps)
    const pattern = patterns.find(p => p.type === PatternType.ToolRetry)
    expect(pattern).toBeDefined()
    expect(pattern!.severity).toBeCloseTo(0.18, 1)
    expect(pattern!.details).toContain('oauthconnect')
  })

  it('not detected when same tool called with different args', () => {
    const steps = Array.from({ length: 4 }, (_, i) =>
      createStep([toolResult('read_file', { path: `src/file-${i}.ts` })], `call-${i}`)
    )
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.ToolRetry)).toBeUndefined()
  })

  it('detects tool-error retries too', () => {
    const steps = Array.from({ length: 4 }, (_, i) =>
      createStep([toolError('oauthConnect', {})], `call-${i}`)
    )
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.ToolRetry)).toBeDefined()
  })

  it('counts unique steps not duplicate items within same step', () => {
    // 4 calls in 2 steps — only 2 unique steps, below threshold
    const steps = [
      createStep([
        toolResult('oauthConnect', {}),
        toolResult('oauthConnect', {}),
      ], 'call-1'),
      createStep([
        toolResult('oauthConnect', {}),
        toolResult('oauthConnect', {}),
      ], 'call-2'),
    ]
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.ToolRetry)).toBeUndefined()
  })

  it('does not classify skill-namespaced workflow tools as retries', () => {
    const steps = [
      ...Array.from({ length: 4 }, (_, i) =>
        createStep([toolResult('initial__todoList', { items: [] })], `todo-${i}`)
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        createStep([toolResult('develop__suggestedResponse', { text: 'Try this' })], `suggested-${i}`)
      ),
    ]
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.ToolRetry)).toBeUndefined()
  })
})

// REAL PRODUCTION TOOL NAMES
//
// The agent registers camelCase tool names (terminalCommand, grepSearch,
// readFile) in allAILibTools. These regression tests pin the detectors to the
// names actually emitted in production so a future rename can't silently kill a
// detector again.

describe('real production tool names', () => {
  it('recognizes terminalCommand failures', () => {
    const steps = Array.from({ length: 4 }, (_, i) =>
      createStep([toolError('terminalCommand', { command: 'npm test' })], `call-${i}`)
    )
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.TerminalFailures)).toBeDefined()
  })

  it('recognizes skill-namespaced terminal commands (publishing__bash)', () => {
    const steps = Array.from({ length: 4 }, (_, i) =>
      createStep([toolError('publishing__bash', { command: 'make build' })], `call-${i}`)
    )
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.TerminalFailures)).toBeDefined()
  })

  it('recognizes grepSearch spiral', () => {
    const steps = Array.from({ length: 6 }, (_, i) =>
      createStep([toolResult('grepSearch', { pattern: 'test' }, 'No matches found')], `call-${i}`)
    )
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.GrepSpiral)).toBeDefined()
  })

  it('recognizes readFile repeated reads', () => {
    const steps = Array.from({ length: 5 }, (_, i) =>
      createStep([toolResult('readFile', { path: 'src/a.ts' })], `call-${i}`)
    )
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.RepeatedReads)).toBeDefined()
  })
})

// COMMAND-AWARE EDITOR CLASSIFICATION
//
// str_replace_based_edit_tool is command-dispatched: `view` reads,
// `str_replace`/`insert` edit, `create` writes. The detectors must classify by
// command, not just by tool name.

describe('command-aware editor classification', () => {
  it('treats editor view as a read (repeated_reads fires)', () => {
    const steps = Array.from({ length: 5 }, (_, i) =>
      createStep(
        [toolResult('str_replace_based_edit_tool', { command: 'view', path: 'src/a.ts' })],
        `call-${i}`
      )
    )
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.RepeatedReads)).toBeDefined()
    // ...and must NOT be miscounted as repeated edits
    expect(patterns.find(p => p.type === PatternType.RepeatedEdits)).toBeUndefined()
  })

  it('does NOT count repeated editor views as edits (no false repeated_edits)', () => {
    const steps = Array.from({ length: 6 }, (_, i) =>
      createStep(
        [toolResult('str_replace_based_edit_tool', { command: 'view', path: 'src/a.ts' })],
        `call-${i}`
      )
    )
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.RepeatedEdits)).toBeUndefined()
  })

  it('treats editor str_replace as an edit (repeated_edits fires)', () => {
    const steps = Array.from({ length: 6 }, (_, i) =>
      createStep(
        [toolResult('str_replace_based_edit_tool', { command: 'str_replace', path: 'src/a.ts' })],
        `call-${i}`
      )
    )
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.RepeatedEdits)).toBeDefined()
  })

  it('excludes editor create (full-file write) from edit churn', () => {
    const steps = Array.from({ length: 6 }, (_, i) =>
      createStep(
        [toolResult('str_replace_based_edit_tool', { command: 'create', path: 'src/a.ts' })],
        `call-${i}`
      )
    )
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.RepeatedEdits)).toBeUndefined()
  })

  it('detects edit_read_loop entirely within the editor (view + str_replace)', () => {
    // str_replace→view alternating, 8 transitions = 4 cycles
    const steps = Array.from({ length: 9 }, (_, i) =>
      createStep(
        [toolResult('str_replace_based_edit_tool', {
          command: i % 2 === 0 ? 'str_replace' : 'view',
          path: 'src/a.ts',
        })],
        `call-${i}`
      )
    )
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.EditReadLoop)).toBeDefined()
  })

  it('defaults to edit when the editor command is missing (back-compat)', () => {
    const steps = Array.from({ length: 6 }, (_, i) =>
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/a.ts' })], `call-${i}`)
    )
    const { patterns } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.RepeatedEdits)).toBeDefined()
  })
})

// PATTERN COUNTS (threshold optimality dashboarding)

describe('patternCounts', () => {
  it('returns all zeros for empty steps', () => {
    const { counts } = detectHighConfidencePatterns([])
    expect(counts).toEqual(ZERO_PATTERN_COUNTS)
  })

  it('tracks repeated_reads count below threshold (pattern does not fire)', () => {
    const steps: ExecutionStep[] = [
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-1'),
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-2'),
    ]
    const { patterns, counts } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.RepeatedReads)).toBeUndefined()
    expect(counts.repeated_reads).toBe(2)
  })

  it('tracks repeated_reads count at threshold (severity = 0, pattern filtered)', () => {
    const steps: ExecutionStep[] = [
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-1'),
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-2'),
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-3'),
    ]
    const { patterns, counts } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.RepeatedReads)).toBeUndefined()
    expect(counts.repeated_reads).toBe(3)
  })

  it('tracks repeated_reads max across files', () => {
    const steps: ExecutionStep[] = [
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-1'),
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-2'),
      createStep([toolResult('read_file', { path: 'src/b.ts' })], 'call-3'),
      createStep([toolResult('read_file', { path: 'src/b.ts' })], 'call-4'),
      createStep([toolResult('read_file', { path: 'src/b.ts' })], 'call-5'),
      createStep([toolResult('read_file', { path: 'src/b.ts' })], 'call-6'),
      createStep([toolResult('read_file', { path: 'src/b.ts' })], 'call-7'),
    ]
    const { counts } = detectHighConfidencePatterns(steps)
    expect(counts.repeated_reads).toBe(5)
  })

  it('tracks repeated_edits count below threshold', () => {
    const steps: ExecutionStep[] = Array.from({ length: 4 }, (_, i) =>
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/a.ts' })], `call-${i}`)
    )
    const { patterns, counts } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.RepeatedEdits)).toBeUndefined()
    expect(counts.repeated_edits).toBe(4)
  })

  it('tracks grep_spiral as total grep count', () => {
    const steps: ExecutionStep[] = [
      createStep([toolResult('grep', { pattern: 'a' }, '')], 'call-1'),
      createStep([toolResult('grep', { pattern: 'b' }, 'found')], 'call-2'),
      createStep([toolResult('grep', { pattern: 'c' }, '')], 'call-3'),
    ]
    const { counts } = detectHighConfidencePatterns(steps)
    expect(counts.grep_spiral).toBe(3)
  })

  it('tracks terminal_failures as count of failed commands', () => {
    const steps: ExecutionStep[] = [
      createStep([toolError('terminal', { command: 'npm test' })], 'call-1'),
      createStep([toolResult('terminal', { command: 'npm build' }, 'ok')], 'call-2'),
      createStep([toolError('terminal', { command: 'npm lint' })], 'call-3'),
    ]
    const { counts } = detectHighConfidencePatterns(steps)
    expect(counts.terminal_failures).toBe(2)
  })

  it('tracks edit_read_loop as max cycle count across files', () => {
    // edit->read->edit->read->edit = 4 transitions = 2 cycles (below threshold)
    const steps: ExecutionStep[] = [
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/a.ts' })], 'call-1'),
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-2'),
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/a.ts' })], 'call-3'),
      createStep([toolResult('read_file', { path: 'src/a.ts' })], 'call-4'),
      createStep([toolResult('str_replace_based_edit_tool', { path: 'src/a.ts' })], 'call-5'),
    ]
    const { patterns, counts } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.EditReadLoop)).toBeUndefined()
    expect(counts.edit_read_loop).toBe(2)
  })

  it('tracks tool_retry as max unique-step count for identical calls', () => {
    const steps: ExecutionStep[] = [
      createStep([toolResult('oauthConnect', { provider: 'godaddy' })], 'call-1'),
      createStep([toolResult('oauthConnect', { provider: 'godaddy' })], 'call-2'),
    ]
    const { patterns, counts } = detectHighConfidencePatterns(steps)
    expect(patterns.find(p => p.type === PatternType.ToolRetry)).toBeUndefined()
    expect(counts.tool_retry).toBe(2)
  })

  it('counts are correct when multiple patterns fire', () => {
    const steps: ExecutionStep[] = [
      ...Array.from({ length: 4 }, (_, i) =>
        createStep([toolResult('read_file', { path: 'src/a.ts' })], `read-${i}`)
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        createStep([toolResult('grep', { pattern: 'x' }, '')], `grep-${i}`)
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        createStep([toolError('terminal', { command: 'npm test' })], `term-${i}`)
      ),
    ]
    const { counts } = detectHighConfidencePatterns(steps)
    expect(counts.repeated_reads).toBe(4)
    expect(counts.grep_spiral).toBe(6)
    expect(counts.terminal_failures).toBe(4)
    expect(counts.repeated_edits).toBe(0)
    expect(counts.edit_read_loop).toBe(0)
    // 6 greps with same pattern+result > 4 terminal errors with same command
    expect(counts.tool_retry).toBe(6)
  })

  it('ignores unknown file paths in counts', () => {
    const steps: ExecutionStep[] = Array.from({ length: 5 }, (_, i) =>
      createStep([toolResult('read_file', {})], `call-${i}`)
    )
    const { counts } = detectHighConfidencePatterns(steps)
    expect(counts.repeated_reads).toBe(0)
  })

  it('skips steps without correlation ID in counts', () => {
    const steps: ExecutionStep[] = [
      createStep([toolResult('read_file', { path: 'src/a.ts' })]),
      createStep([toolResult('read_file', { path: 'src/a.ts' })]),
      createStep([toolResult('read_file', { path: 'src/a.ts' })]),
      createStep([toolResult('read_file', { path: 'src/a.ts' })]),
    ]
    const { counts } = detectHighConfidencePatterns(steps)
    expect(counts.repeated_reads).toBe(0)
  })

  it('excludes workflow tools from tool_retry count', () => {
    const steps: ExecutionStep[] = Array.from({ length: 5 }, (_, i) =>
      createStep([toolResult('initial__todoList', { items: [] })], `call-${i}`)
    )
    const { counts } = detectHighConfidencePatterns(steps)
    expect(counts.tool_retry).toBe(0)
  })

  it('returns expected shape matching PatternCounts type', () => {
    const { counts } = detectHighConfidencePatterns([])
    const expectedKeys: (keyof PatternCounts)[] = [
      'repeated_reads', 'repeated_edits', 'grep_spiral',
      'terminal_failures', 'edit_read_loop', 'tool_retry',
    ]
    for (const key of expectedKeys) {
      expect(typeof counts[key]).toBe('number')
    }
  })
})
