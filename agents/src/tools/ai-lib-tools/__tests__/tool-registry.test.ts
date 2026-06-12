import { describe, it, expect } from 'vitest'
import { allAILibTools } from '../index.js'

describe('tool registry', () => {
  it('registers awaitAgents alongside runAgent', () => {
    expect(allAILibTools.runAgent).toBeDefined()
    expect(allAILibTools.awaitAgents).toBeDefined()
  })
})
