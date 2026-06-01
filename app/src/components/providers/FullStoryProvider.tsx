'use client'

import { useEffect, useRef } from 'react'
import { FullStory, init } from '@fullstory/browser'

import { EXPERIMENT_IDS } from '@/config/experiments'
import { useExperimentCohorts } from '@/hooks/useHivemind'
import { isLocalDev } from '@/utils/is-local-dev'

export default function FullStoryProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const initializedRef = useRef(false)
  const cohorts = useExperimentCohorts()

  useEffect(() => {
    if (initializedRef.current) {
      return
    }

    if (isLocalDev()) {
      return
    }

    init({
      orgId: 'YKBRC',
      recordCrossDomainIFrames: true
    })

    document.body.classList.add('fs-unmask-airo-app-builder')

    initializedRef.current = true
  }, [])

  useEffect(() => {
    if (!initializedRef.current) {
      return
    }

    const properties: Record<string, string> = {}

    for (const [key, experimentId] of Object.entries(EXPERIMENT_IDS)) {
      const cohort = cohorts[experimentId]
      if (cohort?.cohortId) {
        properties[`${key}Cohort_str`] = cohort.cohortId
      }
    }

    if (Object.keys(properties).length === 0) {
      return
    }

    try {
      FullStory('setProperties', { type: 'user', properties })
    } catch {
      // FullStory may be blocked by ad-blockers or not fully initialized
    }
  }, [cohorts])

  return <>{children}</>
}
