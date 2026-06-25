export interface EventQueue<T> extends AsyncIterable<T> {
  push(event: T): void
  close(): void
  fail(err: unknown): void
}

/**
 * Minimal callback → async-iterable adapter. Push producers' events from
 * any callback (e.g. AiroCareClient's onEvent handler) and consume them
 * via for-await. Close to signal end-of-stream; fail to throw the reason
 * into the consumer on its next iteration.
 *
 * Single-consumer only. Buffers events when the consumer is slower than
 * the producer; awaits the producer when the consumer is faster.
 */
export function createEventQueue<T>(): EventQueue<T> {
  const buffer: T[] = []
  let closed: boolean = false
  let failure: unknown = undefined
  let pending: { resolve: (v: IteratorResult<T>) => void; reject: (e: unknown) => void } | null = null

  function deliver(): void {
    if (!pending) return
    if (buffer.length > 0) {
      const p: { resolve: (v: IteratorResult<T>) => void; reject: (e: unknown) => void } = pending
      pending = null
      p.resolve({ value: buffer.shift()!, done: false })
      return
    }
    if (failure !== undefined) {
      const p: { resolve: (v: IteratorResult<T>) => void; reject: (e: unknown) => void } = pending
      pending = null
      p.reject(failure)
      return
    }
    if (closed) {
      const p: { resolve: (v: IteratorResult<T>) => void; reject: (e: unknown) => void } = pending
      pending = null
      p.resolve({ value: undefined as never, done: true })
    }
  }

  return {
    push(event: T): void {
      if (closed || failure !== undefined) return
      buffer.push(event)
      deliver()
    },
    close(): void {
      if (closed || failure !== undefined) return
      closed = true
      deliver()
    },
    fail(err: unknown): void {
      if (closed || failure !== undefined) return
      failure = err ?? new Error('queue failed without a reason')
      deliver()
    },
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next: (): Promise<IteratorResult<T>> => new Promise((resolve: (v: IteratorResult<T>) => void, reject: (e: unknown) => void) => {
          pending = { resolve, reject }
          deliver()
        }),
      }
    },
  }
}
