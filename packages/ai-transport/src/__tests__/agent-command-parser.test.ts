import { describe, expect, it } from 'vitest'

import { parseAgentCommand } from '../agent-command-parser.js'

describe('parseAgentCommand', () => {
  it('parses hyphenated first-line agent overrides and strips the command line', () => {
    expect(parseAgentCommand('/agent initial-v2\nBuild a pricing page')).toEqual({
      hasCommand: true,
      hasBody: true,
      agentId: 'initial-v2',
      strippedContent: 'Build a pricing page',
    })
  })

  it('parses the command case-insensitively', () => {
    expect(parseAgentCommand('/AGENT initial-v2\nBuild a pricing page')).toEqual({
      hasCommand: true,
      hasBody: true,
      agentId: 'initial-v2',
      strippedContent: 'Build a pricing page',
    })
  })

  it('normalizes agent IDs to lowercase', () => {
    expect(parseAgentCommand('/agent Initial-V2\nBuild a pricing page')).toEqual({
      hasCommand: true,
      hasBody: true,
      agentId: 'initial-v2',
      strippedContent: 'Build a pricing page',
    })
  })

  it('preserves bodyless commands as commands without stripped content', () => {
    expect(parseAgentCommand('/agent initial-v2')).toEqual({
      hasCommand: true,
      hasBody: false,
      agentId: 'initial-v2',
    })
  })

  it('treats whitespace-only bodies as bodyless commands', () => {
    expect(parseAgentCommand('/agent initial-v2\n   \n\t')).toEqual({
      hasCommand: true,
      hasBody: false,
      agentId: 'initial-v2',
    })
  })

  it('ignores non-command prompts', () => {
    expect(parseAgentCommand('Build a pricing page')).toEqual({
      hasCommand: false,
      hasBody: false,
    })
  })
})
