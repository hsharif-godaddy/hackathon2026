import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getSocketIOMock, isAppEligibleForEmitMock } = vi.hoisted(() => ({
  getSocketIOMock: vi.fn(),
  isAppEligibleForEmitMock: vi.fn(),
}))

vi.mock('../ai-lib-websocket-server.js', () => ({
  getSocketIO: getSocketIOMock,
  isAppEligibleForEmit: isAppEligibleForEmitMock,
}))

import { maybeEmitDebugTurnStats } from '../debug-stats-emit.js'

interface FakeSocket {
  handshake: { auth?: { agentContext?: { debugStatsEnabled?: boolean } } }
  emit: ReturnType<typeof vi.fn>
}

function makeSocket(opts: { debugStatsEnabled?: boolean }): FakeSocket {
  return {
    handshake: { auth: { agentContext: { debugStatsEnabled: opts.debugStatsEnabled } } },
    emit: vi.fn(),
  }
}

function setSockets(sockets: FakeSocket[]): void {
  getSocketIOMock.mockReturnValue({
    sockets: { sockets: new Map(sockets.map((s, i) => [String(i), s])) },
  })
}

const baseArgs = {
  appId: 'app-1',
  conversationId: 'conv-1',
  agentName: 'main_agent',
  modelName: 'claude-sonnet-4-5',
  inputTokens: 1000,
  outputTokens: 200,
  totalTokens: 1200,
  cachedInputTokens: 700,
  cacheWriteInputTokens: 300,
}

describe('maybeEmitDebugTurnStats', () => {
  beforeEach(() => {
    getSocketIOMock.mockReset()
    isAppEligibleForEmitMock.mockReset()
    isAppEligibleForEmitMock.mockReturnValue(true)
  })

  it('emits to sockets with debugStatsEnabled claim', () => {
    const enabled = makeSocket({ debugStatsEnabled: true })
    setSockets([enabled])

    maybeEmitDebugTurnStats(baseArgs)

    expect(enabled.emit).toHaveBeenCalledTimes(1)
    expect(enabled.emit).toHaveBeenCalledWith(
      'debug_turn_stats',
      expect.objectContaining({
        type: 'debug_turn_stats',
        conversationId: 'conv-1',
        cachedInputTokens: 700,
        cacheWriteInputTokens: 300,
        cacheHitRate: 0.7,
        modelName: 'claude-sonnet-4-5',
      })
    )
    const emittedPayload = enabled.emit.mock.calls[0][1]
    expect(emittedPayload.costUsd).toBeGreaterThan(0)
  })

  it('does not emit to sockets without the claim', () => {
    const disabled = makeSocket({ debugStatsEnabled: false })
    setSockets([disabled])

    maybeEmitDebugTurnStats(baseArgs)

    expect(disabled.emit).not.toHaveBeenCalled()
  })

  it('does not emit to sockets ineligible for the appId even if the claim is set', () => {
    const wrongApp = makeSocket({ debugStatsEnabled: true })
    setSockets([wrongApp])
    isAppEligibleForEmitMock.mockReturnValue(false)

    maybeEmitDebugTurnStats(baseArgs)

    expect(wrongApp.emit).not.toHaveBeenCalled()
  })

  it('emits only to enabled sockets when both kinds are connected', () => {
    const enabled = makeSocket({ debugStatsEnabled: true })
    const disabled = makeSocket({ debugStatsEnabled: false })
    setSockets([enabled, disabled])

    maybeEmitDebugTurnStats(baseArgs)

    expect(enabled.emit).toHaveBeenCalledTimes(1)
    expect(disabled.emit).not.toHaveBeenCalled()
  })

  it('does not emit when appId is missing', () => {
    const enabled = makeSocket({ debugStatsEnabled: true })
    setSockets([enabled])

    maybeEmitDebugTurnStats({ ...baseArgs, appId: '' })

    expect(getSocketIOMock).not.toHaveBeenCalled()
    expect(enabled.emit).not.toHaveBeenCalled()
  })
})
