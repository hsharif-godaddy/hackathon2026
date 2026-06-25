import { describe, it, expect } from 'vitest'
import { createEventQueue } from '../event-queue.js'

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const v of iter) out.push(v)
  return out
}

describe('createEventQueue', () => {
  it('yields pushed events in order until closed', async () => {
    const q = createEventQueue<number>()
    q.push(1); q.push(2); q.push(3)
    q.close()
    const seen = await collect(q)
    expect(seen).toEqual([1, 2, 3])
  })

  it('supports push interleaved with consumption', async () => {
    const q = createEventQueue<number>()
    setTimeout(() => { q.push(1); q.push(2); q.close() }, 10)
    const seen = await collect(q)
    expect(seen).toEqual([1, 2])
  })

  it('rethrows the failure reason as the consumer iterates', async () => {
    const q = createEventQueue<number>()
    q.push(1)
    q.fail(new Error('boom'))
    const seen: number[] = []
    await expect(async () => {
      for await (const v of q) seen.push(v)
    }).rejects.toThrow('boom')
    expect(seen).toEqual([1])
  })

  it('ignores pushes after close', async () => {
    const q = createEventQueue<number>()
    q.push(1); q.close(); q.push(2)
    const seen = await collect(q)
    expect(seen).toEqual([1])
  })
})
