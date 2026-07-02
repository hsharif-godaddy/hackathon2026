import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useWizardStore } from '@/stores/useWizardStore'
import { handleBuildPhaseNotification } from '../buildPhaseNotification'

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const APP = 'app1'

function notify(phase: unknown, eventAppId: unknown = APP, clientAppId: string = APP): void {
  handleBuildPhaseNotification({
    raw: eventAppId === undefined ? { phase } : { appId: eventAppId, phase },
    clientAppId,
    logPrefix: 'sse.build_phase',
  } as Parameters<typeof handleBuildPhaseNotification>[0])
}

beforeEach(() => {
  useWizardStore.setState({ phaseByApp: {}, celebrateByApp: {} })
})

describe('handleBuildPhaseNotification', () => {
  it.each(['gathering', 'brand', 'website', 'ready'] as const)(
    'sets the wizard phase to %s for a matching, non-empty appId',
    (phase) => {
      notify(phase)
      expect(useWizardStore.getState().phaseByApp[APP]).toBe(phase)
    },
  )

  it('does not write to the store for an unknown phase string', () => {
    notify('finished')
    expect(useWizardStore.getState().phaseByApp[APP]).toBeUndefined()
  })

  it('does not write to the store when the phase is missing', () => {
    notify(undefined, APP)
    expect(useWizardStore.getState().phaseByApp[APP]).toBeUndefined()
  })

  it('does not write to the store when both the payload and client appId are empty', () => {
    notify('brand', '', '')
    expect(useWizardStore.getState().phaseByApp['']).toBeUndefined()
  })

  it('does not write to the store when the client appId is empty and the payload has no appId', () => {
    notify('brand', undefined, '')
    expect(useWizardStore.getState().phaseByApp['']).toBeUndefined()
  })

  it('ignores events whose appId does not match the client app', () => {
    notify('brand', 'other')
    expect(useWizardStore.getState().phaseByApp[APP]).toBeUndefined()
    expect(useWizardStore.getState().celebrateByApp[APP]).toBeFalsy()
  })

  it('fires the one-shot celebration on a live build→ready transition', () => {
    notify('website')
    expect(useWizardStore.getState().celebrateByApp[APP]).toBeFalsy()

    notify('ready')
    expect(useWizardStore.getState().phaseByApp[APP]).toBe('ready')
    expect(useWizardStore.getState().celebrateByApp[APP]).toBe(true)
  })

  it('does not celebrate when the first observed phase is already ready (resume hydration)', () => {
    // No prior build phase in the store → looks like a resume, not a live finish.
    notify('ready')
    expect(useWizardStore.getState().phaseByApp[APP]).toBe('ready')
    expect(useWizardStore.getState().celebrateByApp[APP]).toBeFalsy()
  })

  it('does not re-celebrate on a repeated ready event', () => {
    notify('website')
    notify('ready')
    useWizardStore.getState().clearCelebration(APP)

    notify('ready') // prevPhase is already 'ready'
    expect(useWizardStore.getState().celebrateByApp[APP]).toBe(false)
  })
})
