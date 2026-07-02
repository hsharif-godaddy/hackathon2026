import { describe, it, expect } from 'vitest'

import { getSubAgentConfig } from '../index.js'

describe('getSubAgentConfig', () => {
  it('resolves the developer-typecheck sub-agent', async () => {
    const config = await getSubAgentConfig('developer-typecheck')
    expect(config.id).toBe('developer-typecheck')
  })
})
