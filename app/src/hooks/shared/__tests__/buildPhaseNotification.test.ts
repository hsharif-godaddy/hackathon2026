import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleBuildPhaseNotification } from '../buildPhaseNotification'

const setPhase = vi.fn()

vi.mock('@/stores/useWizardStore', () => ({
  useWizardStore: {
    getState: () => ({ setPhase: (...args: unknown[]) => setPhase(...args) }),
  },
}))

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

describe('handleBuildPhaseNotification', () => {
  beforeEach(() => {
    setPhase.mockClear()
  })

  it.each(['gathering', 'working', 'ready'] as const)(
    'sets the wizard phase to %s for a matching, non-empty appId',
    (phase) => {
      handleBuildPhaseNotification({
        raw: { appId: 'app1', phase },
        clientAppId: 'app1',
        logPrefix: 'sse.build_phase',
      })
      expect(setPhase).toHaveBeenCalledWith('app1', phase)
    },
  )

  it('does not write to the store for an unknown phase string', () => {
    handleBuildPhaseNotification({
      raw: { appId: 'app1', phase: 'finished' },
      clientAppId: 'app1',
      logPrefix: 'sse.build_phase',
    })
    expect(setPhase).not.toHaveBeenCalled()
  })

  it('does not write to the store when the phase is missing', () => {
    handleBuildPhaseNotification({
      raw: { appId: 'app1' },
      clientAppId: 'app1',
      logPrefix: 'sse.build_phase',
    })
    expect(setPhase).not.toHaveBeenCalled()
  })

  it('does not write to the store when both the payload and client appId are empty', () => {
    handleBuildPhaseNotification({
      raw: { appId: '', phase: 'working' },
      clientAppId: '',
      logPrefix: 'sse.build_phase',
    })
    expect(setPhase).not.toHaveBeenCalled()
  })

  it('does not write to the store when the client appId is empty and the payload has no appId', () => {
    handleBuildPhaseNotification({
      raw: { phase: 'working' },
      clientAppId: '',
      logPrefix: 'sse.build_phase',
    })
    expect(setPhase).not.toHaveBeenCalled()
  })

  it('ignores events whose appId does not match the client app', () => {
    handleBuildPhaseNotification({
      raw: { appId: 'other', phase: 'working' },
      clientAppId: 'app1',
      logPrefix: 'sse.build_phase',
    })
    expect(setPhase).not.toHaveBeenCalled()
  })
})
