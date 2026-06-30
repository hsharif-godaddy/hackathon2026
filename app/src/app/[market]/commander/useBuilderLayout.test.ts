/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { DESIGN_KIT_WIZARD_PROFILE } from '@/app/[market]/develop/components/preview/design-kit-wizard/isDesignKitWizardProfile'
import type { App } from '@/services/AppService'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useWizardStore, type WizardPhase } from '@/stores/useWizardStore'
import { BuilderLayout } from './types'
import { useBuilderLayout } from './useBuilderLayout'

const APP_ID = 'app-123'

let mockAppId: string | undefined
let mockCommanderEnabled: boolean | undefined
let mockAgentProfile: string | null | undefined
let mockPersistedPhase: WizardPhase | undefined
let mockBrandError: Error | null

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: () => mockAppId,
}))

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: () => mockCommanderEnabled,
  getSwitchboardValue: () => mockAgentProfile,
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

function setAppBuilt(initialBuildComplete: boolean): void {
  useDevelopPageStore.setState({ app: { id: APP_ID, initialBuildComplete } as unknown as App })
}

describe('useBuilderLayout', () => {
  beforeEach(() => {
    mockAppId = APP_ID
    mockCommanderEnabled = false
    mockAgentProfile = DESIGN_KIT_WIZARD_PROFILE
    mockPersistedPhase = undefined
    mockBrandError = null
    setLiveWizardPhase(undefined)
    useDevelopPageStore.setState({ app: null })
  })

  it('is Immersive for an in-progress design-kit session (live phase gathering)', () => {
    setLiveWizardPhase('gathering')
    const { result } = renderHook(() => useBuilderLayout())
    expect(result.current).toBe(BuilderLayout.Immersive)
  })

  it('is Immersive for a fresh design-kit session before any phase is known', () => {
    // No live phase, no persisted phase yet (brand-data not loaded / a fresh create).
    const { result } = renderHook(() => useBuilderLayout())
    expect(result.current).toBe(BuilderLayout.Immersive)
  })

  it('hands off to Develop when the live wizard phase is ready', () => {
    setLiveWizardPhase('ready')
    const { result } = renderHook(() => useBuilderLayout())
    expect(result.current).toBe(BuilderLayout.Develop)
  })

  it('hands off to Develop on reload of a finished build (persisted phase ready, live store empty)', () => {
    // Reload: the live store is empty, but brand-data reports the finished phase, so the
    // app must NOT re-enter the takeover (the mobile-stuck / desktop-flash regression).
    mockPersistedPhase = 'ready'
    setLiveWizardPhase(undefined)
    const { result } = renderHook(() => useBuilderLayout())
    expect(result.current).toBe(BuilderLayout.Develop)
  })

  it('hydrates the persisted phase into the wizard store so the decision is stable across remounts', () => {
    // The develop subtree remounts during load; persisting the phase to the singleton store
    // means a fresh mount reads `ready` synchronously instead of restarting at Immersive
    // (the reload flicker). Confirms the store gets seeded from brand-data.
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
    // A hard brand-data failure leaves the persisted phase unreadable; falling back to
    // app.initialBuildComplete keeps a finished app out of the takeover (it would otherwise
    // be stuck on mobile, where DesignKitWizard never mounts to retry the fetch).
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
})
