import { describe, it, expect } from 'vitest'
import type { AgentsAppContext } from '@airo/shared/websocket'

import { selectCacheConversationId } from '../budget-report-conversation-id.js'

/**
 * Pins the precedence rule used by the cost-attribution cache write:
 * `context.metadata.conversationId` (server-populated by `attachConversationId`
 * in the transport before `onMessageStart`) is authoritative; fall back to the
 * client-sent `context.conversation.conversationId` only when metadata is missing.
 *
 * First-message sessions have no client-sent conversationId (the server generates
 * it), so a guard that reads only the conversation field silently skips the cache
 * write and drops the downstream OTel cost-attribution span.
 */
describe('selectCacheConversationId', () => {
  it('returns metadata.conversationId when only metadata is populated (InitialAgent first-message path)', () => {
    const context = {
      metadata: { conversationId: 'conv-metadata-only' },
    } as AgentsAppContext

    expect(selectCacheConversationId(context)).toEqual({
      value: 'conv-metadata-only',
      source: 'metadata',
    })
  })

  it('returns metadata.conversationId when both fields are populated (metadata is server-canonical)', () => {
    const context = {
      metadata: { conversationId: 'conv-from-metadata' },
      conversation: { conversationId: 'conv-from-client' },
    } as AgentsAppContext

    expect(selectCacheConversationId(context)).toEqual({
      value: 'conv-from-metadata',
      source: 'metadata',
    })
  })

  it('falls back to conversation.conversationId when metadata.conversationId is absent', () => {
    const context = {
      metadata: {},
      conversation: { conversationId: 'conv-client-fallback' },
    } as AgentsAppContext

    expect(selectCacheConversationId(context)).toEqual({
      value: 'conv-client-fallback',
      source: 'conversation',
    })
  })

  it('falls back to conversation.conversationId when metadata itself is undefined', () => {
    const context = {
      conversation: { conversationId: 'conv-client-fallback' },
    } as AgentsAppContext

    expect(selectCacheConversationId(context)).toEqual({
      value: 'conv-client-fallback',
      source: 'conversation',
    })
  })

  it('returns source="none" when neither field is populated (genuine unavailable case, warn log path)', () => {
    const context = {} as AgentsAppContext

    expect(selectCacheConversationId(context)).toEqual({
      value: undefined,
      source: 'none',
    })
  })

  it('returns source="none" when context is undefined (defensive; onMessageStart nullability)', () => {
    expect(selectCacheConversationId(undefined)).toEqual({
      value: undefined,
      source: 'none',
    })
  })

  it('treats empty-string metadata.conversationId as missing and falls back to conversation (pins length > 0 guard)', () => {
    const context = {
      metadata: { conversationId: '' },
      conversation: { conversationId: 'conv-client-fallback' },
    } as AgentsAppContext

    expect(selectCacheConversationId(context)).toEqual({
      value: 'conv-client-fallback',
      source: 'conversation',
    })
  })

  it('returns source="none" when both fields are empty strings (pins length > 0 guard on both branches)', () => {
    const context = {
      metadata: { conversationId: '' },
      conversation: { conversationId: '' },
    } as AgentsAppContext

    expect(selectCacheConversationId(context)).toEqual({
      value: undefined,
      source: 'none',
    })
  })

  it('ignores non-string metadata.conversationId (defensive against external serialization drift)', () => {
    const context = {
      metadata: { conversationId: 123 as unknown },
      conversation: { conversationId: 'conv-client-fallback' },
    } as AgentsAppContext

    expect(selectCacheConversationId(context)).toEqual({
      value: 'conv-client-fallback',
      source: 'conversation',
    })
  })

  it('reports source="metadata" (not "conversation") when both fields hold the same string', () => {
    // Regression: transport copies metadata into conversation.context on steady-state
    // follow-up messages, so both fields hold the same value. An equality-check-based
    // diagnostic log would falsely attribute these writes to "metadata" in every case
    // where they are equal, losing the ability to distinguish the true fallback path.
    const context = {
      metadata: { conversationId: 'same' },
      conversation: { conversationId: 'same' },
    } as AgentsAppContext

    expect(selectCacheConversationId(context)).toEqual({
      value: 'same',
      source: 'metadata',
    })
  })
})
