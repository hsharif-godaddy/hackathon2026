import { describe, expect,it } from 'vitest'
import type { DebugTurnStatsEvent } from '@airo/shared/websocket'

import { debugStatsReducer, type DebugStatsState, MAX_HISTORY } from './DebugStatsContext'

const baseEvent: DebugTurnStatsEvent = {
  type: 'debug_turn_stats',
  conversationId: 'conv-1',
  agentName: 'main_agent',
  modelName: 'claude-sonnet-4-5',
  inputTokens: 100,
  outputTokens: 50,
  totalTokens: 150,
  cachedInputTokens: 60,
  cacheWriteInputTokens: 40,
  cacheHitRate: 0.6,
  contextWindowUtilization: 0.1,
  costUsd: 0.0010,
  timestamp: '2026-05-18T12:00:00.000Z',
}

const empty: DebugStatsState = { inFlight: null, history: [] }

describe('debugStatsReducer', () => {
  it('LLM_CALL accumulates into a fresh inFlight when null', () => {
    const next = debugStatsReducer(empty, { type: 'LLM_CALL', event: baseEvent })
    expect(next.inFlight).toEqual({
      costUsd: 0.001,
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 60,
      cacheWriteInputTokens: 40,
      modelName: 'claude-sonnet-4-5',
      conversationId: 'conv-1',
    })
    expect(next.history).toEqual([])
  })

  it('LLM_CALL accumulates additively into an existing inFlight', () => {
    const after1 = debugStatsReducer(empty, { type: 'LLM_CALL', event: baseEvent })
    const after2 = debugStatsReducer(after1, {
      type: 'LLM_CALL',
      event: { ...baseEvent, inputTokens: 200, outputTokens: 100, cachedInputTokens: 0, cacheWriteInputTokens: 0, costUsd: 0.002 },
    })
    expect(after2.inFlight).toEqual({
      costUsd: 0.003,
      inputTokens: 300,
      outputTokens: 150,
      cachedInputTokens: 60,
      cacheWriteInputTokens: 40,
      modelName: 'claude-sonnet-4-5',
      conversationId: 'conv-1',
    })
  })

  it('USER_MESSAGE_SENT seals inFlight, recomputes cacheHitRate, resets inFlight', () => {
    const accumulating = debugStatsReducer(empty, { type: 'LLM_CALL', event: baseEvent })
    const sealed = debugStatsReducer(accumulating, { type: 'USER_MESSAGE_SENT', sealedAt: '2026-05-18T12:01:00.000Z' })
    expect(sealed.inFlight).toBeNull()
    expect(sealed.history).toHaveLength(1)
    expect(sealed.history[0]).toMatchObject({
      costUsd: 0.001,
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 60,
      cacheWriteInputTokens: 40,
      cacheHitRate: 0.6,
      modelName: 'claude-sonnet-4-5',
      conversationId: 'conv-1',
      sealedAt: '2026-05-18T12:01:00.000Z',
    })
  })

  it('USER_MESSAGE_SENT with no inFlight is a no-op', () => {
    const next = debugStatsReducer(empty, { type: 'USER_MESSAGE_SENT', sealedAt: 't' })
    expect(next).toEqual(empty)
  })

  it('cacheHitRate is 0 when inputTokens is 0', () => {
    const accumulating = debugStatsReducer(empty, {
      type: 'LLM_CALL',
      event: { ...baseEvent, inputTokens: 0, cachedInputTokens: 0 },
    })
    const sealed = debugStatsReducer(accumulating, { type: 'USER_MESSAGE_SENT', sealedAt: 't' })
    expect(sealed.history[0].cacheHitRate).toBe(0)
  })

  it('history caps at MAX_HISTORY, oldest dropped', () => {
    let s: DebugStatsState = empty
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      s = debugStatsReducer(s, { type: 'LLM_CALL', event: { ...baseEvent, costUsd: i } })
      s = debugStatsReducer(s, { type: 'USER_MESSAGE_SENT', sealedAt: `t-${i}` })
    }
    expect(s.history).toHaveLength(MAX_HISTORY)
    expect(s.history[0].costUsd).toBe(5)
    expect(s.history[MAX_HISTORY - 1].costUsd).toBe(MAX_HISTORY + 4)
  })

  it('CLEAR resets state', () => {
    const accumulating = debugStatsReducer(empty, { type: 'LLM_CALL', event: baseEvent })
    const sealed = debugStatsReducer(accumulating, { type: 'USER_MESSAGE_SENT', sealedAt: 't' })
    const cleared = debugStatsReducer(sealed, { type: 'CLEAR' })
    expect(cleared).toEqual(empty)
  })
})
