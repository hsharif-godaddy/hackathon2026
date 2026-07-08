'use client'

import { useEffect, useRef } from 'react'

import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { COHORT_ON, EXPERIMENT_IDS } from '@/config/experiments'
import { SWITCHBOARD_APPBUILDER_COMMANDER } from '@/config/switchboard-flags'
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
 * A local dev descriptor override (`?builderLayout=` / localStorage, dev builds only) takes
 * highest precedence. Otherwise the server owns immersive-vs-base: use the server-resolved
 * descriptor — the live `builder_layout` SSE event, else the App-record value from
 * `GET /apps/:id` — mapped by `descriptorToClientLayout` onto the concrete shell over `base`.
 * Until the descriptor resolves we hold at `base`; the app-load skeleton covers that brief
 * window, so `base` rarely paints.
 */
export function useBuilderLayout(layoutProp?: BuilderLayout): BuilderLayout {
  const appId = useAppIdFromParams()
  const commanderDevOverride = useSwitchboard(SWITCHBOARD_APPBUILDER_COMMANDER) === true
  const { cohort: commanderCohort } = useHivemind(EXPERIMENT_IDS.commanderUI)
  const inRolloutCohort = commanderCohort === COHORT_ON
  const commanderEnabled = commanderDevOverride || inRolloutCohort
  const liveServerLayout = useWizardStore((state) => (appId ? state.builderLayoutByApp[appId] : undefined))
  const appRecordLayout = useDevelopPageStore((state) =>
    state.app?.id === appId ? state.app?.builderLayout : undefined,
  )

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

  const serverLayout = liveServerLayout ?? appRecordLayout
  return serverLayout ? descriptorToClientLayout(serverLayout, base) : base
}
