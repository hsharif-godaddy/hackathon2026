import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Span } from '@opentelemetry/api'
import {
  registerInvocationSpan,
  unregisterInvocationSpan,
  getInvocationSpanByConversation,
  addSkillNameToSpan,
} from '../agent-invocation-context.js'

const mockSpan = (id: string) => ({ id, setAttribute: vi.fn() }) as unknown as Span

const TEST_IDS = ['conv_a', 'conv_b', 'conv_x', 'no-such-conv']

function cleanUp(): void {
  // Overwrite each slot with a sentinel and immediately identity-unregister it.
  // This clears any entry left behind by a previous test without needing to
  // know which span was registered.
  const sentinel = { setAttribute: vi.fn() } as unknown as Span
  for (const id of TEST_IDS) {
    registerInvocationSpan(id, sentinel)
    unregisterInvocationSpan(id, sentinel)
  }
}

describe('invocation span registry', () => {
  beforeEach(cleanUp)

  it('returns undefined for an unregistered conversationId', () => {
    expect(getInvocationSpanByConversation('conv_a')).toBeUndefined()
  })

  it('returns the registered span for a conversationId', () => {
    const span = mockSpan('span_1')
    registerInvocationSpan('conv_a', span)
    expect(getInvocationSpanByConversation('conv_a')).toBe(span)
  })

  it('returns undefined after the span is unregistered', () => {
    const span = mockSpan('span_2')
    registerInvocationSpan('conv_a', span)
    unregisterInvocationSpan('conv_a', span)
    expect(getInvocationSpanByConversation('conv_a')).toBeUndefined()
  })

  it('does not delete an entry registered by a different span for the same conversationId', () => {
    const spanA = mockSpan('span_a1')
    const spanB = mockSpan('span_b1')
    registerInvocationSpan('conv_a', spanA)
    registerInvocationSpan('conv_a', spanB)     // turn B overwrites turn A in the Map
    unregisterInvocationSpan('conv_a', spanA)   // turn A's safeEnd fires — identity mismatch
    expect(getInvocationSpanByConversation('conv_a')).toBe(spanB)  // turn B's span survives
  })

  it('isolates spans across different conversationIds', () => {
    const spanA = mockSpan('span_a')
    const spanB = mockSpan('span_b')
    registerInvocationSpan('conv_a', spanA)
    registerInvocationSpan('conv_b', spanB)
    expect(getInvocationSpanByConversation('conv_a')).toBe(spanA)
    expect(getInvocationSpanByConversation('conv_b')).toBe(spanB)
  })
})

describe('addSkillNameToSpan', () => {
  beforeEach(cleanUp)

  it('returns false when conversationId has no registered entry', () => {
    expect(addSkillNameToSpan('no-such-conv', 'online-appointments')).toBe(false)
  })

  it('stamps a single skill name on the span', () => {
    const span = mockSpan('span_s1')
    registerInvocationSpan('conv_a', span)

    const result = addSkillNameToSpan('conv_a', 'online-appointments')

    expect(result).toBe(true)
    expect(vi.mocked(span.setAttribute)).toHaveBeenCalledWith('skill.names', 'online-appointments')
  })

  it('accumulates multiple skill names as a comma-separated attribute', () => {
    const span = mockSpan('span_s2')
    registerInvocationSpan('conv_a', span)

    addSkillNameToSpan('conv_a', 'online-appointments')
    expect(vi.mocked(span.setAttribute)).toHaveBeenLastCalledWith('skill.names', 'online-appointments')

    addSkillNameToSpan('conv_a', 'database')
    expect(vi.mocked(span.setAttribute)).toHaveBeenLastCalledWith('skill.names', 'online-appointments,database')
  })

  it('deduplicates skill names within a turn', () => {
    const span = mockSpan('span_s3')
    registerInvocationSpan('conv_a', span)

    addSkillNameToSpan('conv_a', 'online-appointments')
    addSkillNameToSpan('conv_a', 'online-appointments')

    expect(vi.mocked(span.setAttribute)).toHaveBeenLastCalledWith('skill.names', 'online-appointments')
  })
})
