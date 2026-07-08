import { useCallback, useEffect, useMemo, useRef } from 'react'

import { useConnectionById, useSiteAssociations } from '@/hooks/useSocial'
import { useTranslations } from '@/hooks/useTranslations'
import { socialV2Client } from '@/lib/social'
import { type PublishablePlatform } from '@/lib/social-platforms'
import type { SiteAssociation } from '@/types/social'
import { type PendingPublish, type PublishFlowCallbacks, PublishFlowState, type PublishResult, SocialPostState } from '@/types/social-posts'
import { type PublishErrorMessages, publishToPlatform, storePostResult } from './api'

type PlatformSnapshot = {
  status: PublishFlowState
  result?: PublishResult
  error?: string
}

type PublishSnapshot = {
  overallStatus: PublishFlowState
  platformStatuses: Partial<Record<PublishablePlatform, PlatformSnapshot>>
}

const MAX_TRACKED_PUBLISHES: number = 200
const startedPublishIds = new Set<string>()
const terminalSnapshots = new Map<string, PublishSnapshot>()
const snapshotListeners = new Map<string, Set<(snapshot: PublishSnapshot) => void>>()

function trimTrackedPublishes(): void {
  while (startedPublishIds.size > MAX_TRACKED_PUBLISHES) {
    const oldestStarted: string | undefined = startedPublishIds.values().next().value
    if (!oldestStarted) {
      break
    }
    startedPublishIds.delete(oldestStarted)
    terminalSnapshots.delete(oldestStarted)
    snapshotListeners.delete(oldestStarted)
  }

  while (terminalSnapshots.size > MAX_TRACKED_PUBLISHES) {
    const oldestSnapshot: string | undefined = terminalSnapshots.keys().next().value
    if (!oldestSnapshot) {
      break
    }
    terminalSnapshots.delete(oldestSnapshot)
    startedPublishIds.delete(oldestSnapshot)
    snapshotListeners.delete(oldestSnapshot)
  }
}

function markPublishStarted(publishId: string): void {
  startedPublishIds.add(publishId)
  trimTrackedPublishes()
}

function setTerminalSnapshot(publishId: string, snapshot: PublishSnapshot): void {
  terminalSnapshots.set(publishId, snapshot)
  const listeners: Set<(snapshot: PublishSnapshot) => void> | undefined = snapshotListeners.get(publishId)
  listeners?.forEach((listener) => {
    listener(snapshot)
  })
  snapshotListeners.delete(publishId)
  trimTrackedPublishes()
}

function subscribeSnapshot(
  publishId: string,
  listener: (snapshot: PublishSnapshot) => void
): () => void {
  const listeners: Set<(snapshot: PublishSnapshot) => void> = snapshotListeners.get(publishId) ?? new Set()
  listeners.add(listener)
  snapshotListeners.set(publishId, listeners)

  return function unsubscribe(): void {
    const currentListeners: Set<(snapshot: PublishSnapshot) => void> | undefined = snapshotListeners.get(publishId)
    if (!currentListeners) return
    currentListeners.delete(listener)
    if (currentListeners.size === 0) {
      snapshotListeners.delete(publishId)
    }
  }
}

function findMatchingAssociation(
  associations: SiteAssociation[],
  platform: string
): SiteAssociation | null {
  return associations.find(
    (a) => a.platform.toLowerCase() === platform.toLowerCase()
  ) || null
}

export function usePublishFlow(
  appId: string,
  publishId: string,
  pendingPublish: PendingPublish | null,
  isActiveFlow: boolean,
  callbacks: PublishFlowCallbacks
) {
  const { onPlatformStatusChange, onPlatformResultChange, onOverallStatusChange } = callbacks
  const t = useTranslations()

  const errorMessages = useMemo<PublishErrorMessages>(() => ({
    platformMismatchFacebook: t('builder_social_error_platform_mismatch_facebook'),
    platformMismatchInstagram: t('builder_social_error_platform_mismatch_instagram'),
    missingPageCredentials: t('builder_social_error_missing_page_credentials'),
    missingInstagramCredentials: t('builder_social_error_missing_instagram_credentials'),
    instagramSchedulingUnavailable: t('builder_social_instagram_schedule_coming_soon'),
    instagramImageRequired: t('builder_social_error_instagram_image_required'),
    platformNotSupported: t('builder_social_error_platform_not_supported', { platform: '' }),
    commonError: t('builder_common_unknown_error'),
    connectionFetchFailed: t('builder_social_error_connection_fetch_failed', { platform: '' }),
    noPlatformSpecified: t('builder_social_error_no_platform_specified')
  }), [t])

  const { data: associationsData, isLoading: isLoadingAssociations, isError: isAssociationsError } = useSiteAssociations(appId, isActiveFlow)

  const isPublishingRef = useRef(false)
  const initiatedPublishIds = useRef<Set<string>>(new Set())

  // Fetch connections for all platforms
  const platformAssociations = useMemo(() => {
    if (!pendingPublish || !associationsData) return []

    return pendingPublish.platforms.map(platform => {
      const match = findMatchingAssociation(associationsData.associations || [], platform)
      return { platform, association: match }
    }).filter(item => item.association !== null)
  }, [pendingPublish, associationsData])

  // Use first association's connection as a trigger to start (simplified for now)
  const firstAssociation = platformAssociations[0]?.association
  const { data: connection, isError: isConnectionError } = useConnectionById(
    firstAssociation?.socialId || '',
    !!firstAssociation && isActiveFlow
  )

  const executeMultiPlatformPublish = useCallback(async (
    publish: PendingPublish,
    associations: SiteAssociation[]
  ) => {
    if (isPublishingRef.current) return
    isPublishingRef.current = true
    const snapshot: Partial<Record<PublishablePlatform, PlatformSnapshot>> = {}

    try {
      // Start all publishes in parallel
      // RACE CONDITION MITIGATION: While these promises execute in parallel and call
      // state update callbacks concurrently, React's useReducer guarantees sequential
      // processing of dispatched actions through its internal queue. Each dispatch is
      // applied atomically with the most recent state, preventing lost updates.
      // Each platform updates its own key in platformStatuses, further reducing conflicts.
      const publishPromises = publish.platforms.map(async (platform) => {
        try {
          // Update status: Publishing
          onPlatformStatusChange(platform, PublishFlowState.Publishing)

          // Find association for this platform
          const match = findMatchingAssociation(associations, platform)
          if (!match) {
            throw new Error(t('builder_social_error_no_connection_found', { platform }))
          }

          // Fetch connection for this platform
          const conn = await socialV2Client.getConnectionById(match.socialId)

          // Extract platform-specific data (with backwards compatibility)
          const platformData = publish.platformData?.find(p => p.platform === platform)
          const message = platformData?.message ?? publish.message ?? ''
          const imageUrls = platformData?.imageUrls ?? publish.imageUrls ?? []
          const scheduledAt = platformData?.scheduledAt ?? publish.scheduledAt

          // Create single-platform publish object for the API
          const singlePlatformPublish: PendingPublish = {
            ...publish,
            platforms: [platform],
            platformData: [{
              platform,
              message,
              imageUrls,
              scheduledAt
            }],
            message,
            imageUrls,
            scheduledAt
          }

          // Publish to this platform
          const result = await publishToPlatform(singlePlatformPublish, conn, errorMessages)

          // Store result
          await storePostResult({
            appId,
            associationId: match.id,
            platform,
            state: scheduledAt ? SocialPostState.SCHEDULED : SocialPostState.PUBLISHED,
            message,
            imageUrls,
            result,
            scheduledAt
          })

          // Update status and result together in single dispatch to avoid race conditions
          onPlatformStatusChange(platform, PublishFlowState.Success)
          onPlatformResultChange(platform, result)
          snapshot[platform] = { status: PublishFlowState.Success, result }

          return { platform, success: true, result }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : errorMessages.commonError

          // Try to store failure
          try {
            const match = findMatchingAssociation(associations, platform)
            if (match) {
              // Extract platform-specific data (with backwards compatibility)
              const platformData = publish.platformData?.find(p => p.platform === platform)
              const message = platformData?.message ?? publish.message ?? ''
              const imageUrls = platformData?.imageUrls ?? publish.imageUrls ?? []

              await storePostResult({
                appId,
                associationId: match.id,
                platform,
                state: SocialPostState.FAILED,
                message,
                imageUrls,
                error: errorMessage
              })
            }
          } catch {
            // Ignore storage error
          }

          // Update status and error together in single dispatch to avoid race conditions
          onPlatformStatusChange(platform, PublishFlowState.Error)
          onPlatformResultChange(platform, { error: errorMessage })
          snapshot[platform] = { status: PublishFlowState.Error, error: errorMessage }

          return { platform, success: false, error: errorMessage }
        }
      })

      // Wait for all to complete (doesn't throw on individual failures)
      const results = await Promise.allSettled(publishPromises)

      // Determine overall status
      const successfulResults = results.filter(
        r => r.status === 'fulfilled' && r.value.success
      )
      const allSucceeded = successfulResults.length === publish.platforms.length
      const anySucceeded = successfulResults.length > 0

      if (allSucceeded) {
        onOverallStatusChange(PublishFlowState.Success)
        setTerminalSnapshot(publishId, {
          overallStatus: PublishFlowState.Success,
          platformStatuses: snapshot
        })
      } else if (anySucceeded) {
        // Partial success - at least one succeeded
        onOverallStatusChange(PublishFlowState.Success)
        setTerminalSnapshot(publishId, {
          overallStatus: PublishFlowState.Success,
          platformStatuses: snapshot
        })
      } else {
        onOverallStatusChange(PublishFlowState.Error)
        setTerminalSnapshot(publishId, {
          overallStatus: PublishFlowState.Error,
          platformStatuses: snapshot
        })
      }
    } finally {
      isPublishingRef.current = false
    }
  }, [appId, errorMessages, onPlatformStatusChange, onPlatformResultChange, onOverallStatusChange, publishId, t])

  const replaySnapshot = useCallback((snapshot: PublishSnapshot): void => {
    Object.entries(snapshot.platformStatuses).forEach(([platform, platformSnapshot]) => {
      if (!platformSnapshot) return
      onPlatformStatusChange(platform as PublishablePlatform, platformSnapshot.status)
      if (platformSnapshot.result !== undefined) {
        onPlatformResultChange(platform as PublishablePlatform, platformSnapshot.result)
      } else if (platformSnapshot.error) {
        onPlatformResultChange(platform as PublishablePlatform, { error: platformSnapshot.error })
      }
    })
    onOverallStatusChange(snapshot.overallStatus)
  }, [onOverallStatusChange, onPlatformResultChange, onPlatformStatusChange])

  useEffect(() => {
    if (!isActiveFlow || !pendingPublish) return
    if (initiatedPublishIds.current.has(publishId)) return
    const terminalSnapshot = terminalSnapshots.get(publishId)
    if (terminalSnapshot) {
      replaySnapshot(terminalSnapshot)
      initiatedPublishIds.current.add(publishId)
      return
    }
    if (startedPublishIds.has(publishId)) {
      const unsubscribe = subscribeSnapshot(publishId, function onSnapshot(snapshot: PublishSnapshot): void {
        replaySnapshot(snapshot)
        initiatedPublishIds.current.add(publishId)
      })
      return function cleanup(): void {
        unsubscribe()
      }
    }
    if (isLoadingAssociations) return
    if (isAssociationsError) {
      onOverallStatusChange(PublishFlowState.Error)
      pendingPublish.platforms.forEach(platform => {
        onPlatformStatusChange(platform, PublishFlowState.Error)
        onPlatformResultChange(platform, { error: errorMessages.commonError })
      })
      return
    }

    const associations = associationsData?.associations || []

    // Check for missing platforms BEFORE waiting for connection —
    // prevents silent stall when no associations exist
    const missingPlatforms = pendingPublish.platforms.filter(
      platform => !findMatchingAssociation(associations, platform)
    )

    if (missingPlatforms.length > 0) {
      onOverallStatusChange(PublishFlowState.Error)
      missingPlatforms.forEach(platform => {
        onPlatformStatusChange(platform, PublishFlowState.Error)
        onPlatformResultChange(platform, {
          error: t('builder_social_error_no_connection_found', { platform })
        })
      })
      return
    }

    if (isConnectionError) {
      onOverallStatusChange(PublishFlowState.Error)
      pendingPublish.platforms.forEach(platform => {
        onPlatformStatusChange(platform, PublishFlowState.Error)
        onPlatformResultChange(platform, { error: errorMessages.commonError })
      })
      return
    }

    if (!connection) return

    // Start parallel publishing
    markPublishStarted(publishId)
    initiatedPublishIds.current.add(publishId)
    executeMultiPlatformPublish(pendingPublish, associations)
  }, [
    isActiveFlow,
    pendingPublish,
    publishId,
    associationsData,
    isLoadingAssociations,
    isAssociationsError,
    connection,
    isConnectionError,
    executeMultiPlatformPublish,
    onOverallStatusChange,
    onPlatformStatusChange,
    onPlatformResultChange,
    replaySnapshot,
    errorMessages,
    t
  ])
}
