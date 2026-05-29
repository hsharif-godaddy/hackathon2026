import { describe, it, expect, vi } from 'vitest'
import { readTextStreamFallback } from '../text-stream-fallback.js'

function createTextStream(chunks: string[]): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0
      return {
        async next() {
          if (i < chunks.length) return { value: chunks[i++]!, done: false }
          return { value: undefined as any, done: true }
        },
      }
    },
  }
}

describe('readTextStreamFallback', () => {
  it('delivers all chunks via onChunk', async () => {
    const chunks: string[] = []
    const tracker = { recordChunk: vi.fn() }
    const guard = { reset: vi.fn() }

    await readTextStreamFallback({
      textStream: createTextStream(['hello', ' world']),
      abortSignal: new AbortController().signal,
      onChunk: (text) => { chunks.push(text) },
      tracker,
      guard,
    })

    expect(chunks).toEqual(['hello', ' world'])
    expect(tracker.recordChunk).toHaveBeenCalledTimes(2)
    expect(guard.reset).toHaveBeenCalledTimes(2)
  })

  it('stops on pre-aborted signal', async () => {
    const chunks: string[] = []
    const controller = new AbortController()
    controller.abort()

    await readTextStreamFallback({
      textStream: createTextStream(['a', 'b', 'c']),
      abortSignal: controller.signal,
      onChunk: (text) => { chunks.push(text) },
      tracker: { recordChunk: vi.fn() },
    })

    expect(chunks).toHaveLength(0)
  })

  it('stops when aborted mid-iteration', async () => {
    const chunks: string[] = []
    const controller = new AbortController()

    await readTextStreamFallback({
      textStream: createTextStream(['a', 'b', 'c']),
      abortSignal: controller.signal,
      onChunk: (text) => {
        chunks.push(text)
        if (text === 'a') controller.abort()
      },
      tracker: { recordChunk: vi.fn() },
    })

    expect(chunks).toEqual(['a'])
  })

  it('works without guard', async () => {
    const chunks: string[] = []

    await readTextStreamFallback({
      textStream: createTextStream(['x']),
      abortSignal: new AbortController().signal,
      onChunk: (text) => { chunks.push(text) },
      tracker: { recordChunk: vi.fn() },
    })

    expect(chunks).toEqual(['x'])
  })

  it('propagates errors from textStream', async () => {
    const errorStream: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        return {
          async next() { throw new Error('stream broke') },
        }
      },
    }

    await expect(
      readTextStreamFallback({
        textStream: errorStream,
        abortSignal: new AbortController().signal,
        onChunk: () => {},
        tracker: { recordChunk: vi.fn() },
      }),
    ).rejects.toThrow('stream broke')
  })

  it('propagates errors thrown by onChunk', async () => {
    await expect(
      readTextStreamFallback({
        textStream: createTextStream(['a', 'b']),
        abortSignal: new AbortController().signal,
        onChunk: () => { throw new Error('publish failed') },
        tracker: { recordChunk: vi.fn() },
      }),
    ).rejects.toThrow('publish failed')
  })
})
