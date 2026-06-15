import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleBuildPhaseNotification } from '../buildPhaseNotification'

const setStep = vi.fn()

vi.mock('@/stores/useWizardStore', () => ({
  useWizardStore: {
    getState: () => ({ setStep: (...args: unknown[]) => setStep(...args) }),
  },
}))

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

describe('handleBuildPhaseNotification', () => {
  beforeEach(() => {
    setStep.mockClear()
  })

  it('advances the wizard step for a matching, non-empty appId', () => {
    handleBuildPhaseNotification({
      raw: { appId: 'app1', step: 3 },
      clientAppId: 'app1',
      logPrefix: 'sse.build_phase',
    })
    expect(setStep).toHaveBeenCalledWith('app1', 3)
  })

  it('does not write to the store when both the payload and client appId are empty', () => {
    handleBuildPhaseNotification({
      raw: { appId: '', step: 3 },
      clientAppId: '',
      logPrefix: 'sse.build_phase',
    })
    expect(setStep).not.toHaveBeenCalled()
  })

  it('does not write to the store when the client appId is empty and the payload has no appId', () => {
    handleBuildPhaseNotification({
      raw: { step: 2 },
      clientAppId: '',
      logPrefix: 'sse.build_phase',
    })
    expect(setStep).not.toHaveBeenCalled()
  })

  it('ignores events whose appId does not match the client app', () => {
    handleBuildPhaseNotification({
      raw: { appId: 'other', step: 2 },
      clientAppId: 'app1',
      logPrefix: 'sse.build_phase',
    })
    expect(setStep).not.toHaveBeenCalled()
  })
})
