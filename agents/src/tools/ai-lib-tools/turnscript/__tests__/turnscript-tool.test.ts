import { afterEach, describe, expect, it, vi } from 'vitest'

import { logger } from '../../../../logging/index.js'

const { mockRunTurnscript } = vi.hoisted(() => ({ mockRunTurnscript: vi.fn() }))

vi.mock('../runner.js', () => ({
  runTurnscriptInContainer: mockRunTurnscript,
}))

import {
  turnscriptAITool,
  turnscriptReportedFailure,
  formatTurnscriptResult,
} from '../turnscript-tool.js'
import type { TurnscriptResult, DispatchRecord } from '../executor.js'

function dispatch(tool: string, ok: boolean): DispatchRecord {
  return { tool, ms: 1, ok, status: ok ? 'ok' : 'throw', resultBytes: ok ? 10 : 0 }
}

function callTool(input: { code: string }, appId = 'app-1'): Promise<unknown> {
  const execute = (turnscriptAITool as unknown as {
    execute: (i: unknown, o: unknown) => Promise<unknown>
  }).execute
  return execute(input, {
    toolCallId: 'turnscript_test',
    messages: [],
    experimental_context: { metadata: { appId } },
  })
}

describe('turnscript-turnscript-tool', () => {
  describe('#formatTurnscriptResult', () => {
    it('advises a direct-tool fallback and reports already-applied dispatches on a recoverable failure', () => {
      const result: TurnscriptResult = {
        ok: false,
        result: null,
        error: 'dispatch limit (200) exceeded — possible runaway loop',
        failureKind: 'dispatch_cap',
        logs: [],
        dispatches: [
          dispatch('readFile', true),
          dispatch('str_replace_based_edit_tool', true),
          dispatch('str_replace_based_edit_tool', false),
        ],
      }

      const formatted = formatTurnscriptResult(result)

      expect(formatted.fallbackAdvised).toBe(true)
      expect(formatted.text).toContain('[turnscript failed: dispatch_cap]')
      expect(formatted.text).toContain('Do NOT rewrite or re-run this script')
      expect(formatted.text).toContain('str_replace_based_edit_tool')
      expect(formatted.text).toContain('Already applied this script')
      // Two of the three dispatches succeeded — those are reported as already applied.
      expect(formatted.text).toContain('"readFile":1')
      expect(formatted.text).toContain('"str_replace_based_edit_tool":1')
    })

    it('says no edits were applied when a recoverable failure happened before any dispatch', () => {
      const result: TurnscriptResult = {
        ok: false,
        result: null,
        error: 'blocked: script references "require"',
        failureKind: 'blocked',
        logs: [],
        dispatches: [],
      }

      const formatted = formatTurnscriptResult(result)

      expect(formatted.fallbackAdvised).toBe(true)
      expect(formatted.text).toContain('No edits were applied before the failure.')
    })

    it('surfaces the underlying tool error verbatim and does NOT advise fallback for runtime_throw', () => {
      const result: TurnscriptResult = {
        ok: false,
        result: null,
        error: 'old_str not found in About.tsx',
        failureKind: 'runtime_throw',
        logs: [],
        dispatches: [dispatch('str_replace_based_edit_tool', false)],
      }

      const formatted = formatTurnscriptResult(result)

      expect(formatted.fallbackAdvised).toBe(false)
      expect(formatted.text).toContain('[turnscript runtime error] old_str not found in About.tsx')
      expect(formatted.text).not.toContain('Do NOT rewrite')
    })

    it('returns the script summary on success without advising fallback', () => {
      const result: TurnscriptResult = {
        ok: true,
        result: 'edited 2 files',
        logs: [],
        dispatches: [dispatch('readFile', true), dispatch('str_replace_based_edit_tool', true)],
      }

      const formatted = formatTurnscriptResult(result)

      expect(formatted.fallbackAdvised).toBe(false)
      expect(formatted.text).toContain('edited 2 files')
      expect(formatted.text).toContain('[turnscript] 2 dispatch(es)')
    })

    it('surfaces recovered per-dispatch errors (no-rethrow) without advising fallback or tripping admit', () => {
      const result: TurnscriptResult = {
        ok: true,
        result: 'edited Home.tsx; skipped About.tsx',
        logs: [],
        dispatches: [
          dispatch('str_replace_based_edit_tool', true),
          {
            tool: 'str_replace_based_edit_tool',
            ms: 2,
            ok: false,
            status: 'throw',
            resultBytes: 0,
            error: 'No match found for old_str in this file.',
          },
        ],
      }

      const formatted = formatTurnscriptResult(result)

      expect(formatted.fallbackAdvised).toBe(false)
      expect(formatted.text).toContain('edited Home.tsx')
      expect(formatted.text).toContain('1 failure(s)')
      expect(formatted.text).toContain('[failed dispatches] str_replace_based_edit_tool: No match found for old_str')
      // A recovered per-dispatch failure must NOT read as a turnscript failure (no admit).
      expect(turnscriptReportedFailure(formatted.text)).toBe(false)
    })
  })

  describe('#turnscriptReportedFailure', () => {
    it('detects recoverable, runtime, and generic failure outputs', () => {
      expect(turnscriptReportedFailure('[turnscript failed: timeout] wall-clock timeout')).toBe(true)
      expect(turnscriptReportedFailure('[turnscript runtime error] old_str not found')).toBe(true)
      expect(turnscriptReportedFailure('[turnscript error: empty] empty script')).toBe(true)
    })

    it('does not flag a successful turnscript output', () => {
      expect(turnscriptReportedFailure('edited 2 files\n[turnscript] 2 dispatch(es) {"readFile":1}')).toBe(false)
    })
  })

  describe('#turnscriptAITool telemetry', () => {
    afterEach(() => {
      vi.restoreAllMocks()
      mockRunTurnscript.mockReset()
    })

    it('logs turnscript.complete with failureKind and fallbackAdvised=true on a recoverable failure', async () => {
      const infoSpy = vi.spyOn(logger, 'info')
      mockRunTurnscript.mockResolvedValue({
        ok: false,
        result: null,
        error: 'blocked: script references "require"',
        failureKind: 'blocked',
        logs: [],
        dispatches: [],
      } satisfies TurnscriptResult)

      const out = await callTool({ code: 'async () => {}' })

      const complete = infoSpy.mock.calls.find(c => c[0] === 'turnscript.complete')
      expect(complete).toBeDefined()
      expect(complete![1]).toMatchObject({ ok: false, failureKind: 'blocked', fallbackAdvised: true })
      expect(String(out)).toContain('Do NOT rewrite or re-run this script')
    })

    it('logs fallbackAdvised=false and surfaces the error for runtime_throw', async () => {
      const infoSpy = vi.spyOn(logger, 'info')
      mockRunTurnscript.mockResolvedValue({
        ok: false,
        result: null,
        error: 'old_str not found',
        failureKind: 'runtime_throw',
        logs: [],
        dispatches: [dispatch('str_replace_based_edit_tool', false)],
      } satisfies TurnscriptResult)

      const out = await callTool({ code: 'async () => {}' })

      const complete = infoSpy.mock.calls.find(c => c[0] === 'turnscript.complete')
      expect(complete![1]).toMatchObject({ ok: false, failureKind: 'runtime_throw', fallbackAdvised: false })
      expect(String(out)).toContain('[turnscript runtime error] old_str not found')
    })
  })
})
