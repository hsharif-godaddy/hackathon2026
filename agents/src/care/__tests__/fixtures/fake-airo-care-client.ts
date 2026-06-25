import type { AiroCareClient } from '@airo-care/client'
import type {
  CreateConversationRequest, CreateConversationResponse,
  SendMessageRequest, OnStreamEvent, StreamMessageEvents,
} from '@airo-care/client'

export type FakeCreateBehavior =
  | { kind: 'success'; conversationId: string }
  | { kind: 'throw'; error: unknown }

export type FakeStreamScript =
  | { kind: 'events'; events: StreamMessageEvents[] }
  | { kind: 'throwBefore'; error: unknown }
  | { kind: 'throwAfter'; events: StreamMessageEvents[]; error: unknown }
  /**
   * Yield the listed events, then wait for the caller to abort via the
   * provided signal before resolving. If the signal is already aborted when
   * checked between events, the handler throws an AbortError so the promise
   * rejects, driving the queue.fail() path in CareBridge.
   */
  | { kind: 'abortAfter'; events: StreamMessageEvents[] }

export interface FakeAiroCareClient
  extends Pick<AiroCareClient, 'createConversation' | 'streamMessage'> {
  /** Calls recorded for assertions. */
  readonly createCalls: CreateConversationRequest[]
  readonly streamCalls: SendMessageRequest[]
}

export function makeFakeClient(opts: {
  create: FakeCreateBehavior
  stream: FakeStreamScript
}): FakeAiroCareClient {
  const createCalls: CreateConversationRequest[] = []
  const streamCalls: SendMessageRequest[] = []
  return {
    createCalls,
    streamCalls,
    async createConversation(params: CreateConversationRequest): Promise<CreateConversationResponse> {
      createCalls.push(params)
      if (opts.create.kind === 'throw') throw opts.create.error
      return { conversationId: opts.create.conversationId, ucid: params.ucid }
    },
    async streamMessage(params: SendMessageRequest, handle: OnStreamEvent, options?: { signal?: AbortSignal }): Promise<void> {
      streamCalls.push(params)
      if (opts.stream.kind === 'throwBefore') throw opts.stream.error
      for (const e of opts.stream.events) handle(e)
      if (opts.stream.kind === 'throwAfter') throw opts.stream.error
      if (opts.stream.kind === 'abortAfter') {
        // Simulate: stream yielded its events, but then the caller aborted.
        // Block until the signal fires, then throw an AbortError.
        await new Promise<void>((_resolve, reject) => {
          const signal = options?.signal
          if (signal?.aborted) {
            const err = new DOMException('Aborted', 'AbortError')
            reject(err)
            return
          }
          signal?.addEventListener('abort', () => {
            const err = new DOMException('Aborted', 'AbortError')
            reject(err)
          }, { once: true })
        })
      }
    },
  }
}

/**
 * Create a scripted fake whose create/stream behavior changes per-call.
 * The Nth call uses the Nth entry; the last entry is reused once exhausted.
 */
export function makeScriptedFakeClient(opts: {
  createScript: FakeCreateBehavior[]
  streamScript: FakeStreamScript[]
}): FakeAiroCareClient {
  const createCalls: CreateConversationRequest[] = []
  const streamCalls: SendMessageRequest[] = []

  function createBehavior(callIndex: number): FakeCreateBehavior {
    return opts.createScript[Math.min(callIndex, opts.createScript.length - 1)]!
  }
  function streamBehavior(callIndex: number): FakeStreamScript {
    return opts.streamScript[Math.min(callIndex, opts.streamScript.length - 1)]!
  }

  return {
    createCalls,
    streamCalls,
    async createConversation(params: CreateConversationRequest): Promise<CreateConversationResponse> {
      const behavior = createBehavior(createCalls.length)
      createCalls.push(params)
      if (behavior.kind === 'throw') throw behavior.error
      return { conversationId: behavior.conversationId, ucid: params.ucid }
    },
    async streamMessage(params: SendMessageRequest, handle: OnStreamEvent, options?: { signal?: AbortSignal }): Promise<void> {
      const behavior = streamBehavior(streamCalls.length)
      streamCalls.push(params)
      if (behavior.kind === 'throwBefore') throw behavior.error
      if (behavior.kind === 'abortAfter') {
        for (const e of behavior.events) handle(e)
        await new Promise<void>((_resolve, reject) => {
          const signal = options?.signal
          if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'))
            return
          }
          signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          }, { once: true })
        })
        return
      }
      for (const e of behavior.events) handle(e)
      if (behavior.kind === 'throwAfter') throw behavior.error
    },
  }
}
