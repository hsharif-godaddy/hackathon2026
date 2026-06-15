/**
 * Tests for base-tool.ts: context propagation + toModelOutput projection.
 *
 * Context propagation validates that:
 * - toolCallId is injected into context.metadata.toolId
 * - Context mutation works when metadata already exists / is initially undefined
 * - No context mutation when toolCallId is absent; no crash when context is undefined
 * - All three API surfaces (BaseTool, createTool, toAISDKTool) behave consistently
 *
 * toModelOutput validates that the optional projection is forwarded so only the
 * lean projected output reaches the model.
 */
import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { BaseTool, createTool, toAISDKTool } from '../base-tool.js'
import type { AgentContext, ToolDefinition } from '../../core/types.js'

type ToModelOutput = (options: {
  toolCallId: string
  input: unknown
  output: unknown
}) => { type: string; value: string }

class TestTool extends BaseTool {
  readonly name = 'test'
  readonly description = 'A test tool'
  readonly inputSchema = z.object({ value: z.string() })

  executeFn = vi.fn(async (_input: unknown, _context?: AgentContext) => 'result')

  async execute(input: unknown, context?: AgentContext): Promise<unknown> {
    return this.executeFn(input, context)
  }
}

function makeExecutionOptions(context?: AgentContext, toolCallId?: string): any {
  return {
    experimental_context: context,
    ...(toolCallId ? { toolCallId } : {}),
  }
}

describe('BaseTool.toAISDKTool context propagation', () => {
  it('injects toolCallId into existing metadata', async () => {
    const tool = new TestTool()
    const sdkTool = tool.toAISDKTool()
    const context: AgentContext = { metadata: { conversationId: 'c1' } }

    await (sdkTool as any).execute({ value: 'x' }, makeExecutionOptions(context, 'tool-123'))

    expect(tool.executeFn).toHaveBeenCalledWith(
      { value: 'x' },
      expect.objectContaining({ metadata: { conversationId: 'c1', toolId: 'tool-123' } })
    )
  })

  it('creates metadata when initially undefined', async () => {
    const tool = new TestTool()
    const sdkTool = tool.toAISDKTool()
    const context: AgentContext = {} as AgentContext

    await (sdkTool as any).execute({ value: 'x' }, makeExecutionOptions(context, 'tool-456'))

    expect(tool.executeFn).toHaveBeenCalledWith(
      { value: 'x' },
      expect.objectContaining({ metadata: { toolId: 'tool-456' } })
    )
  })

  it('does not mutate context when toolCallId is absent', async () => {
    const tool = new TestTool()
    const sdkTool = tool.toAISDKTool()
    const context: AgentContext = { metadata: { conversationId: 'c1' } }

    await (sdkTool as any).execute({ value: 'x' }, makeExecutionOptions(context))

    expect(tool.executeFn).toHaveBeenCalledWith(
      { value: 'x' },
      expect.objectContaining({ metadata: { conversationId: 'c1' } })
    )
    expect((context.metadata as any).toolId).toBeUndefined()
  })

  it('does not crash when context is undefined', async () => {
    const tool = new TestTool()
    const sdkTool = tool.toAISDKTool()

    await (sdkTool as any).execute({ value: 'x' }, makeExecutionOptions(undefined, 'tool-789'))

    expect(tool.executeFn).toHaveBeenCalledWith({ value: 'x' }, undefined)
  })
})

describe('createTool context propagation', () => {
  it('injects toolCallId into context.metadata', async () => {
    const executeFn = vi.fn(async () => 'done')
    const sdkTool = createTool('desc', z.object({ v: z.string() }), executeFn)
    const context: AgentContext = { metadata: { existing: true } }

    await (sdkTool as any).execute({ v: 'test' }, makeExecutionOptions(context, 'tc-1'))

    expect(executeFn).toHaveBeenCalledWith(
      { v: 'test' },
      expect.objectContaining({ metadata: { existing: true, toolId: 'tc-1' } })
    )
  })

  it('passes context through without toolId when toolCallId absent', async () => {
    const executeFn = vi.fn(async () => 'done')
    const sdkTool = createTool('desc', z.object({ v: z.string() }), executeFn)
    const context: AgentContext = { metadata: { foo: 'bar' } }

    await (sdkTool as any).execute({ v: 'test' }, makeExecutionOptions(context))

    expect(executeFn).toHaveBeenCalledWith(
      { v: 'test' },
      expect.objectContaining({ metadata: { foo: 'bar' } })
    )
  })

  it('handles undefined context gracefully', async () => {
    const executeFn = vi.fn(async () => 'done')
    const sdkTool = createTool('desc', z.object({ v: z.string() }), executeFn)

    await (sdkTool as any).execute({ v: 'test' }, makeExecutionOptions(undefined, 'tc-2'))

    expect(executeFn).toHaveBeenCalledWith({ v: 'test' }, undefined)
  })
})

describe('toAISDKTool context propagation', () => {
  it('injects toolCallId into context.metadata', async () => {
    const executeFn = vi.fn(async () => 'done')
    const toolDef: ToolDefinition = {
      name: 'legacy',
      description: 'legacy tool',
      inputSchema: z.object({ q: z.string() }),
      execute: executeFn,
    }
    const sdkTool = toAISDKTool(toolDef)
    const context: AgentContext = { metadata: {} }

    await (sdkTool as any).execute({ q: 'hi' }, makeExecutionOptions(context, 'tc-3'))

    expect(executeFn).toHaveBeenCalledWith(
      { q: 'hi' },
      expect.objectContaining({ metadata: { toolId: 'tc-3' } })
    )
  })

  it('mutates the same context object (not a copy)', async () => {
    const executeFn = vi.fn(async () => 'done')
    const toolDef: ToolDefinition = {
      name: 'legacy',
      description: 'legacy tool',
      inputSchema: z.object({ q: z.string() }),
      execute: executeFn,
    }
    const sdkTool = toAISDKTool(toolDef)
    const context: AgentContext = { metadata: { a: 1 } }

    await (sdkTool as any).execute({ q: 'hi' }, makeExecutionOptions(context, 'tc-4'))

    // Verify mutation happened on the original object
    expect((context.metadata as any).toolId).toBe('tc-4')
  })
})

describe('createTool', () => {
  describe('#toModelOutput', () => {
    it('does not set toModelOutput when the option is omitted', () => {
      const t = createTool('desc', z.object({ a: z.string() }), async () => 'ok')
      expect((t as Record<string, unknown>).toModelOutput).toBeUndefined()
    })

    it('forwards toModelOutput so only the projected output reaches the model', () => {
      const t = createTool(
        'desc',
        z.object({ a: z.string() }),
        async () => JSON.stringify({ keep: 1, drop: 'big-blob' }),
        {
          toModelOutput: ({ output }) => {
            const full = JSON.parse(output as string)
            return { type: 'text', value: JSON.stringify({ keep: full.keep }) }
          },
        }
      )

      const toModelOutput = (t as unknown as { toModelOutput: ToModelOutput }).toModelOutput
      expect(toModelOutput).toBeTypeOf('function')

      const projected = toModelOutput({
        toolCallId: 'call-1',
        input: { a: 'x' },
        output: JSON.stringify({ keep: 1, drop: 'big-blob' }),
      })

      expect(projected).toEqual({ type: 'text', value: JSON.stringify({ keep: 1 }) })
      expect(projected.value).not.toContain('big-blob')
    })
  })
})
