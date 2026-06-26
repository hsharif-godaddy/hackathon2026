import { describe, expect, it } from 'vitest'

import { createLocalDateTime } from './scheduling'

describe('createLocalDateTime', () => {
  it('parses a 12-hour PM time into a valid local Date', () => {
    const result = createLocalDateTime('2026-06-25', '2:30 PM')

    expect(Number.isNaN(result.getTime())).toBe(false)
    expect(result.getFullYear()).toBe(2026)
    expect(result.getMonth()).toBe(5) // June (0-indexed)
    expect(result.getDate()).toBe(25)
    expect(result.getHours()).toBe(14)
    expect(result.getMinutes()).toBe(30)
  })

  it('parses a 12-hour AM time into a valid local Date', () => {
    const result = createLocalDateTime('2026-06-25', '9:05 AM')

    expect(Number.isNaN(result.getTime())).toBe(false)
    expect(result.getHours()).toBe(9)
    expect(result.getMinutes()).toBe(5)
  })

  it('handles 12 AM (midnight) and 12 PM (noon) boundaries', () => {
    expect(createLocalDateTime('2026-06-25', '12:00 AM').getHours()).toBe(0)
    expect(createLocalDateTime('2026-06-25', '12:00 PM').getHours()).toBe(12)
  })

  it('produces a valid Date where naive new Date(`${date}T${time}`) parsing would not', () => {
    // Regression guard: the publish modal previously built the schedule time with
    // `new Date(\`${date}T${time}\`)`, which yields an Invalid Date for 12-hour
    // time strings (e.g. "2026-06-25T2:30 PM"). That serialized to null over the
    // WebSocket, causing scheduled posts to publish immediately.
    const naive = new Date('2026-06-25T2:30 PM')
    expect(Number.isNaN(naive.getTime())).toBe(true)

    const correct = createLocalDateTime('2026-06-25', '2:30 PM')
    expect(Number.isNaN(correct.getTime())).toBe(false)
  })
})
