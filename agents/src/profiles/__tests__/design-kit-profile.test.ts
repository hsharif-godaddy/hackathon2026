import { describe, expect, it, vi } from 'vitest'

// Mirror the logger mock used by the sibling profile tests so registry
// load-logging does not hit the real logger during this unit test.
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('../../logging/index.js', () => ({
  logger: mockLogger,
}))

import { getProfileRegistry } from '../index.js'

describe('initial-agent-design-kit profile', function designKitProfileTests() {
  it('is registered and maps to the design-kit prompt version', function mapsToDesignKit() {
    const profile = getProfileRegistry().get('initial-agent-design-kit')
    expect(profile).toBeDefined()
    expect(profile?.name).toBe('initial-agent-design-kit')
    expect(profile?.properties['initial.promptVersion']).toBe('design-kit')
  })
})
