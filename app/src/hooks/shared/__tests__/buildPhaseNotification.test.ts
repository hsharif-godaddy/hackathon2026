import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fireDesignKitMilestone } from '@/app/[market]/develop/components/preview/design-kit-wizard/designKitEvents'
import { useWizardStore } from '@/stores/useWizardStore'
import { handleBuildPhaseNotification } from '../buildPhaseNotification'

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/app/[market]/develop/components/preview/design-kit-wizard/designKitEvents', () => ({
  fireDesignKitMilestone: vi.fn(),
  DESIGN_KIT_MILESTONE: {
    started: 'design_kit_started',
    vibeSelected: 'design_kit_vibe_selected',
    brandStarted: 'design_kit_brand_started',
    websiteStarted: 'design_kit_website_started',
    ready: 'design_kit_ready',
  },
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
  vi.mocked(fireDesignKitMilestone).mockClear()
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

  describe('funnel milestones', () => {
    it('fires the phase milestone with from_phase on brand/website/ready transitions', () => {
      notify('brand')
      expect(fireDesignKitMilestone).toHaveBeenLastCalledWith('design_kit_brand_started', { from_phase: 'gathering' })

      notify('website')
      expect(fireDesignKitMilestone).toHaveBeenLastCalledWith('design_kit_website_started', { from_phase: 'brand' })

      notify('ready')
      expect(fireDesignKitMilestone).toHaveBeenLastCalledWith('design_kit_ready', { from_phase: 'website' })
      expect(fireDesignKitMilestone).toHaveBeenCalledTimes(3)
    })

    it('does not fire a milestone for the gathering phase', () => {
      notify('gathering')
      expect(fireDesignKitMilestone).not.toHaveBeenCalled()
    })

    it('does not fire a milestone when the phase is unchanged', () => {
      notify('brand')
      vi.mocked(fireDesignKitMilestone).mockClear()
      notify('brand')
      expect(fireDesignKitMilestone).not.toHaveBeenCalled()
    })

    it('does not fire a milestone for an ignored cross-app event', () => {
      notify('brand', 'other')
      expect(fireDesignKitMilestone).not.toHaveBeenCalled()
    })

    it('does not fire design_kit_ready when the first observed phase is already ready (resume)', () => {
      notify('ready')
      expect(fireDesignKitMilestone).not.toHaveBeenCalled()
    })

    it('fires design_kit_ready only on a live transition into ready', () => {
      notify('website')
      vi.mocked(fireDesignKitMilestone).mockClear()
      notify('ready')
      expect(fireDesignKitMilestone).toHaveBeenCalledExactlyOnceWith('design_kit_ready', { from_phase: 'website' })
    })
  })
})
