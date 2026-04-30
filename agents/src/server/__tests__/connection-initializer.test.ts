import { describe, it, expect } from 'vitest'
import { ConnectionInitializer } from '../connection-initializer.js'

describe('ConnectionInitializer', () => {
  function createMockAgentFactory(agents: Array<{ id: string; name: string }>) {
    return { agents: { list: () => agents } }
  }

  it('returns agents list and server config', () => {
    const factory = createMockAgentFactory([
      { id: 'develop', name: 'DevelopAgent' },
      { id: 'initial', name: 'InitialAgent' },
    ])

    const initializer = new ConnectionInitializer(
      () => factory,
      { version: '1.0.0' },
    )

    const result = initializer.initialize()

    expect(result.agents).toEqual([
      { id: 'develop', name: 'DevelopAgent' },
      { id: 'initial', name: 'InitialAgent' },
    ])
    expect(result.serverConfig.version).toBe('1.0.0')
    expect(result.serverConfig.capabilities).toContain('streaming')
  })

  it('handles null agent factory gracefully', () => {
    const initializer = new ConnectionInitializer(
      () => null,
      { version: '1.0.0' },
    )

    const result = initializer.initialize()

    expect(result.agents).toEqual([])
  })
})
