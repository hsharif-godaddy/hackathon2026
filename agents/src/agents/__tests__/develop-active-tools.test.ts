import { describe, it, expect } from 'vitest'

import { developActiveToolNames } from '../develop-agent.js'

const ALL = [
  'readFile', 'runAgent', 'awaitAgents', 'askQuestion', 'suggestedResponse',
]

describe('developActiveToolNames', () => {
  it('hides runAgent/awaitAgents when the develop sub-agents flag is off', () => {
    const tools = developActiveToolNames(ALL, {
      promptOptimization: true, suggestedResponse: false, developSubAgents: false,
    })
    expect(tools).not.toContain('runAgent')
    expect(tools).not.toContain('awaitAgents')
  })

  it('exposes runAgent/awaitAgents when the flag is on', () => {
    const tools = developActiveToolNames(ALL, {
      promptOptimization: true, suggestedResponse: false, developSubAgents: true,
    })
    expect(tools).toContain('runAgent')
    expect(tools).toContain('awaitAgents')
  })

  it('still gates askQuestion/suggestedResponse on their own flags', () => {
    const tools = developActiveToolNames(ALL, {
      promptOptimization: false, suggestedResponse: false, developSubAgents: true,
    })
    expect(tools).not.toContain('askQuestion')
    expect(tools).not.toContain('suggestedResponse')
  })
})
