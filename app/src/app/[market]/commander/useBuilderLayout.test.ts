/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DESIGN_KIT_BUILD_CANVAS_ID } from '@airo/shared'
import { renderHook } from '@testing-library/react'

import { DESIGN_KIT_WIZARD_PROFILE } from '@/app/[market]/develop/components/preview/design-kit-wizard/isDesignKitWizardProfile'
import type { App } from '@/services/AppService'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useWizardStore, type WizardPhase } from '@/stores/useWizardStore'
import { BuilderLayout } from './types'
import { useBuilderLayout } from './useBuilderLayout'

const APP_ID = 'app-123'
const OTHER_APP_ID = 'app-456'

let mockAppId: string | undefined
let mockCommanderEnabled: boolean | undefined
let mockServerDrivenEnabled: boolean | undefined
let mockAgentProfile: string | null | undefined
let mockPersistedPhase: WizardPhase | undefined
let mockBrandError: Error | null
let mockCommanderCohort: string | undefined
const shipAnalyticsLogMock = vi.fn()
const logImpressionEventMock = vi.fn()

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: () => mockAppId,
}))

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (flag: string) =>
    flag === 'appbuilder-server-driven-layout' ? mockServerDrivenEnabled : mockCommanderEnabled,
  getSwitchboardValue: () => mockAgentProfile,
}))

vi.mock('@/hooks/useHivemind', () => ({
  useHivemind: () => ({
    cohort: mockCommanderCohort,
    data: undefined,
    experiment: undefined,
  }),
}))

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: (event: string, data: Record<string, unknown>) => shipAnalyticsLogMock(event, data),
}))

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: (eid: string, props: Record<string, unknown>) => () => logImpressionEventMock(eid, props),
}))

// The persisted phase (brand-data) is what lets a finished app hand off to the builder
// even before the live wizard store hydrates — the crux of the reload/mobile case.
vi.mock('@/hooks/useBrandData', () => ({
  useBrandData: () => ({
    data: mockPersistedPhase ? { wizard: { phase: mockPersistedPhase } } : null,
    error: mockBrandError,
  }),
}))

function setLiveWizardPhase(phase: WizardPhase | undefined): void {
  useWizardStore.setState({ phaseByApp: phase ? { [APP_ID]: phase } : {} })
}

function setServerDescriptor(descriptor: App['builderLayout']): void {
  useDevelopPageStore.setState({
    app: { id: APP_ID, builderLayout: descriptor } as unknown as App,
  })
}

function setAppBuilt(initialBuildComplete: boolean): void {
  useDevelopPageStore.setState({ app: { id: APP_ID, initialBuildComplete } as unknown as App })
}

describe('useBuilderLayout', () => {
  beforeEach(() => {
    mockAppId = APP_ID
    mockCommanderEnabled = false
    mockServerDrivenEnabled = false
    mockAgentProfile = DESIGN_KIT_WIZARD_PROFILE
    mockPersistedPhase = undefined
    mockBrandError = null
    mockCommanderCohort = undefined
    shipAnalyticsLogMock.mockClear()
    logImpressionEventMock.mockClear()
    setLiveWizardPhase(undefined)
    useDevelopPageStore.setState({ app: null })
    useWizardStore.setState({ builderLayoutByApp: {} })
  })

  describe('flag ON — server descriptor is the authority', () => {
    beforeEach(() => {
      mockServerDrivenEnabled = true
    })

    it('renders Immersive from a server immersive descriptor', () => {
      setServerDescriptor({
        version: 1,
        layout: 'immersive',
        pinnedSurface: { canvasId: DESIGN_KIT_BUILD_CANVAS_ID },
      })
      const { result } = renderHook(() => useBuilderLayout())
      expect(result.current).toBe(BuilderLayout.Immersive)
    })

    it('renders the base builder shell from a neutral builder descriptor (commander off → Develop)', () => {
      setServerDescriptor({ version: 1, layout: 'default' })
      const { result } = renderHook(() => useBuilderLayout())
      expect(result.current).toBe(BuilderLayout.Develop)
    })

    it('renders Commander from a neutral builder descriptor when the commander flag is on', () => {
      mockCommanderEnabled = true
      setServerDescriptor({ version: 1, layout: 'default' })
      const { result } = renderHook(() => useBuilderLayout())
      expect(result.current).toBe(BuilderLayout.Commander)
    })

    it('prefers a live SSE descriptor from the wizard store over the App-record descriptor', () => {
      setServerDescriptor({ version: 1, layout: 'default' })
      useWizardStore.setState({
        builderLayoutByApp: {
          [APP_ID]: { version: 1, layout: 'immersive' },
        },
      })
      const { result } = renderHook(() => useBuilderLayout())
      expect(result.current).toBe(BuilderLayout.Immersive)
    })

    it('does NOT infer immersive from the wizard phase (phase is progress only)', () => {
      setLiveWizardPhase('brand')
      setServerDescriptor({ version: 1, layout: 'default' })
      const { result } = renderHook(() => useBuilderLayout())
      expect(result.current).toBe(BuilderLayout.Develop)
    })

    it('holds at base until the server layout resolves — never infers immersive from the phase (flag ON)', () => {
      // Flag ON = server is the sole authority. Until the server layout resolves (no App-record
      // value, no SSE yet) we render `base`, NOT the phase-inferred Immersive: the app-load
      // skeleton covers this window, and phase inference must not compete with the server.
      setLiveWizardPhase('brand')
      useDevelopPageStore.setState({ app: { id: APP_ID } as unknown as App })
      const { result } = renderHook(() => useBuilderLayout())
      expect(result.current).toBe(BuilderLayout.Develop)
    })

    it('falls through to Develop when descriptor absent and not a design-kit session', () => {
      mockAgentProfile = 'default'
      useDevelopPageStore.setState({ app: { id: APP_ID } as unknown as App })
      const { result } = renderHook(() => useBuilderLayout())
      expect(result.current).toBe(BuilderLayout.Develop)
    })
  })

  describe('flag OFF — byte-identical to pre-server-driven main (phase inference)', () => {
    it('is Immersive for an in-progress design-kit session (live phase gathering)', () => {
      setLiveWizardPhase('gathering')
      const { result } = renderHook(() => useBuilderLayout())
      expect(result.current).toBe(BuilderLayout.Immersive)
    })

    it('is Immersive for a fresh design-kit session before any phase is known', () => {
      const { result } = renderHook(() => useBuilderLayout())
      expect(result.current).toBe(BuilderLayout.Immersive)
    })

    it('hands off to Develop when the live wizard phase is ready', () => {
      setLiveWizardPhase('ready')
      const { result } = renderHook(() => useBuilderLayout())
      expect(result.current).toBe(BuilderLayout.Develop)
    })

    it('hands off to Develop on reload of a finished build (persisted phase ready, live store empty)', () => {
      mockPersistedPhase = 'ready'
      setLiveWizardPhase(undefined)
      const { result } = renderHook(() => useBuilderLayout())
      expect(result.current).toBe(BuilderLayout.Develop)
    })

    it('hydrates the persisted phase into the wizard store so the decision is stable across remounts', () => {
      mockPersistedPhase = 'ready'
      setLiveWizardPhase(undefined)
      expect(useWizardStore.getState().phaseByApp[APP_ID]).toBeUndefined()
      renderHook(() => useBuilderLayout())
      expect(useWizardStore.getState().phaseByApp[APP_ID]).toBe('ready')
    })

    it('does not clobber a live (SSE-driven) phase when brand-data reports a different one', () => {
      mockPersistedPhase = 'ready'
      setLiveWizardPhase('website')
      renderHook(() => useBuilderLayout())
      expect(useWizardStore.getState().phaseByApp[APP_ID]).toBe('website')
    })

    it('hands off to the builder when brand-data ERRORS but the App record says the build completed', () => {
      mockPersistedPhase = undefined
      mockBrandError = new Error('brand-data 500')
      setLiveWizardPhase(undefined)
      setAppBuilt(true)
      const { result } = renderHook(() => useBuilderLayout())
      expect(result.current).toBe(BuilderLayout.Develop)
    })

    it('stays Immersive on a brand-data error when the build is NOT complete (still gathering)', () => {
      mockPersistedPhase = undefined
      mockBrandError = new Error('brand-data 500')
      setLiveWizardPhase(undefined)
      setAppBuilt(false)
      const { result } = renderHook(() => useBuilderLayout())
      expect(result.current).toBe(BuilderLayout.Immersive)
    })

    it('hands off to Commander when the commander flag is on and the build is finished', () => {
      mockCommanderEnabled = true
      mockPersistedPhase = 'ready'
      const { result } = renderHook(() => useBuilderLayout())
      expect(result.current).toBe(BuilderLayout.Commander)
    })

    it('is Develop for a non-design-kit session with the commander flag off', () => {
      mockAgentProfile = 'default'
      const { result } = renderHook(() => useBuilderLayout())
      expect(result.current).toBe(BuilderLayout.Develop)
    })

    it('is Commander for a non-design-kit session with the commander flag on', () => {
      mockAgentProfile = 'default'
      mockCommanderEnabled = true
      const { result } = renderHook(() => useBuilderLayout())
      expect(result.current).toBe(BuilderLayout.Commander)
    })

    it('honors an explicit layoutProp over the commander flag (when not immersive)', () => {
      mockAgentProfile = 'default'
      const { result } = renderHook(() => useBuilderLayout(BuilderLayout.Commander))
      expect(result.current).toBe(BuilderLayout.Commander)
    })

    it('the immersive takeover wins over an explicit layoutProp', () => {
      setLiveWizardPhase('gathering')
      const { result } = renderHook(() => useBuilderLayout(BuilderLayout.Develop))
      expect(result.current).toBe(BuilderLayout.Immersive)
    })

    it('is never Immersive without an appId, even for a design-kit profile', () => {
      mockAppId = undefined
      const { result } = renderHook(() => useBuilderLayout())
      expect(result.current).toBe(BuilderLayout.Develop)
    })

    it('ignores a present server descriptor while the flag is OFF', () => {
      setServerDescriptor({ version: 1, layout: 'immersive' })
      setLiveWizardPhase('ready')
      const { result } = renderHook(() => useBuilderLayout())
      expect(result.current).toBe(BuilderLayout.Develop)
    })
  })

  describe('Hivemind commander cohort', () => {
    beforeEach(() => {
      // Anchor these cases to a non-design-kit session so the layout decision is driven by
      // the flag+cohort branch, not the immersive takeover.
      mockAgentProfile = 'default'
    })

    it('is Commander when the cohort is `on` and the switchboard flag is off (real-customer rollout path)', () => {
      mockCommanderCohort = 'on'
      const { result } = renderHook(() => useBuilderLayout())
      expect(result.current).toBe(BuilderLayout.Commander)
    })

    it('is Develop when the cohort is `off` and the switchboard flag is off', () => {
      mockCommanderCohort = 'off'
      const { result } = renderHook(() => useBuilderLayout())
      expect(result.current).toBe(BuilderLayout.Develop)
    })

    it('is Commander when the switchboard flag is on regardless of cohort (dev override wins)', () => {
      mockCommanderEnabled = true
      mockCommanderCohort = 'off'
      const { result } = renderHook(() => useBuilderLayout())
      expect(result.current).toBe(BuilderLayout.Commander)
    })

    it('fires hivemind.experiment.triggered AND the CSP exposure impression exactly once when cohort is `on`', () => {
      mockCommanderCohort = 'on'
      const { rerender } = renderHook(() => useBuilderLayout())
      rerender()
      rerender()
      expect(shipAnalyticsLogMock).toHaveBeenCalledTimes(1)
      expect(shipAnalyticsLogMock).toHaveBeenCalledWith('hivemind.experiment.triggered', {
        experimentId: 'airo-builder-commander-UI',
        cohortId: 'on',
        appId: APP_ID,
      })
      expect(logImpressionEventMock).toHaveBeenCalledTimes(1)
      expect(logImpressionEventMock).toHaveBeenCalledWith('commander.experiment.exposure', {
        cohort: 'on',
        appId: APP_ID,
      })
    })

    it('fires both the ES log and the CSP exposure impression when cohort is `off` (both cohorts are the denominator)', () => {
      mockCommanderCohort = 'off'
      renderHook(() => useBuilderLayout())
      expect(shipAnalyticsLogMock).toHaveBeenCalledTimes(1)
      expect(shipAnalyticsLogMock).toHaveBeenCalledWith('hivemind.experiment.triggered', {
        experimentId: 'airo-builder-commander-UI',
        cohortId: 'off',
        appId: APP_ID,
      })
      expect(logImpressionEventMock).toHaveBeenCalledTimes(1)
      expect(logImpressionEventMock).toHaveBeenCalledWith('commander.experiment.exposure', {
        cohort: 'off',
        appId: APP_ID,
      })
    })

    it('does NOT fire either exposure event for `unassigned` / `ineligible` / `not_bucketed` cohorts', () => {
      for (const excluded of ['unassigned', 'ineligible', 'not_bucketed'] as const) {
        shipAnalyticsLogMock.mockClear()
        logImpressionEventMock.mockClear()
        mockCommanderCohort = excluded
        renderHook(() => useBuilderLayout())
        expect(shipAnalyticsLogMock, `cohort ${excluded}`).not.toHaveBeenCalled()
        expect(logImpressionEventMock, `cohort ${excluded}`).not.toHaveBeenCalled()
      }
    })

    it('does NOT fire either exposure event when there is no cohort assignment (undefined)', () => {
      mockCommanderCohort = undefined
      renderHook(() => useBuilderLayout())
      expect(shipAnalyticsLogMock).not.toHaveBeenCalled()
      expect(logImpressionEventMock).not.toHaveBeenCalled()
    })

    it('does NOT fire either exposure event when only the switchboard flag is on (dev override, no real assignment)', () => {
      mockCommanderEnabled = true
      mockCommanderCohort = undefined
      renderHook(() => useBuilderLayout())
      expect(shipAnalyticsLogMock).not.toHaveBeenCalled()
      expect(logImpressionEventMock).not.toHaveBeenCalled()
    })

    it('re-fires both exposure events when navigating to a different appId', () => {
      mockCommanderCohort = 'on'
      const { rerender } = renderHook(() => useBuilderLayout())
      expect(shipAnalyticsLogMock).toHaveBeenCalledTimes(1)
      expect(logImpressionEventMock).toHaveBeenCalledTimes(1)
      mockAppId = OTHER_APP_ID
      rerender()
      expect(shipAnalyticsLogMock).toHaveBeenCalledTimes(2)
      expect(shipAnalyticsLogMock).toHaveBeenLastCalledWith('hivemind.experiment.triggered', {
        experimentId: 'airo-builder-commander-UI',
        cohortId: 'on',
        appId: OTHER_APP_ID,
      })
      expect(logImpressionEventMock).toHaveBeenCalledTimes(2)
      expect(logImpressionEventMock).toHaveBeenLastCalledWith('commander.experiment.exposure', {
        cohort: 'on',
        appId: OTHER_APP_ID,
      })
    })

    it('is Commander with a single exposure pair when BOTH the flag and cohort `on` are set', () => {
      mockCommanderEnabled = true
      mockCommanderCohort = 'on'
      const { result } = renderHook(() => useBuilderLayout())
      expect(result.current).toBe(BuilderLayout.Commander)
      expect(shipAnalyticsLogMock).toHaveBeenCalledTimes(1)
      expect(logImpressionEventMock).toHaveBeenCalledTimes(1)
    })

    it('fires both exposure events with cohort=off when the flag override forces Commander over an off assignment', () => {
      // The dev override changes the visible layout but does NOT change the real cohort
      // assignment — metrics must still record this user in the `off` denominator.
      mockCommanderEnabled = true
      mockCommanderCohort = 'off'
      renderHook(() => useBuilderLayout())
      expect(shipAnalyticsLogMock).toHaveBeenCalledWith('hivemind.experiment.triggered', {
        experimentId: 'airo-builder-commander-UI',
        cohortId: 'off',
        appId: APP_ID,
      })
      expect(logImpressionEventMock).toHaveBeenCalledWith('commander.experiment.exposure', {
        cohort: 'off',
        appId: APP_ID,
      })
    })

    it('does NOT fire either exposure event for unexpected cohort strings and stays Develop', () => {
      // Defensive: someone renaming `on` in the Hivemind portal to `treatment` would silently
      // land here — we neither fire the exposure events nor activate the rollout branch.
      mockCommanderCohort = 'treatment'
      const { result } = renderHook(() => useBuilderLayout())
      expect(result.current).toBe(BuilderLayout.Develop)
      expect(shipAnalyticsLogMock).not.toHaveBeenCalled()
      expect(logImpressionEventMock).not.toHaveBeenCalled()
    })
  })
})
