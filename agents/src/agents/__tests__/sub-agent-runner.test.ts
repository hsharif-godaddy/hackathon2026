import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SubAgentRunner, type SubAgentConfig, type SubAgentEvent } from '../sub-agent-runner.js'

const mockStreamGenerate = vi.fn()

vi.mock('@airo/ai-lib', () => ({
  AgentWrapper: vi.fn().mockImplementation(function () {
    return { streamGenerate: mockStreamGenerate }
  }),
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
})
