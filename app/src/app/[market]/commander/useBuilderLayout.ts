'use client'

import { useEffect } from 'react'

import { useIsDesignKitWizardProfile } from '@/app/[market]/develop/components/preview/design-kit-wizard/isDesignKitWizardProfile'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { SWITCHBOARD_APPBUILDER_COMMANDER } from '@/config/switchboard-flags'
import { useBrandData } from '@/hooks/useBrandData'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useWizardStore } from '@/stores/useWizardStore'
import { BuilderLayout } from './types'

/**
 * The single source of truth for which `BuilderLayout` a session renders in — a session is
 * only ever on one. Returns:
 * - `Immersive` for a design-kit session whose build has not finished,
 * - otherwise the explicit `layoutProp` (e.g. the /commander route), falling back to
 *   `Commander` or `Develop` per the `appbuilder-commander` flag.
 *
 * "Finished" is read from the *persisted* wizard phase (`brand-data`) as well as the live
 * wizard store. This hook also **hydrates** the persisted phase into the (singleton) wizard
 * store, so the decision is stable across the load-time remounts (Suspense fallback ↔
 * content); without it, each fresh mount restarts at `Immersive` (per-instance `useBrandData`
 * has no cache) and flickers to the builder once its own fetch lands.
 *
 * If the brand-data fetch *fails* (not just "phase not ready"), the persisted phase is
 * unreadable, so we fall back to the authoritative `app.initialBuildComplete` from the App
 * record — otherwise a hard fetch failure would trap a finished app in the takeover
 * (permanently on mobile, where `DesignKitWizard` never mounts to retry the fetch).
 *
 * Future, non-design-kit immersive entry points are added at `immersiveEligible`.
 */
export function useBuilderLayout(layoutProp?: BuilderLayout): BuilderLayout {
  const appId = useAppIdFromParams()
  const commanderEnabled = useSwitchboard(SWITCHBOARD_APPBUILDER_COMMANDER)
  const immersiveEligible = useIsDesignKitWizardProfile()
  const wizardPhase = useWizardStore((state) => (appId ? state.phaseByApp[appId] : undefined))
  const setPhase = useWizardStore((state) => state.setPhase)
  const initialBuildComplete = useDevelopPageStore((state) =>
    state.app?.id === appId ? (state.app?.initialBuildComplete ?? false) : false,
  )
  const { data: brandData, error: brandError } = useBrandData(appId, { enabled: immersiveEligible })
  const persistedPhase = brandData?.wizard?.phase

  // Seed the live store from the persisted phase once, so the layout stays stable across
  // the load-time remounts. Guarded on `undefined` so it never clobbers a live SSE phase.
  useEffect(() => {
    if (appId && persistedPhase && useWizardStore.getState().phaseByApp[appId] === undefined) {
      setPhase(appId, persistedPhase)
    }
  }, [appId, persistedPhase, setPhase])

  // A brand-data error leaves `persistedPhase` undefined; fall back to the App record so a
  // known-built app still hands off instead of being routed back into the takeover.
  const buildFinished =
    wizardPhase === 'ready' ||
    persistedPhase === 'ready' ||
    (brandError !== null && initialBuildComplete)

  if (appId && immersiveEligible && !buildFinished) {
    return BuilderLayout.Immersive
  }
  return layoutProp ?? (commanderEnabled ? BuilderLayout.Commander : BuilderLayout.Develop)
}
