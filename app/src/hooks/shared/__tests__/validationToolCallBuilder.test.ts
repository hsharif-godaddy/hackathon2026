import { describe, expect, it, vi } from 'vitest'

import { buildValidationToolCallFromEvent } from '../validationToolCallBuilder'

describe('buildValidationToolCallFromEvent', () => {
  it('marks running status as non-terminal', () => {
    const { toolCall, isTerminal } = buildValidationToolCallFromEvent(
      { validationId: 'v1', metadata: { validationStatus: 'running' } },
      'Validating code...',
    )
    expect(isTerminal).toBe(false)
    expect(toolCall).toMatchObject({ id: 'v1', name: 'validateCode', status: 'running' })
  })

  it('marks completed/failed/error statuses as terminal', () => {
    for (const status of ['completed', 'failed', 'error'] as const) {
      const { isTerminal } = buildValidationToolCallFromEvent(
        { validationId: `v-${status}`, metadata: { validationStatus: status } },
        'done',
      )
      expect(isTerminal).toBe(true)
    }
  })

  it('prefers validationId over messageId in the id fallback chain', () => {
    const { toolCall } = buildValidationToolCallFromEvent(
      { validationId: 'v1', messageId: 'm1', metadata: { validationStatus: 'completed' } },
      'ok',
    )
    expect(toolCall.id).toBe('v1')
  })

  it('falls back to messageId when validationId is absent', () => {
    const { toolCall } = buildValidationToolCallFromEvent(
      { messageId: 'm1', metadata: { validationStatus: 'completed' } },
      'ok',
    )
    expect(toolCall.id).toBe('m1')
  })

  it('synthesizes a Date.now-based id when both validationId and messageId are absent', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-11T00:00:00Z'))
    try {
      const { toolCall } = buildValidationToolCallFromEvent(
        { metadata: { validationStatus: 'running' } },
        undefined,
      )
      expect(toolCall.id).toBe(`validation_${Date.now()}`)
    } finally {
      vi.useRealTimers()
    }
  })

  it('handles missing metadata by defaulting to error status (via parseValidationStatus)', () => {
    const { toolCall, isTerminal } = buildValidationToolCallFromEvent(
      { validationId: 'v1' },
      'x',
    )
    expect(toolCall.status).toBe('error')
    expect(isTerminal).toBe(true)
  })

  it('tolerates non-object data input', () => {
    const { toolCall, isTerminal } = buildValidationToolCallFromEvent(null, undefined)
    expect(toolCall.name).toBe('validateCode')
    expect(isTerminal).toBe(true)
  })
})
