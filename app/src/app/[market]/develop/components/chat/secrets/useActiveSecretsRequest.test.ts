/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import type { SecretsRequestPayload } from '@/app/[market]/develop/components/ChatSecretsRequestMessage'
import { parseSecretsRequestFromToolResult } from '@/app/[market]/develop/components/utils/parseSecretsRequestFromToolResult'
import type { ChatMessage, StreamingMessage, ToolCall } from '@/stores/useStreamingConversationStore'
import { useActiveSecretsRequest } from './useActiveSecretsRequest'

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
    title: 'Twilio credentials',
    description: 'From Twilio console',
    secrets: [{ name: 'TWILIO_ACCOUNT_SID', required: true }],
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

beforeEach(() => {
  mockMessages = []
  mockActiveStream = null
  mockIsStreaming = false
  Object.keys(mockResolvedSecretsComposerToolCallIds).forEach((k) => {
    delete mockResolvedSecretsComposerToolCallIds[k]
  })
})

describe('useActiveSecretsRequest', () => {
  it('returns single-secret request for one secret', () => {
    const payload = eligiblePayload()
    const tc = makeRequestSecretsToolCall(payload, { id: 'tc-1' })
    mockMessages = [makeAssistantMessage([tc])]

    const { result } = renderHook(() => useActiveSecretsRequest())

    expect(result.current).toMatchObject({
      toolCallId: 'tc-1',
      displayMode: 'single',
      secretKey: 'tc-1:TWILIO_ACCOUNT_SID',
    })
    expect(result.current?.payload.secrets).toHaveLength(1)
  })

  it('returns paginated request with full payload for multi-secret tool calls', () => {
    const payload = eligiblePayload({
      secrets: [
        { name: 'TWILIO_ACCOUNT_SID', required: true },
        { name: 'TWILIO_AUTH_TOKEN', required: true },
      ],
    })
    const tc = makeRequestSecretsToolCall(payload, { id: 'tc-twilio' })
    mockMessages = [makeAssistantMessage([tc])]

    const { result } = renderHook(() => useActiveSecretsRequest())

    expect(result.current).toMatchObject({
      toolCallId: 'tc-twilio',
      displayMode: 'paginated',
      secretKey: 'tc-twilio:batch',
      allSecretNames: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
    })
    expect(result.current?.payload.secrets).toHaveLength(2)
  })

  it('returns null when the batch key is resolved for multi-secret requests', () => {
    const payload = eligiblePayload({
      secrets: [
        { name: 'TWILIO_ACCOUNT_SID', required: true },
        { name: 'TWILIO_AUTH_TOKEN', required: true },
      ],
    })
    const tc = makeRequestSecretsToolCall(payload, { id: 'tc-twilio' })
    mockResolvedSecretsComposerToolCallIds['tc-twilio:batch'] = true
    mockMessages = [makeAssistantMessage([tc])]

    const { result } = renderHook(() => useActiveSecretsRequest())
    expect(result.current).toBeNull()
  })

  it('keeps unresolved requestSecrets during streaming when no live tool call is in activeStream', () => {
    mockIsStreaming = true
    mockMessages = [makeAssistantMessage([makeRequestSecretsToolCall(eligiblePayload())])]

    const { result } = renderHook(() => useActiveSecretsRequest())

    expect(result.current).toMatchObject({
      toolCallId: 'tc-secrets-1',
      displayMode: 'single',
    })
  })

  it('returns request from activeStream while the turn is still streaming', () => {
    mockIsStreaming = true
    const payload = eligiblePayload()
    const tc = makeRequestSecretsToolCall(payload, { id: 'tc-stream-live' })
    mockActiveStream = {
      id: 'stream-1',
      role: 'assistant',
      content: '',
      segments: [],
      toolCalls: [tc],
      isComplete: false,
      timestamp: new Date(),
    }

    const { result } = renderHook(() => useActiveSecretsRequest())

    expect(result.current).toMatchObject({
      toolCallId: 'tc-stream-live',
      displayMode: 'single',
      secretKey: 'tc-stream-live:TWILIO_ACCOUNT_SID',
    })
  })

  it('returns request from activeStream before finalizeStream clears it', () => {
    const payload = eligiblePayload()
    const tc = makeRequestSecretsToolCall(payload, { id: 'tc-stream' })
    mockActiveStream = {
      id: 'stream-1',
      role: 'assistant',
      content: '',
      segments: [],
      toolCalls: [tc],
      isComplete: false,
      timestamp: new Date(),
    }

    const { result } = renderHook(() => useActiveSecretsRequest())

    expect(result.current).toMatchObject({
      toolCallId: 'tc-stream',
      displayMode: 'single',
      secretKey: 'tc-stream:TWILIO_ACCOUNT_SID',
    })
  })

  it('finds requestSecrets when last message is an assistant message with secrets', () => {
    const payload = eligiblePayload({
      title: 'Twilio credentials',
      secrets: [
        { name: 'TWILIO_ACCOUNT_SID', required: true },
        { name: 'TWILIO_AUTH_TOKEN', required: true },
      ],
    })
    const secretsTc = makeRequestSecretsToolCall(payload, { id: 'tc-twilio' })
    const otherTc: ToolCall = {
      id: 'tc-plan',
      name: 'updateTodoList',
      status: 'completed',
      input: {},
      result: { success: true },
    }
    mockMessages = [
      { id: 'msg-user', role: 'user', content: 'please set up twilio', timestamp: new Date() },
      makeAssistantMessage([secretsTc, otherTc], 'msg-secrets'),
    ]

    const { result } = renderHook(() => useActiveSecretsRequest())

    expect(result.current).toMatchObject({
      toolCallId: 'tc-twilio',
      displayMode: 'paginated',
      secretKey: 'tc-twilio:batch',
    })
  })

  it('keeps takeover active when a user message follows but the secrets toolCallId is still unresolved', () => {
    const payload = eligiblePayload({
      title: 'Twilio credentials',
      secrets: [
        { name: 'TWILIO_ACCOUNT_SID', required: true },
        { name: 'TWILIO_AUTH_TOKEN', required: true },
      ],
    })
    const secretsTc = makeRequestSecretsToolCall(payload, { id: 'tc-twilio' })
    mockMessages = [
      makeAssistantMessage([secretsTc], 'msg-secrets'),
      { id: 'msg-user', role: 'user', content: 'Add Twilio secrets to enable SMS functionality', timestamp: new Date() },
    ]

    const { result } = renderHook(() => useActiveSecretsRequest())

    expect(result.current).toMatchObject({
      toolCallId: 'tc-twilio',
      displayMode: 'paginated',
    })
  })

  it('returns null when the latest unresolved requestSecrets was resolved after a user message', () => {
    const payload = eligiblePayload()
    const secretsTc = makeRequestSecretsToolCall(payload, { id: 'tc-1' })
    mockResolvedSecretsComposerToolCallIds['tc-1:TWILIO_ACCOUNT_SID'] = true
    mockMessages = [
      makeAssistantMessage([secretsTc], 'msg-secrets'),
      { id: 'msg-user', role: 'user', content: 'done', timestamp: new Date() },
    ]

    const { result } = renderHook(() => useActiveSecretsRequest())

    expect(result.current).toBeNull()
  })

  it('returns the newest unresolved requestSecrets even when a user message is last', () => {
    const payload = eligiblePayload()
    mockMessages = [
      makeAssistantMessage([makeRequestSecretsToolCall(payload, { id: 'tc-1' })], 'msg-secrets'),
      { id: 'msg-user-1', role: 'user', content: 'update stripe api key', timestamp: new Date() },
      makeAssistantMessage(
        [makeRequestSecretsToolCall(eligiblePayload({ title: 'Stripe' }), { id: 'tc-2' })],
        'msg-secrets-2',
      ),
      { id: 'msg-user-2', role: 'user', content: 'I changed my mind', timestamp: new Date() },
    ]

    const { result } = renderHook(() => useActiveSecretsRequest())

    expect(result.current).toMatchObject({ toolCallId: 'tc-2' })
  })
})
