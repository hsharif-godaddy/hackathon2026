import { describe, it, expect } from 'vitest'

import { createDeveloperTypecheckConfig } from '../developer-typecheck.js'

describe('createDeveloperTypecheckConfig', () => {
  it('produces a haiku, low-temperature config with edit + terminal tools', async () => {
    const config = await createDeveloperTypecheckConfig()
    expect(config.id).toBe('developer-typecheck')
    expect(config.model).toBe('claude-haiku-4-5')
    expect(config.maxSteps).toBe(40)
    expect(config.temperature).toBe(0.1)
    expect(config.providerOptions).toEqual({ anthropic: { toolStreaming: false } })
    expect(config.system.length).toBeGreaterThan(0)
    expect(Object.keys(config.tools).sort()).toEqual(
      ['directoryListing', 'grepSearch', 'readFile', 'reference', 'str_replace_based_edit_tool', 'terminalCommand'].sort(),
    )
  })
})
