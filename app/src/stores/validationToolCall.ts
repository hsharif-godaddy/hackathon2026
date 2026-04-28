import { logger } from '@/lib/request-context'
import type { ToolCall } from '@/stores/useStreamingConversationStore'

export type ValidationStatus = 'running' | 'failed' | 'completed' | 'error'

const VALIDATION_STATUSES = new Set<ValidationStatus>([
  'running',
  'failed',
  'completed',
  'error'
])

export function parseValidationStatus(status: unknown): ValidationStatus {
  if (typeof status === 'string' && VALIDATION_STATUSES.has(status as ValidationStatus)) {
    return status as ValidationStatus
  }
  logger.warn('validation.status.unknown', { status })
  return 'error'
}

export function toToolStatus(status: ValidationStatus): ToolCall['status'] {
  if (status === 'running') return 'running'
  if (status === 'error') return 'error'
  return 'completed'
}

export function createValidationToolCall({
  id,
  status,
  diagnostics
}: {
  id: string
  status: ValidationStatus
  diagnostics?: string
}): ToolCall {
  return {
    id,
    name: 'validateCode',
    input: {},
    ...(status !== 'running' && {
      result: {
        status,
        diagnostics: diagnostics ?? ''
      }
    }),
    status: toToolStatus(status),
    ...(status === 'error' && { error: diagnostics ?? '' })
  }
}
