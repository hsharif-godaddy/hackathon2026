// Dual-format SSE pretty-printing, lifted from the original debug-proxy.js.
// Pure: turns one raw chunk into human-readable descriptor lines. The relay
// prepends timing/tag metadata. Parsing is best-effort and never affects what
// is forwarded — the bytes on the wire are relayed untouched.

export const DIM: string = '\x1b[2m'
export const RESET: string = '\x1b[0m'
export const CYAN: string = '\x1b[36m'
export const YELLOW: string = '\x1b[33m'
export const GREEN: string = '\x1b[32m'
export const RED: string = '\x1b[31m'

// Describes a single SSE chunk as zero or more display lines (no timing prefix).
export function describeChunk(chunkStr: string): string[] {
  const lines: string[] = []
  const rawLines: string[] = chunkStr.split('\n')
  let currentEvent: string | null = null

  for (const line of rawLines) {
    const trimmed: string = line.trim()
    if (!trimmed) {
      currentEvent = null
      continue
    }
    if (trimmed.startsWith('event: ')) {
      currentEvent = trimmed.slice(7)
      continue
    }
    if (trimmed === 'data: [DONE]') {
      lines.push('[DONE]')
      continue
    }
    if (!trimmed.startsWith('data: ')) {
      continue
    }

    try {
      const evt: Record<string, unknown> = JSON.parse(trimmed.slice(6))
      const evtType: string | undefined = currentEvent ?? (evt.type as string | undefined)
      if (evtType) {
        lines.push(describeAnthropicEvent(evtType, evt))
      } else {
        lines.push(describeOpenAiEvent(evt))
      }
    } catch {
      lines.push(trimmed.slice(0, 200))
    }
  }

  return lines
}

function describeAnthropicEvent(evtType: string, evt: Record<string, unknown>): string {
  switch (evtType) {
    case 'content_block_start': {
      const block: Record<string, unknown> = (evt.content_block as Record<string, unknown>) ?? {}
      if (block.type === 'tool_use') {
        return `${YELLOW}tool_use: ${String(block.name)}${RESET} (id: ${String(block.id)})`
      }
      if (block.type === 'text') {
        return `${DIM}text_start${RESET}`
      }
      return `${DIM}block_start: ${String(block.type ?? '?')}${RESET}`
    }
    case 'content_block_delta': {
      const delta: Record<string, unknown> = (evt.delta as Record<string, unknown>) ?? {}
      if (delta.type === 'text_delta' && delta.text != null) {
        return String(delta.text).replace(/\n/g, '\\n').slice(0, 120)
      }
      if (delta.type === 'input_json_delta' && delta.partial_json != null) {
        return `${DIM}json: ${String(delta.partial_json).replace(/\n/g, '\\n').slice(0, 120)}${RESET}`
      }
      return `${DIM}delta: ${String(delta.type ?? '?')}${RESET}`
    }
    case 'content_block_stop':
      return `${DIM}block_stop${RESET}`
    case 'message_start': {
      const message: Record<string, unknown> = (evt.message as Record<string, unknown>) ?? {}
      return `${DIM}message_start model=${String(message.model ?? '?')}${RESET}`
    }
    case 'message_delta': {
      const delta: Record<string, unknown> = (evt.delta as Record<string, unknown>) ?? {}
      const usage: Record<string, unknown> | undefined = evt.usage as Record<string, unknown> | undefined
      const tokens: string = usage ? `  out_tokens: ${String(usage.output_tokens)}` : ''
      return `stop: ${String(delta.stop_reason)}${tokens}`
    }
    case 'message_stop':
      return `${GREEN}message_stop${RESET}`
    default:
      return `${DIM}${evtType}${RESET}`
  }
}

function describeOpenAiEvent(evt: Record<string, unknown>): string {
  const choices: Array<Record<string, unknown>> | undefined = evt.choices as Array<Record<string, unknown>> | undefined
  const choice: Record<string, unknown> = choices?.[0] ?? {}
  const delta: Record<string, unknown> = (choice.delta as Record<string, unknown>) ?? {}
  const content: unknown = delta.content
  const toolCall: Record<string, unknown> | undefined = (delta.tool_calls as Array<Record<string, unknown>> | undefined)?.[0]
  const finishReason: unknown = choice.finish_reason

  if (content != null) {
    return String(content).replace(/\n/g, '\\n')
  }
  if (toolCall) {
    const fn: Record<string, unknown> = (toolCall.function as Record<string, unknown>) ?? {}
    if (fn.name) {
      return `${YELLOW}tool_call: ${String(fn.name)}${RESET}`
    }
    if (fn.arguments) {
      return `${DIM}args: ${String(fn.arguments).replace(/\n/g, '\\n')}${RESET}`
    }
  }
  if (finishReason) {
    return `finish: ${String(finishReason)}`
  }
  return `${DIM}${String(evt.object ?? evt.type ?? 'event')}${RESET}`
}
