import { describe, it, expect } from 'vitest'
import { CareSessionStore } from '../CareSessionStore.js'

describe('CareSessionStore', () => {
  it('getOrInit creates a session with a fresh ucid', () => {
    const store = new CareSessionStore()
    const s = store.getOrInit('aab-1')
    expect(s.ucid).toMatch(/^[0-9a-f-]+$/i)
    expect(s.careConversationId).toBeUndefined()
    expect(store.size()).toBe(1)
  })

  it('getOrInit returns the same session for the same aabConversationId', () => {
    const store = new CareSessionStore()
    const a = store.getOrInit('aab-1')
    const b = store.getOrInit('aab-1')
    expect(a).toBe(b)
    expect(a.ucid).toBe(b.ucid)
    expect(store.size()).toBe(1)
  })

  it('setCareConversationId persists on the existing session', () => {
    const store = new CareSessionStore()
    store.getOrInit('aab-1')
    store.setCareConversationId('aab-1', 'care-conv-1')
    expect(store.getOrInit('aab-1').careConversationId).toBe('care-conv-1')
  })

  it('setCareConversationId is a no-op for unknown ids', () => {
    const store = new CareSessionStore()
    store.setCareConversationId('aab-missing', 'care-conv-1')
    expect(store.size()).toBe(0)
  })

  it('invalidate drops the entry', () => {
    const store = new CareSessionStore()
    store.getOrInit('aab-1')
    store.invalidate('aab-1')
    expect(store.size()).toBe(0)
  })

  it('sweep removes entries idle longer than maxAgeMs', () => {
    let now = 1_000_000
    const store = new CareSessionStore(() => now)
    store.getOrInit('aab-old')
    now += 60_000
    store.getOrInit('aab-recent')
    now += 30_000
    const removed = store.sweep(45_000, () => now)
    expect(removed).toBe(1)
    expect(store.size()).toBe(1)
  })

  it('sweep updates lastTouched on read/write', () => {
    let now = 1_000_000
    const store = new CareSessionStore(() => now)
    store.getOrInit('aab-1')          // touched at t=0
    now += 60_000
    store.getOrInit('aab-1')          // re-touched at t=60s
    now += 30_000                     // 30s since last touch
    const removed = store.sweep(45_000, () => now)
    expect(removed).toBe(0)
    expect(store.size()).toBe(1)
  })
})
