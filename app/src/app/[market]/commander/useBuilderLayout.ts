'use client'

import { useEffect, useRef } from 'react'

import { useIsDesignKitWizardProfile } from '@/app/[market]/develop/components/preview/design-kit-wizard/isDesignKitWizardProfile'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { COHORT_ON, EXPERIMENT_IDS } from '@/config/experiments'
import { SWITCHBOARD_APPBUILDER_COMMANDER, SWITCHBOARD_APPBUILDER_SERVER_DRIVEN_LAYOUT } from '@/config/switchboard-flags'
import { useBrandData } from '@/hooks/useBrandData'
import { useHivemind } from '@/hooks/useHivemind'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { shipAnalyticsLog } from '@/lib/logging'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useWizardStore } from '@/stores/useWizardStore'
import { logImpressionEvent } from '@/utils/instrumentation'
import { readBuilderLayoutDevOverride } from './builderLayoutDevOverride'
import { descriptorToClientLayout } from './descriptorToClientLayout'
import { BuilderLayout } from './types'

/**
 * The single source of truth for which `BuilderLayout` a session renders in.
 *
 * The `base` (non-immersive) shell is `layoutProp ?? (commanderEnabled ? Commander : Develop)`,
 * where `commanderEnabled` is true when EITHER the `appbuilder-commander` Switchboard flag is
 * set (dev/QA override) OR the user is in the `on` cohort of the `airo-builder-commander-UI`
 * Hivemind experiment (real-customer rollout). This mirrors the `appbuilder-agent-profile` ↔
 * `airo-build-initial-agent` two-knob precedent (see app/CLAUDE.md).
 *
 * On top of that base, two fully separate authorities decide immersive-vs-base, gated by
 * `appbuilder-server-driven-layout`:
 *
 * - Flag ON: the server owns the layout. Use the server-resolved layout — the live
 *   `builder_layout` SSE event, else the App-record value from `GET /apps/:id` — mapped by
 *   `descriptorToClientLayout` onto the concrete shell over `base`. Until the server layout
 *   resolves we return `base` and NEVER infer from the wizard phase: phase inference is the
 *   legacy authority and must not compete with the server. The app-load skeleton covers the
 *   brief pre-resolution window, so `base` rarely paints.
 *
 * - Flag OFF: the pre-server-driven behavior verbatim — infer immersive from the design-kit
 *   wizard phase (live store + persisted brand-data, with an `initialBuildComplete` fallback on
 *   a brand-data error), else `base`. Asserted byte-identical to main by the flag-OFF suite.
 *
 * A local dev descriptor override (`?builderLayout=` / localStorage, dev builds only) beats both.
 */
export function useBuilderLayout(layoutProp?: BuilderLayout): BuilderLayout {
  const appId = useAppIdFromParams()
  const commanderDevOverride = useSwitchboard(SWITCHBOARD_APPBUILDER_COMMANDER) === true
  const { cohort: commanderCohort } = useHivemind(EXPERIMENT_IDS.commanderUI)
  const inRolloutCohort = commanderCohort === COHORT_ON
  const commanderEnabled = commanderDevOverride || inRolloutCohort
  const serverDrivenEnabled = useSwitchboard(SWITCHBOARD_APPBUILDER_SERVER_DRIVEN_LAYOUT)
  const immersiveEligible = useIsDesignKitWizardProfile()
  const wizardPhase = useWizardStore((state) => (appId ? state.phaseByApp[appId] : undefined))
  const setPhase = useWizardStore((state) => state.setPhase)
  const liveServerLayout = useWizardStore((state) => (appId ? state.builderLayoutByApp[appId] : undefined))
  const appRecordLayout = useDevelopPageStore((state) =>
    state.app?.id === appId ? state.app?.builderLayout : undefined,
  )
  const initialBuildComplete = useDevelopPageStore((state) =>
    state.app?.id === appId ? (state.app?.initialBuildComplete ?? false) : false,
  )
  const { data: brandData, error: brandError } = useBrandData(appId, { enabled: immersiveEligible })
  const persistedPhase = brandData?.wizard?.phase

  // Seed the live store from the persisted phase once, so the flag-OFF layout stays stable
  // across load-time remounts. Guarded on `undefined` so it never clobbers a live SSE phase.
  useEffect(() => {
    if (appId && persistedPhase && useWizardStore.getState().phaseByApp[appId] === undefined) {
      setPhase(appId, persistedPhase)
    }
  }, [appId, persistedPhase, setPhase])

  // Real customers reach Commander via /develop/[id], so the triggered log can only fire client-side; both `on` and `off` are the metric denominator. The CSP impression mirrors the ES log so FullStory can segment sessions by cohort.
  const triggeredLogAppRef = useRef<string | null>(null)
  useEffect(() => {
    if (!appId) return
    if (triggeredLogAppRef.current === appId) return
    if (commanderCohort !== 'on' && commanderCohort !== 'off') return
    triggeredLogAppRef.current = appId
    shipAnalyticsLog('hivemind.experiment.triggered', {
      experimentId: EXPERIMENT_IDS.commanderUI,
      cohortId: commanderCohort,
      appId,
    })
    logImpressionEvent('commander.experiment.exposure', {
      cohort: commanderCohort,
      appId,
    })()
  }, [appId, commanderCohort])

  const base = layoutProp ?? (commanderEnabled ? BuilderLayout.Commander : BuilderLayout.Develop)
  const devOverride = readBuilderLayoutDevOverride()

  if (devOverride) {
    return descriptorToClientLayout(devOverride, base)
  }

  // Flag ON: server is the sole authority. Map its layout onto the shell when resolved,
  // otherwise hold at `base` — never fall through to phase inference (the legacy authority).
  if (serverDrivenEnabled) {
    const serverLayout = liveServerLayout ?? appRecordLayout
    return serverLayout ? descriptorToClientLayout(serverLayout, base) : base
  }

  // Flag OFF: legacy phase inference, byte-identical to main.
  // A brand-data error leaves `persistedPhase` undefined; fall back to the App record so a
  // known-built app still hands off instead of being routed back into the takeover.
  const buildFinished =
    wizardPhase === 'ready' ||
    persistedPhase === 'ready' ||
    (brandError !== null && initialBuildComplete)

  if (appId && immersiveEligible && !buildFinished) {
    return BuilderLayout.Immersive
  }
  return base
}
