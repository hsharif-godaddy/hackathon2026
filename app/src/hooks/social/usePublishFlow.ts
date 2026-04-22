import { useCallback, useEffect, useMemo, useRef } from 'react'

import { useConnectionById, useSiteAssociations } from '@/hooks/useSocial'
import { useTranslations } from '@/hooks/useTranslations'
import { socialV2Client } from '@/lib/social'
import type { SiteAssociation } from '@/types/social'
import { type PendingPublish, type PublishFlowCallbacks, PublishFlowState, SocialPostState } from '@/types/social-posts'
import { type PublishErrorMessages, publishToPlatform, storePostResult } from './api'

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
      } else if (anySucceeded) {
        // Partial success - at least one succeeded
        onOverallStatusChange(PublishFlowState.Success)
      } else {
        onOverallStatusChange(PublishFlowState.Error)
      }
    } finally {
      isPublishingRef.current = false
    }
  }, [appId, errorMessages, onPlatformStatusChange, onPlatformResultChange, onOverallStatusChange, t])

  useEffect(() => {
    if (!isActiveFlow || !pendingPublish) return
    if (initiatedPublishIds.current.has(publishId)) return
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
    errorMessages,
    t
  ])
}
