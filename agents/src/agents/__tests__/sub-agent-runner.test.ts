import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { AgentWrapper, createTool } from '@airo/ai-lib'
import { SubAgentRunner, type SubAgentConfig, type SubAgentEvent } from '../sub-agent-runner.js'

const mockStreamGenerate = vi.fn()

vi.mock('@airo/ai-lib', () => ({
  AgentWrapper: vi.fn().mockImplementation(function () {
    return { streamGenerate: mockStreamGenerate }
  }),
  // Echo tool used for structured returns; the runner reads the payload off the
  // tool call's input, so the real createTool behavior is irrelevant here.
  createTool: vi.fn((_description: string, _schema: unknown, _execute: unknown) => ({ _tool: true })),
  getModel: vi.fn().mockResolvedValue({ id: 'mock-model' }),
}))

vi.mock('../../tools/skill-tool-manager.js', () => ({
  skillToolManager: {},
}))

function makeConfig(overrides: Partial<SubAgentConfig> = {}): SubAgentConfig {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    system: 'You are a test agent.',
    tools: {},
    model: 'gpt-4o',
    maxSteps: 5,
    ...overrides,
  }
}

async function* textStreamFrom(text: string): AsyncIterable<string> {
  yield text
}

function mockStreamResult(text: string, toolCalls: unknown[] = []): {
  textStream: AsyncIterable<string>
  getFinalResult: () => Promise<{ usage: unknown; finishReason: string; toolCalls: unknown[] }>
} {
  return {
    textStream: textStreamFrom(text),
    getFinalResult: vi.fn().mockResolvedValue({
      usage: {},
      finishReason: 'stop',
      toolCalls,
    }),
  }
}

describe('SubAgentRunner', () => {
  beforeEach(() => {
    mockStreamGenerate.mockReset()
    vi.mocked(AgentWrapper).mockClear()
    vi.mocked(createTool).mockClear()
  })

  it('constructs with a config', () => {
    const runner = new SubAgentRunner(makeConfig())
    expect(runner).toBeInstanceOf(SubAgentRunner)
  })

  it('emits a started event before execution', async () => {
    mockStreamGenerate.mockResolvedValue(mockStreamResult('done'))
    const runner = new SubAgentRunner(makeConfig({ name: 'MyAgent' }))
    const events: SubAgentEvent[] = []

    await runner.execute('task', {}, (e) => events.push(e))

    expect(events[0]).toEqual({
      event: 'started',
      agent: 'MyAgent',
      detail: 'Starting task execution',
    })
  })

  it('executes successfully and emits completed event', async () => {
    mockStreamGenerate.mockResolvedValue(mockStreamResult('All files created successfully.'))
    const runner = new SubAgentRunner(makeConfig({ name: 'Builder' }))
    const events: SubAgentEvent[] = []

    const result = await runner.execute(
      'build a page',
      { template: 'v8', pages: ['home', 'about'] },
      (e) => events.push(e)
    )

    expect(result.status).toBe('success')
    expect(result.summary).toBe('All files created successfully.')
    expect(result.artifacts).toEqual([])

    const completedEvent = events.find((e) => e.event === 'completed')
    expect(completedEvent).toEqual({
      event: 'completed',
      agent: 'Builder',
      detail: 'All files created successfully.',
    })
  })

  it('passes executionContext to streamGenerate', async () => {
    mockStreamGenerate.mockResolvedValue(mockStreamResult('done'))
    const runner = new SubAgentRunner(makeConfig())
    const execCtx = { metadata: { appId: 'app-123', appPath: '/tmp/app' } }

    await runner.execute('task', {}, () => {}, execCtx)

    expect(mockStreamGenerate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ executionContext: execCtx })
    )
  })

  it('builds user message from task and inputs', async () => {
    mockStreamGenerate.mockResolvedValue(mockStreamResult('ok'))
    const runner = new SubAgentRunner(makeConfig())

    await runner.execute(
      'create files',
      { framework: 'react', files: ['a.ts', 'b.ts'] },
      () => {}
    )

    const prompt = mockStreamGenerate.mock.calls[0][0] as string
    expect(prompt).toContain('create files')
    expect(prompt).toContain('framework')
    expect(prompt).toContain('react')
    expect(prompt).toContain('a.ts')
    expect(prompt).toContain('b.ts')
  })

  it('handles error when streamGenerate throws', async () => {
    mockStreamGenerate.mockRejectedValue(new Error('LLM timeout'))
    const runner = new SubAgentRunner(makeConfig({ name: 'Failing' }))
    const events: SubAgentEvent[] = []

    const result = await runner.execute('do work', {}, (e) => events.push(e))

    expect(result.status).toBe('error')
    expect(result.summary).toBe('LLM timeout')
    expect(result.artifacts).toEqual([])

    const errorEvent = events.find((e) => e.event === 'error')
    expect(errorEvent).toEqual({
      event: 'error',
      agent: 'Failing',
      detail: 'LLM timeout',
    })
  })

  it('reports a truncated (finishReason: length) run as an error, not success', async () => {
    mockStreamGenerate.mockResolvedValue({
      textStream: textStreamFrom('Building the homepage...'),
      getFinalResult: vi.fn().mockResolvedValue({
        usage: {},
        finishReason: 'length',
        // A partial edit landed before the truncation — it must survive on the error path
        // so downstream retry logic can see what was already written.
        toolCalls: [
          { toolName: 'str_replace_based_edit_tool', result: { path: '/app/src/pages/index.tsx' } },
        ],
      }),
    })
    const runner = new SubAgentRunner(makeConfig({ name: 'Design Kit Build' }))
    const events: SubAgentEvent[] = []

    const result = await runner.execute('build homepage', {}, (e) => events.push(e))

    expect(result.status).toBe('error')
    expect(result.summary).toContain('finishReason: length')
    expect(result.summary).toContain('incrementally')
    expect(result.artifacts).toEqual(['/app/src/pages/index.tsx'])
    expect(events.some((e) => e.event === 'error')).toBe(true)
    // A truncated run must NOT also emit `completed` — error is the only terminal event.
    expect(events.some((e) => e.event === 'completed')).toBe(false)
  })

  it('treats a non-length finish (stop) with artifacts as success', async () => {
    mockStreamGenerate.mockResolvedValue(mockStreamResult('Wrote the homepage.', [
      { toolName: 'str_replace_based_edit_tool', result: { path: '/app/src/pages/index.tsx' } },
    ]))
    const runner = new SubAgentRunner(makeConfig({ name: 'Design Kit Build' }))
    const events: SubAgentEvent[] = []

    const result = await runner.execute('build homepage', {}, (e) => events.push(e))

    expect(result.status).toBe('success')
    expect(result.artifacts).toEqual(['/app/src/pages/index.tsx'])
    expect(events.some((e) => e.event === 'completed')).toBe(true)
    expect(events.some((e) => e.event === 'error')).toBe(false)
  })

  it('extracts artifacts from writeFile tool results', async () => {
    mockStreamGenerate.mockResolvedValue(mockStreamResult('Created files.', [
      { toolName: 'writeFile', result: { path: '/app/src/index.ts', content: '...' } },
      { toolName: 'writeFile', result: { path: '/app/src/utils.ts', content: '...' } },
      { toolName: 'readFile', result: { content: '...' } },
    ]))
    const runner = new SubAgentRunner(makeConfig({ name: 'Writer' }))

    const result = await runner.execute('write code', {}, () => {})

    expect(result.status).toBe('success')
    expect(result.artifacts).toEqual(['/app/src/index.ts', '/app/src/utils.ts'])
  })

  it('extracts artifacts from str_replace_based_edit_tool results', async () => {
    mockStreamGenerate.mockResolvedValue(mockStreamResult('Edited file.', [
      { toolName: 'str_replace_based_edit_tool', result: { path: '/app/src/main.ts' } },
    ]))
    const runner = new SubAgentRunner(makeConfig())

    const result = await runner.execute('edit code', {}, () => {})

    expect(result.artifacts).toEqual(['/app/src/main.ts'])
  })

  it('extracts artifacts from fileEdit tool results', async () => {
    mockStreamGenerate.mockResolvedValue(mockStreamResult('Done.', [
      { toolName: 'fileEdit', result: { path: '/app/package.json' } },
    ]))
    const runner = new SubAgentRunner(makeConfig())

    const result = await runner.execute('edit', {}, () => {})

    expect(result.artifacts).toEqual(['/app/package.json'])
  })

  it('deduplicates artifact paths', async () => {
    mockStreamGenerate.mockResolvedValue(mockStreamResult('Done.', [
      { toolName: 'writeFile', result: { path: '/app/index.ts' } },
      { toolName: 'fileEdit', result: { path: '/app/index.ts' } },
    ]))
    const runner = new SubAgentRunner(makeConfig())

    const result = await runner.execute('work', {}, () => {})

    expect(result.artifacts).toEqual(['/app/index.ts'])
  })

  describe('structured returns (returnFormat: { schema })', () => {
    const verdictSchema = z.object({ verdict: z.enum(['pass', 'fail']), score: z.number() })

    it('wires a returnResult stop-after tool and injects the completion instruction', async () => {
      mockStreamGenerate.mockResolvedValue(
        mockStreamResult('Reviewed.', [{ toolName: 'returnResult', input: { verdict: 'pass', score: 9 }, output: { verdict: 'pass', score: 9 } }])
      )
      const runner = new SubAgentRunner(makeConfig())

      await runner.execute('review', {}, () => {}, undefined, undefined, { returnFormat: { schema: verdictSchema } })

      const config = vi.mocked(AgentWrapper).mock.calls[0][0] as {
        tools: Record<string, unknown>
        stopAfterTools?: string[]
        system: string
      }
      expect(config.stopAfterTools).toEqual(['returnResult'])
      expect(config.tools).toHaveProperty('returnResult')
      expect(config.system).toContain('returnResult')
      // The synthetic tool is built from the caller's schema.
      expect(vi.mocked(createTool)).toHaveBeenCalledWith(expect.any(String), verdictSchema, expect.any(Function))
    })

    it('reads the validated payload off the returnResult call and attaches structuredOutput', async () => {
      mockStreamGenerate.mockResolvedValue(
        mockStreamResult('Reviewed the plan.', [{ toolName: 'returnResult', input: { verdict: 'pass', score: 9 }, output: { verdict: 'pass', score: 9 } }])
      )
      const runner = new SubAgentRunner(makeConfig())

      const result = await runner.execute('review', {}, () => {}, undefined, undefined, {
        returnFormat: { schema: verdictSchema },
      })

      expect(result.status).toBe('success')
      expect(result.summary).toBe('Reviewed the plan.') // work-turn prose preserved as summary
      expect(result.structuredOutput).toEqual({ verdict: 'pass', score: 9 })
      expect(mockStreamGenerate).toHaveBeenCalledTimes(1) // no extra turn
    })

    it('reads the payload from `args` when the SDK names the field that way', async () => {
      mockStreamGenerate.mockResolvedValue(
        mockStreamResult('done', [{ toolName: 'returnResult', args: { verdict: 'fail', score: 2 }, result: { verdict: 'fail', score: 2 } }])
      )
      const runner = new SubAgentRunner(makeConfig())

      const result = await runner.execute('review', {}, () => {}, undefined, undefined, {
        returnFormat: { schema: verdictSchema },
      })

      expect(result.status).toBe('success')
      expect(result.structuredOutput).toEqual({ verdict: 'fail', score: 2 })
    })

    it('fails as a distinct error (not success) when the worker never returns a result', async () => {
      mockStreamGenerate.mockResolvedValue(
        mockStreamResult('I did some work but forgot to call the tool.', [
          { toolName: 'str_replace_based_edit_tool', result: { path: '/app/x.ts' } },
        ])
      )
      const runner = new SubAgentRunner(makeConfig())
      const events: SubAgentEvent[] = []

      const result = await runner.execute('review', {}, (e) => events.push(e), undefined, undefined, {
        returnFormat: { schema: verdictSchema },
      })

      expect(result.status).toBe('error')
      expect(result.structuredOutput).toBeUndefined()
      expect(result.summary).toContain('did not return a structured result')
      // A structured failure surfaces `error` only — never a completed-then-error pair.
      expect(events.some((e) => e.event === 'completed')).toBe(false)
      expect(events.some((e) => e.event === 'error')).toBe(true)
    })

    it('errors (does not pass through) when the terminal returnResult call is schema-invalid', async () => {
      // maxSteps exhausted on a malformed returnResult: the AI SDK surfaces the call in
      // toolCalls with `invalid: true` and its schema-violating input but NO successful
      // result (it never satisfied stopAfterTools). The runner must treat this as
      // not-returned, not pass the invalid payload through as a success.
      mockStreamGenerate.mockResolvedValue({
        textStream: textStreamFrom('done'),
        getFinalResult: vi.fn().mockResolvedValue({
          usage: {},
          finishReason: 'stop',
          toolCalls: [{ toolName: 'returnResult', input: { verdict: 'pass' }, invalid: true, error: 'missing score' }],
        }),
      })
      const runner = new SubAgentRunner(makeConfig())

      const result = await runner.execute('review', {}, () => {}, undefined, undefined, {
        returnFormat: { schema: verdictSchema },
      })

      expect(result.status).toBe('error')
      expect(result.summary).toContain('did not return a structured result')
      expect(result.structuredOutput).toBeUndefined()
    })

    it('passes the SDK-validated payload through without re-validating (transform schemas round-trip)', async () => {
      // The SDK validates+transforms the tool input before it reaches the runner, so
      // the captured `input` is already the transformed shape (tags: string[]). A
      // re-`safeParse` against the input-side schema (z.string()) would reject the
      // array and falsely error; the runner must trust the SDK's validation instead.
      const transformSchema = z.object({ tags: z.string().transform((s: string) => s.split(',')) })
      mockStreamGenerate.mockResolvedValue(
        mockStreamResult('done', [{ toolName: 'returnResult', input: { tags: ['a', 'b'] }, output: { tags: ['a', 'b'] } }])
      )
      const runner = new SubAgentRunner(makeConfig())

      const result = await runner.execute('review', {}, () => {}, undefined, undefined, {
        returnFormat: { schema: transformSchema },
      })

      expect(result.status).toBe('success')
      expect(result.structuredOutput).toEqual({ tags: ['a', 'b'] })
    })

    it('aggregates artifacts written in earlier steps when returnResult is the final step', async () => {
      // A write lands in step 1; the terminal `returnResult` is alone in the final
      // step. `finalResult.toolCalls` (last step) holds only returnResult, so
      // last-step-only extraction reports zero artifacts. The editor returns a status
      // STRING with the path only on its INPUT (as the real tool does), so the write is
      // recovered from `session.filesWritten` (input-based), not from the result.
      mockStreamGenerate.mockResolvedValue({
        textStream: textStreamFrom('done'),
        getFinalResult: vi.fn().mockResolvedValue({
          usage: {},
          finishReason: 'stop',
          toolCalls: [{ toolName: 'returnResult', input: { verdict: 'pass', score: 9 }, output: { verdict: 'pass', score: 9 } }],
          steps: [
            { response: { messages: [] }, toolResults: [{ toolName: 'str_replace_based_edit_tool', input: { command: 'str_replace', path: '/app/home.tsx' }, output: 'Successfully replaced text.' }] },
            { response: { messages: [] }, toolResults: [{ toolName: 'returnResult', input: { verdict: 'pass', score: 9 }, output: { verdict: 'pass', score: 9 } }] },
          ],
        }),
      })
      const runner = new SubAgentRunner(makeConfig())

      const result = await runner.execute('review', {}, () => {}, undefined, undefined, {
        returnFormat: { schema: verdictSchema },
      })

      expect(result.status).toBe('success')
      expect(result.artifacts).toEqual(['/app/home.tsx'])
      expect(result.structuredOutput).toEqual({ verdict: 'pass', score: 9 })
    })

    it('does not report read-only editor view calls as structured-run artifacts', async () => {
      mockStreamGenerate.mockResolvedValue({
        textStream: textStreamFrom('done'),
        getFinalResult: vi.fn().mockResolvedValue({
          usage: {},
          finishReason: 'stop',
          toolCalls: [{ toolName: 'returnResult', input: { verdict: 'pass', score: 9 }, output: { verdict: 'pass', score: 9 } }],
          steps: [
            { response: { messages: [] }, toolResults: [{ toolName: 'str_replace_based_edit_tool', input: { command: 'view', path: '/app/home.tsx' }, output: 'file contents' }] },
            { response: { messages: [] }, toolResults: [{ toolName: 'returnResult', input: { verdict: 'pass', score: 9 }, output: { verdict: 'pass', score: 9 } }] },
          ],
        }),
      })
      const runner = new SubAgentRunner(makeConfig())

      const result = await runner.execute('review', {}, () => {}, undefined, undefined, {
        returnFormat: { schema: verdictSchema },
      })

      expect(result.status).toBe('success')
      expect(result.artifacts).toEqual([])
      expect(result.structuredOutput).toEqual({ verdict: 'pass', score: 9 })
    })

    it('does not report a create that wrote nothing (no matching upload) as an artifact', async () => {
      // The `create` skip-branches return a non-success status string without writing;
      // its input path must not surface as a produced artifact (only confirmed writes do).
      mockStreamGenerate.mockResolvedValue({
        textStream: textStreamFrom('done'),
        getFinalResult: vi.fn().mockResolvedValue({
          usage: {},
          finishReason: 'stop',
          toolCalls: [{ toolName: 'returnResult', input: { verdict: 'pass', score: 9 }, output: { verdict: 'pass', score: 9 } }],
          steps: [
            { response: { messages: [] }, toolResults: [
              { toolName: 'str_replace_based_edit_tool', input: { command: 'create', path: '/app/made.tsx' }, output: 'Successfully created made.tsx' },
              { toolName: 'str_replace_based_edit_tool', input: { command: 'create', path: '/app/skipped.tsx' }, output: 'No upload available to fill skipped.tsx — do not create an empty file.' },
            ] },
            { response: { messages: [] }, toolResults: [{ toolName: 'returnResult', input: { verdict: 'pass', score: 9 }, output: { verdict: 'pass', score: 9 } }] },
          ],
        }),
      })
      const runner = new SubAgentRunner(makeConfig())

      const result = await runner.execute('review', {}, () => {}, undefined, undefined, {
        returnFormat: { schema: verdictSchema },
      })

      expect(result.status).toBe('success')
      expect(result.artifacts).toEqual(['/app/made.tsx'])
    })

    it('keeps the summary non-empty when a structured run emits no closing prose', async () => {
      mockStreamGenerate.mockResolvedValue(
        mockStreamResult('', [{ toolName: 'returnResult', input: { verdict: 'pass', score: 9 }, output: { verdict: 'pass', score: 9 } }])
      )
      const runner = new SubAgentRunner(makeConfig())

      const result = await runner.execute('review', {}, () => {}, undefined, undefined, {
        returnFormat: { schema: verdictSchema },
      })

      expect(result.status).toBe('success')
      expect(result.summary.trim().length).toBeGreaterThan(0)
      expect(result.structuredOutput).toEqual({ verdict: 'pass', score: 9 })
    })

    it('wires no returnResult tool or stop condition for the default summary format', async () => {
      mockStreamGenerate.mockResolvedValue(mockStreamResult('just prose'))
      const runner = new SubAgentRunner(makeConfig())

      const result = await runner.execute('work', {}, () => {})

      expect(result.status).toBe('success')
      expect(result.structuredOutput).toBeUndefined()
      const config = vi.mocked(AgentWrapper).mock.calls[0][0] as { tools: Record<string, unknown>; stopAfterTools?: string[] }
      expect(config.stopAfterTools).toBeUndefined()
      expect(config.tools).not.toHaveProperty('returnResult')
    })

    it('reports a truncated work turn as an error before checking structured output', async () => {
      mockStreamGenerate.mockResolvedValue({
        textStream: textStreamFrom('partial'),
        getFinalResult: vi.fn().mockResolvedValue({ usage: {}, finishReason: 'length', toolCalls: [] }),
      })
      const runner = new SubAgentRunner(makeConfig())

      const result = await runner.execute('work', {}, () => {}, undefined, undefined, {
        returnFormat: { schema: verdictSchema },
      })

      expect(result.status).toBe('error')
      expect(result.summary).toContain('finishReason: length')
      expect(result.structuredOutput).toBeUndefined()
    })
  })
})
