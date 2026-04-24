/**
 * Tests for env-overrides.ts
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest'
import { parseChunkTimeoutMs } from '../env-overrides.js'

describe('parseChunkTimeoutMs', () => {
  let originalEnv: string | undefined

  beforeEach(() => {
    originalEnv = process.env.AI_CHUNK_TIMEOUT_MS
    delete process.env.AI_CHUNK_TIMEOUT_MS
  })

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.AI_CHUNK_TIMEOUT_MS = originalEnv
    } else {
      delete process.env.AI_CHUNK_TIMEOUT_MS
    }
  })

  it('returns undefined when env var is unset', () => {
    expect(parseChunkTimeoutMs()).toBeUndefined()
  })

  it('parses a valid positive integer', () => {
    process.env.AI_CHUNK_TIMEOUT_MS = '5000'
    expect(parseChunkTimeoutMs()).toBe(5000)
  })

  it('parses a large valid number', () => {
    process.env.AI_CHUNK_TIMEOUT_MS = '300000'
    expect(parseChunkTimeoutMs()).toBe(300000)
  })

  it('returns undefined for zero', () => {
    process.env.AI_CHUNK_TIMEOUT_MS = '0'
    expect(parseChunkTimeoutMs()).toBeUndefined()
  })

  it('returns undefined for a negative number', () => {
    process.env.AI_CHUNK_TIMEOUT_MS = '-1000'
    expect(parseChunkTimeoutMs()).toBeUndefined()
  })

  it('returns undefined for a non-numeric string', () => {
    process.env.AI_CHUNK_TIMEOUT_MS = 'abc'
    expect(parseChunkTimeoutMs()).toBeUndefined()
  })

  it('returns undefined for an empty string', () => {
    process.env.AI_CHUNK_TIMEOUT_MS = ''
    expect(parseChunkTimeoutMs()).toBeUndefined()
  })

  it('returns undefined for NaN string', () => {
    process.env.AI_CHUNK_TIMEOUT_MS = 'NaN'
    expect(parseChunkTimeoutMs()).toBeUndefined()
  })

  it('returns undefined for Infinity string', () => {
    process.env.AI_CHUNK_TIMEOUT_MS = 'Infinity'
    expect(parseChunkTimeoutMs()).toBeUndefined()
  })

  it('returns undefined for partial numeric string', () => {
    process.env.AI_CHUNK_TIMEOUT_MS = '5000abc'
    expect(parseChunkTimeoutMs()).toBeUndefined()
  })

  it('returns undefined for a float', () => {
    process.env.AI_CHUNK_TIMEOUT_MS = '5000.5'
    expect(parseChunkTimeoutMs()).toBeUndefined()
  })
})
