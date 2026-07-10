import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../logging/index.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { parsePulseResponse, VALID_PROBLEM_TYPES } from '../pulse-parse.js'

const VALID_PAYLOAD = {
  problemType: 'cta_buried',
  headline: '31 people visited, only 1 contacted you',
  description: 'Your CTA is buried below the fold.',
  suggestedFix: 'Move the CTA into the hero section.',
  confidence: 0.85,
}

describe('parsePulseResponse', () => {
  it('parses a valid JSON string', () => {
    const result = parsePulseResponse(JSON.stringify(VALID_PAYLOAD))
    expect(result).not.toBeNull()
    expect(result?.problemType).toBe('cta_buried')
    expect(result?.confidence).toBe(0.85)
  })

  it('strips markdown code block before parsing', () => {
    const wrapped = '```json\n' + JSON.stringify(VALID_PAYLOAD) + '\n```'
    const result = parsePulseResponse(wrapped)
    expect(result?.problemType).toBe('cta_buried')
  })

  it('strips plain code block (no language tag) before parsing', () => {
    const wrapped = '```\n' + JSON.stringify(VALID_PAYLOAD) + '\n```'
    const result = parsePulseResponse(wrapped)
    expect(result?.problemType).toBe('cta_buried')
  })

  it('returns null for malformed JSON', () => {
    const result = parsePulseResponse('{ not valid json }')
    expect(result).toBeNull()
  })

  it('returns null when required fields are missing', () => {
    const { confidence: _c, ...withoutConfidence } = VALID_PAYLOAD
    const result = parsePulseResponse(JSON.stringify(withoutConfidence))
    expect(result).toBeNull()
  })

  it('returns null for non-object JSON', () => {
    expect(parsePulseResponse('"just a string"')).toBeNull()
    expect(parsePulseResponse('42')).toBeNull()
    expect(parsePulseResponse('null')).toBeNull()
  })

  it('falls back to cta_buried when problemType is not in the valid set', () => {
    const payload = { ...VALID_PAYLOAD, problemType: 'unknown_type' }
    const result = parsePulseResponse(JSON.stringify(payload))
    expect(result?.problemType).toBe('cta_buried')
  })

  it.each(VALID_PROBLEM_TYPES)('accepts valid problemType "%s"', (type) => {
    const payload = { ...VALID_PAYLOAD, problemType: type }
    const result = parsePulseResponse(JSON.stringify(payload))
    expect(result?.problemType).toBe(type)
  })

  it('clamps confidence above 1 to 1', () => {
    const payload = { ...VALID_PAYLOAD, confidence: 1.5 }
    const result = parsePulseResponse(JSON.stringify(payload))
    expect(result?.confidence).toBe(1)
  })

  it('clamps confidence below 0 to 0', () => {
    const payload = { ...VALID_PAYLOAD, confidence: -0.2 }
    const result = parsePulseResponse(JSON.stringify(payload))
    expect(result?.confidence).toBe(0)
  })

  it('preserves confidence exactly at boundary values', () => {
    expect(parsePulseResponse(JSON.stringify({ ...VALID_PAYLOAD, confidence: 0 }))?.confidence).toBe(0)
    expect(parsePulseResponse(JSON.stringify({ ...VALID_PAYLOAD, confidence: 1 }))?.confidence).toBe(1)
  })

  it('trims surrounding whitespace before parsing', () => {
    const result = parsePulseResponse('  \n' + JSON.stringify(VALID_PAYLOAD) + '\n  ')
    expect(result).not.toBeNull()
  })
})
