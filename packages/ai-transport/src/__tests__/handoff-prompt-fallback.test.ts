import { describe, it, expect, vi } from 'vitest'

vi.mock('socket.io', () => ({
  Server: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn()
  }))
}))

vi.mock('@signals/otel-sdk', () => ({
  createTraceContext: vi.fn().mockReturnValue(Symbol('trace-context'))
}))

import { WebSocketServer } from '../experimental-websocket-server.js'
import { createNoOpPersistence } from '../noop-persistence.js'
import { Server as HTTPServer } from 'http'

function createMinimalServer(stateManager: Record<string, unknown> = {}): WebSocketServer {
  return new WebSocketServer(new HTTPServer(), {
    agents: { get: vi.fn(), list: vi.fn().mockReturnValue([]) } as any,
    messagePersistence: createNoOpPersistence(),
    stateManager: stateManager as any,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
  })
}

function callGetHandoffDetails(
  server: WebSocketServer,
  socketId: string,
  currentAgent: string
): { newAgentName: string; handoffPrompt: string } | null {
  return (server as any).getHandoffDetails(socketId, currentAgent)
}

describe('getHandoffDetails — prompt fallback', () => {
  it('returns null when stateManager has no getCurrentAgent', () => {
    const server = createMinimalServer({})
    const result = callGetHandoffDetails(server, 'sock-1', 'initial')
    expect(result).toBeNull()
  })

  it('returns null when current agent matches (no handoff occurred)', () => {
    const server = createMinimalServer({
      getCurrentAgent: vi.fn().mockReturnValue('develop'),
    })
    const result = callGetHandoffDetails(server, 'sock-1', 'develop')
    expect(result).toBeNull()
  })

  it('returns stored prompt when available', () => {
    const warnSpy = vi.fn()
    const server = createMinimalServer({
      getCurrentAgent: vi.fn().mockReturnValue('develop'),
      getLastHandoffPrompt: vi.fn().mockReturnValue('Build the homepage'),
      clearLastHandoffPrompt: vi.fn(),
    })
    ;(server as any).logger = { info: vi.fn(), warn: warnSpy, error: vi.fn(), debug: vi.fn() }

    const result = callGetHandoffDetails(server, 'sock-1', 'initial')

    expect(result).toEqual({
      newAgentName: 'develop',
      handoffPrompt: 'Build the homepage'
    })
    expect(warnSpy).not.toHaveBeenCalledWith('handoff.no_prompt_fallback', expect.any(Object))
  })

  it('falls back to "Continue" and warns when stored prompt is undefined', () => {
    const warnSpy = vi.fn()
    const server = createMinimalServer({
      getCurrentAgent: vi.fn().mockReturnValue('develop'),
      getLastHandoffPrompt: vi.fn().mockReturnValue(undefined),
      clearLastHandoffPrompt: vi.fn(),
    })
    ;(server as any).logger = { info: vi.fn(), warn: warnSpy, error: vi.fn(), debug: vi.fn() }

    const result = callGetHandoffDetails(server, 'sock-1', 'initial')

    expect(result).toEqual({
      newAgentName: 'develop',
      handoffPrompt: 'Continue'
    })
    expect(warnSpy).toHaveBeenCalledWith('handoff.no_prompt_fallback', {
      newAgentName: 'develop',
      fallback: 'Continue'
    })
  })

  it('falls back to "Continue" when stored prompt is empty string', () => {
    const warnSpy = vi.fn()
    const server = createMinimalServer({
      getCurrentAgent: vi.fn().mockReturnValue('develop'),
      getLastHandoffPrompt: vi.fn().mockReturnValue(''),
      clearLastHandoffPrompt: vi.fn(),
    })
    ;(server as any).logger = { info: vi.fn(), warn: warnSpy, error: vi.fn(), debug: vi.fn() }

    const result = callGetHandoffDetails(server, 'sock-1', 'initial')

    expect(result).toEqual({
      newAgentName: 'develop',
      handoffPrompt: 'Continue'
    })
    expect(warnSpy).toHaveBeenCalledWith('handoff.no_prompt_fallback', expect.any(Object))
  })

  it('falls back to "Continue" when getLastHandoffPrompt is not on stateManager', () => {
    const warnSpy = vi.fn()
    const server = createMinimalServer({
      getCurrentAgent: vi.fn().mockReturnValue('develop'),
      clearLastHandoffPrompt: vi.fn(),
    })
    ;(server as any).logger = { info: vi.fn(), warn: warnSpy, error: vi.fn(), debug: vi.fn() }

    const result = callGetHandoffDetails(server, 'sock-1', 'initial')

    expect(result).toEqual({
      newAgentName: 'develop',
      handoffPrompt: 'Continue'
    })
    expect(warnSpy).toHaveBeenCalledWith('handoff.no_prompt_fallback', expect.any(Object))
  })
})
