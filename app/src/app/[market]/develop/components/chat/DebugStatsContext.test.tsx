import { describe, expect, it } from 'vitest'
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
  steps: 3,
}

const empty: DebugStatsState = { calls: [] }

describe('debugStatsReducer', () => {
  it('LLM_CALL appends a call record', () => {
    const next = debugStatsReducer(empty, { type: 'LLM_CALL', event: baseEvent })
    expect(next.calls).toHaveLength(1)
    expect(next.calls[0]).toMatchObject({
      agentName: 'main_agent',
      modelName: 'claude-sonnet-4-5',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.001,
      cacheHitRate: 0.6,
      cachedInputTokens: 60,
      cacheWriteInputTokens: 40,
      steps: 3,
      timestamp: '2026-05-18T12:00:00.000Z',
    })
  })

  it('LLM_CALL appends multiple records independently', () => {
    const after1 = debugStatsReducer(empty, { type: 'LLM_CALL', event: baseEvent })
    const after2 = debugStatsReducer(after1, {
      type: 'LLM_CALL',
      event: { ...baseEvent, agentName: 'sub:design', costUsd: 0.002 },
    })
    expect(after2.calls).toHaveLength(2)
    expect(after2.calls[0].agentName).toBe('main_agent')
    expect(after2.calls[1].agentName).toBe('sub:design')
  })

  it('calls cap at MAX_HISTORY, oldest dropped', () => {
    let s: DebugStatsState = empty
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      s = debugStatsReducer(s, { type: 'LLM_CALL', event: { ...baseEvent, costUsd: i } })
    }
    expect(s.calls).toHaveLength(MAX_HISTORY)
    expect(s.calls[0].costUsd).toBe(5)
    expect(s.calls[MAX_HISTORY - 1].costUsd).toBe(MAX_HISTORY + 4)
  })

  it('CLEAR resets state', () => {
    const withCalls = debugStatsReducer(empty, { type: 'LLM_CALL', event: baseEvent })
    const cleared = debugStatsReducer(withCalls, { type: 'CLEAR' })
    expect(cleared).toEqual(empty)
  })
})
