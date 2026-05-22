import { randomUUID } from 'crypto'
import type { AssistantModelMessage, ToolModelMessage } from 'ai'

export interface RunPreflightToolsInput {
  preflightTools: string[]
  tools: Record<string, { execute: (input: unknown, context: unknown) => Promise<unknown> }>
  context: unknown
  logger?: { warn: (event: string, data: Record<string, unknown>) => void }
}

export async function runPreflightTools(input: RunPreflightToolsInput): Promise<Array<AssistantModelMessage | ToolModelMessage>> {
  const out: Array<AssistantModelMessage | ToolModelMessage> = []
  for (const name of input.preflightTools) {
    const tool = input.tools[name]
    if (!tool) continue
    let result: unknown
    try {
      result = await tool.execute({}, { experimental_context: input.context })
    } catch (err) {
      input.logger?.warn('preflight.tool_failed', {
        tool: name,
        err: err instanceof Error ? err.message : String(err),
      })
      continue
    }
    const toolCallId = `pf_${randomUUID()}`
    out.push({
      role: 'assistant',
      content: [{
        type: 'tool-call',
        toolCallId,
        toolName: name,
        input: {},
      }],
    })
    out.push({
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId,
        toolName: name,
        output: { type: 'text' as const, value: typeof result === 'string' ? result : JSON.stringify(result) },
      }],
    })
  }
  return out
}
