import { describe, expect, it } from 'vitest'

import { ProfileSchema, type ProfileData } from '../types.js'

describe('ProfileSchema', function profileSchemaTests() {
  it('validates a valid profile', function validProfile() {
    const valid = {
      name: 'experimental',
      description: 'Test profile',
      properties: {
        'model.default': 'claude-opus-4-6',
        'feature.commerce.enabled': true,
        'context.maxHistoryMessages': 50,
        'feature.disabled': null,
      },
    }
    const result = ProfileSchema.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('experimental')
      expect(result.data.properties['model.default']).toBe('claude-opus-4-6')
    }
  })

  it('rejects profile with empty name', function emptyName() {
    const invalid = { name: '', description: 'Test', properties: {} }
    const result = ProfileSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('rejects profile with nested object property', function nestedObject() {
    const invalid = {
      name: 'bad',
      description: 'Test',
      properties: { nested: { deep: true } },
    }
    const result = ProfileSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('rejects profile with array property', function arrayProp() {
    const invalid = {
      name: 'bad',
      description: 'Test',
      properties: { list: [1, 2, 3] },
    }
    const result = ProfileSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('allows empty properties', function emptyProps() {
    const valid = { name: 'minimal', description: 'Minimal profile', properties: {} }
    const result = ProfileSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })
})
