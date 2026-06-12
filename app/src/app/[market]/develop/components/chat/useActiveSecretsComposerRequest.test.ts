/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import type { SecretsRequestPayload } from '@/app/[market]/develop/components/ChatSecretsRequestMessage'
import { parseSecretsRequestFromToolResult } from '@/app/[market]/develop/components/utils/parseSecretsRequestFromToolResult'
import type { ChatMessage, StreamingMessage, ToolCall } from '@/stores/useStreamingConversationStore'
import { useActiveSecretsComposerRequest } from './useActiveSecretsComposerRequest'

let mockMessages: ChatMessage[] = []
let mockActiveStream: StreamingMessage | null = null
let mockIsStreaming = false
const mockResolvedSecretsComposerToolCallIds: Record<string, true> = {}

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useMessages: () => mockMessages,
  useActiveStream: () => mockActiveStream,
  useIsActivelyStreaming: () => mockIsStreaming,
  useStreamingConversationStore: (selector: (s: { resolvedSecretsComposerToolCallIds: Record<string, true> }) => unknown) =>
    selector({ resolvedSecretsComposerToolCallIds: mockResolvedSecretsComposerToolCallIds }),
}))

function eligiblePayload(overrides: Partial<SecretsRequestPayload> = {}): SecretsRequestPayload {
  return {
    type: 'secrets_request',
    title: 'Need token',
    description: 'Get it from provider',
    secrets: [{ name: 'API_KEY', required: true }],
    mode: 'add',
    ...overrides,
  }
}

function parsedPayload(payload: SecretsRequestPayload): SecretsRequestPayload {
  const parsed = parseSecretsRequestFromToolResult({
    secretsRequired: true,
    secretsRequest: payload,
  })
  if (!parsed) {
    throw new Error('expected valid secrets request fixture')
  }
  return parsed
}

function makeRequestSecretsToolCall(
  payload: SecretsRequestPayload,
  overrides: Partial<ToolCall> = {},
): ToolCall {
  return {
    id: overrides.id ?? 'tc-secrets-1',
    name: 'requestSecrets',
    status: 'completed',
    input: {},
    result: {
      success: true,
      secretsRequired: true,
      secretsRequest: payload,
    },
    ...overrides,
  }
}

function makeAssistantMessage(toolCalls: ToolCall[], id = 'msg-asst'): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: '',
    toolCalls,
    timestamp: new Date(),
  }
}

function makeUserMessage(id = 'msg-user'): ChatMessage {
  return {
    id,
    role: 'user',
    content: 'hello',
    timestamp: new Date(),
  }
}

function makeActiveStream(isComplete: boolean, toolCalls: ToolCall[] = []): StreamingMessage {
  return {
    id: 'stream-1',
    role: 'assistant',
    content: '',
    segments: [],
    toolCalls,
    timestamp: new Date(),
    isComplete,
  }
}

beforeEach(() => {
  mockMessages = []
  mockActiveStream = null
  mockIsStreaming = false
  Object.keys(mockResolvedSecretsComposerToolCallIds).forEach((k) => {
    delete mockResolvedSecretsComposerToolCallIds[k]
  })
})

describe('useActiveSecretsComposerRequest', () => {
  describe('when streaming', () => {
    it('keeps unresolved requestSecrets from history while streaming', () => {
      mockIsStreaming = true
      mockMessages = [makeAssistantMessage([makeRequestSecretsToolCall(eligiblePayload())])]

      const { result } = renderHook(() => useActiveSecretsComposerRequest())
      expect(result.current).toMatchObject({
        toolCallId: 'tc-secrets-1',
        displayMode: 'single',
      })
    })

    it('returns request from activeStream while streaming', () => {
      mockIsStreaming = true
      const payload = eligiblePayload({ title: 'Live stream' })
      const tc = makeRequestSecretsToolCall(payload, { id: 'tc-live' })
      mockActiveStream = makeActiveStream(false, [tc])

      const { result } = renderHook(() => useActiveSecretsComposerRequest())
      expect(result.current).toMatchObject({
        toolCallId: 'tc-live',
        displayMode: 'single',
        secretKey: 'tc-live:API_KEY',
      })
    })
  })

  describe('when active stream has eligible requestSecrets', () => {
    it('returns request before finalizeStream clears activeStream', () => {
      mockActiveStream = makeActiveStream(false, [makeRequestSecretsToolCall(eligiblePayload())])
      mockMessages = [makeAssistantMessage([makeRequestSecretsToolCall(eligiblePayload())])]

      const { result } = renderHook(() => useActiveSecretsComposerRequest())
      expect(result.current).toMatchObject({
        toolCallId: 'tc-secrets-1',
        displayMode: 'single',
      })
    })
  })

  describe('when active stream is complete with eligible requestSecrets', () => {
    it('returns payload and toolCallId from stream', () => {
      const payload = eligiblePayload({ title: 'From stream' })
      const tc = makeRequestSecretsToolCall(payload, { id: 'tc-stream' })
      mockActiveStream = makeActiveStream(true, [tc])

      const { result } = renderHook(() => useActiveSecretsComposerRequest())
      expect(result.current).toMatchObject({
        payload: parsedPayload(payload),
        toolCallId: 'tc-stream',
        displayMode: 'single',
        secretKey: 'tc-stream:API_KEY',
      })
    })
  })

  describe('when there is no active stream', () => {
    it('keeps takeover active when a user message follows but secrets are still unresolved', () => {
      const payload = eligiblePayload({ title: 'Pending' })
      const tc = makeRequestSecretsToolCall(payload, { id: 'tc-pending' })
      mockMessages = [makeAssistantMessage([tc], 'msg-asst-1'), makeUserMessage()]

      const { result } = renderHook(() => useActiveSecretsComposerRequest())
      expect(result.current).toMatchObject({ toolCallId: 'tc-pending' })
    })

    it('returns null when the only eligible requestSecrets toolCallId is resolved', () => {
      const payload = eligiblePayload()
      const tc = makeRequestSecretsToolCall(payload, { id: 'tc-done' })
      mockResolvedSecretsComposerToolCallIds['tc-done:API_KEY'] = true
      mockMessages = [makeAssistantMessage([tc])]

      const { result } = renderHook(() => useActiveSecretsComposerRequest())
      expect(result.current).toBeNull()
    })

    it('returns outstanding request when last message is assistant with eligible secrets', () => {
      const oldPayload = eligiblePayload({ title: 'Old ask' })
      const oldTc = makeRequestSecretsToolCall(oldPayload, { id: 'tc-old' })
      mockMessages = [
        makeUserMessage('msg-0'),
        makeAssistantMessage([oldTc], 'msg-1'),
      ]

      const { result } = renderHook(() => useActiveSecretsComposerRequest())
      expect(result.current?.toolCallId).toBe('tc-old')
    })

    it('returns payload when last message is assistant with eligible tool', () => {
      const payload = eligiblePayload()
      const tc = makeRequestSecretsToolCall(payload, { id: 'tc-msg' })
      mockMessages = [makeAssistantMessage([tc])]

      const { result } = renderHook(() => useActiveSecretsComposerRequest())
      expect(result.current).toMatchObject({
        payload: parsedPayload(payload),
        toolCallId: 'tc-msg',
        displayMode: 'single',
      })
    })

    it('returns paginated request for multi-secret payload', () => {
      const payload = eligiblePayload({
        secrets: [
          { name: 'A', required: true },
          { name: 'B', required: true },
        ],
      })
      mockMessages = [makeAssistantMessage([makeRequestSecretsToolCall(payload)])]

      const { result } = renderHook(() => useActiveSecretsComposerRequest())
      expect(result.current).toMatchObject({
        displayMode: 'paginated',
        secretKey: 'tc-secrets-1:batch',
      })
    })

    it('returns null when tool is not completed', () => {
      const tc = makeRequestSecretsToolCall(eligiblePayload(), { status: 'running' })
      mockMessages = [makeAssistantMessage([tc])]

      const { result } = renderHook(() => useActiveSecretsComposerRequest())
      expect(result.current).toBeNull()
    })

    it('picks last eligible requestSecrets when multiple tool calls exist', () => {
      const first = makeRequestSecretsToolCall(eligiblePayload({ title: 'First' }), { id: 'tc-1' })
      const second = makeRequestSecretsToolCall(eligiblePayload({ title: 'Second' }), { id: 'tc-2' })
      mockMessages = [makeAssistantMessage([first, second])]

      const { result } = renderHook(() => useActiveSecretsComposerRequest())
      expect(result.current?.toolCallId).toBe('tc-2')
      expect(result.current?.payload.title).toBe('Second')
    })
  })

  describe('when active stream is complete but stream tools are resolved', () => {
    it('falls through to messages for an unresolved requestSecrets', () => {
      const streamPayload = eligiblePayload({ title: 'Stream' })
      const streamTc = makeRequestSecretsToolCall(streamPayload, { id: 'tc-stream' })
      mockResolvedSecretsComposerToolCallIds['tc-stream:API_KEY'] = true
      mockActiveStream = makeActiveStream(true, [streamTc])

      const msgPayload = eligiblePayload({ title: 'From history' })
      const msgTc = makeRequestSecretsToolCall(msgPayload, { id: 'tc-msg' })
      mockMessages = [makeAssistantMessage([msgTc])]

      const { result } = renderHook(() => useActiveSecretsComposerRequest())
      expect(result.current).toMatchObject({
        payload: parsedPayload(msgPayload),
        toolCallId: 'tc-msg',
        displayMode: 'single',
      })
    })
  })
})
