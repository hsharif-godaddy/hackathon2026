import { describe, expect, it, vi } from 'vitest'

import { resolveManualAgentOverride } from '../manual-agent-override.js'

describe('resolveManualAgentOverride', () => {
  it('returns a hyphenated agent override from a first-line command with a body', () => {
    const logger = { info: vi.fn() }

    const requestedAgent = resolveManualAgentOverride(
      'socket-1',
      '/agent initial-v2\nBuild a pricing page',
      logger
    )

    expect(requestedAgent).toBe('initial-v2')
    expect(logger.info).toHaveBeenCalledWith(
      'websocket.agent_router.manual_override',
      expect.objectContaining({
        socketId: 'socket-1',
        requestedAgent: 'initial-v2',
      })
    )
  })

  it('logs and passes through bodyless first-line commands', () => {
    const logger = { info: vi.fn() }

    const requestedAgent = resolveManualAgentOverride('socket-1', '/agent initial-v2', logger)

    expect(requestedAgent).toBeUndefined()
    expect(logger.info).toHaveBeenCalledWith(
      'websocket.agent_router.manual_override_bodyless_passthrough',
      expect.objectContaining({
        socketId: 'socket-1',
        requestedAgent: 'initial-v2',
      })
    )
  })
})
