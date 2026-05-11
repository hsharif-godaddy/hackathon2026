import type { ToolCall } from '@/stores/useStreamingConversationStore'
import { createValidationToolCall, parseValidationStatus } from '@/stores/validationToolCall'

export function buildValidationToolCallFromEvent(
  data: unknown,
  content: string | undefined,
): { toolCall: ToolCall; isTerminal: boolean } {
  const d = (typeof data === 'object' && data) ? data as Record<string, unknown> : {}
  const metadata = typeof d.metadata === 'object' && d.metadata
    ? d.metadata as Record<string, unknown>
    : {}
  const status = parseValidationStatus(metadata.validationStatus)
  const toolCall = createValidationToolCall({
    id: typeof d.validationId === 'string'
      ? d.validationId
      : typeof d.messageId === 'string'
        ? d.messageId
        : `validation_${Date.now()}`,
    status,
    diagnostics: content,
  })
  return { toolCall, isTerminal: status !== 'running' }
}
