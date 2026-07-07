import { describe, it, expect, vi, afterEach } from 'vitest'
import { runWithTimeout } from '../utils.js'

describe('runWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves with the value when the promise settles before the timeout', async () => {
    const result = await runWithTimeout(Promise.resolve('extracted text'))
    expect(result).toBe('extracted text')
  })

  it('rejects with the original error when the promise rejects before the timeout', async () => {
    await expect(runWithTimeout(Promise.reject(new Error('parse error')))).rejects.toThrow('parse error')
  })

  it('resolves with the timeout fallback after 30 seconds', async () => {
    vi.useFakeTimers()
    const hanging = new Promise<string>(() => { /* never resolves */ })
    const race = runWithTimeout(hanging)
    vi.advanceTimersByTime(30_000)
    await expect(race).resolves.toContain('took too long to process')
  })
})
