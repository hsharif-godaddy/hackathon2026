import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useConnectionById, useSiteAssociations } from '@/hooks/useSocial'
import { useTranslations } from '@/hooks/useTranslations'
import type { SiteAssociation, SocialConnection } from '@/types/social'
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
  const { onStatusChange, onResultChange } = callbacks
  const t = useTranslations()

  const errorMessages = useMemo<PublishErrorMessages>(() => ({
    platformMismatchFacebook: t('builder_social_error_platform_mismatch_facebook'),
    platformMismatchInstagram: t('builder_social_error_platform_mismatch_instagram'),
    missingPageCredentials: t('builder_social_error_missing_page_credentials'),
    missingInstagramCredentials: t('builder_social_error_missing_instagram_credentials'),
    instagramImageRequired: t('builder_social_error_instagram_image_required'),
    platformNotSupported: t('builder_social_error_platform_not_supported', { platform: pendingPublish?.platform || '' }),
    commonError: t('builder_common_unknown_error')
  }), [t, pendingPublish?.platform])

  const { data: associationsData, isLoading: isLoadingAssociations } = useSiteAssociations(appId, isActiveFlow)
  const [selectedAssociation, setSelectedAssociation] = useState<SiteAssociation | null>(null)

  const isPublishingRef = useRef(false)
  const initiatedPublishIds = useRef<Set<string>>(new Set())

  const { data: connection, isError: isConnectionError, error: connectionError } = useConnectionById(
    selectedAssociation?.socialId || '',
    !!selectedAssociation && isActiveFlow
  )

  const executePublish = useCallback(async (
    publish: PendingPublish,
    association: SiteAssociation,
    conn: SocialConnection
  ) => {
    if (isPublishingRef.current) return
    isPublishingRef.current = true

    onStatusChange(PublishFlowState.Publishing)

    try {
      const result = await publishToPlatform(publish, conn, errorMessages)

      await storePostResult({
        appId,
        associationId: association.id,
        platform: publish.platform,
        state: publish.scheduledAt ? SocialPostState.SCHEDULED : SocialPostState.PUBLISHED,
        message: publish.message,
        imageUrls: publish.imageUrls,
        result,
        scheduledAt: publish.scheduledAt
      })

      onStatusChange(PublishFlowState.Success)
      onResultChange(result)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : errorMessages.commonError

      try {
        await storePostResult({
          appId,
          associationId: association.id,
          platform: publish.platform,
          state: SocialPostState.FAILED,
          message: publish.message,
          imageUrls: publish.imageUrls,
          error: errorMessage
        })
      } catch {
        // Ignore error storing failed post
      }

      onStatusChange(PublishFlowState.Error)
      onResultChange({ error: errorMessage })
    } finally {
      isPublishingRef.current = false
    }
  }, [onStatusChange, errorMessages, appId, onResultChange])

  useEffect(() => {
    if (!isActiveFlow || !pendingPublish) return
    if (initiatedPublishIds.current.has(publishId)) return
    if (isLoadingAssociations) return

    const associations = associationsData?.associations || []
    const match = findMatchingAssociation(associations, pendingPublish.platform)

    if (!match) {
      onStatusChange(PublishFlowState.Error)
      onResultChange({ error: errorMessages.platformNotSupported })
      return
    }

    setSelectedAssociation(match)

    if (isConnectionError && connectionError) {
      const errorMessage = connectionError instanceof Error ? connectionError.message : errorMessages.commonError
      onStatusChange(PublishFlowState.Error)
      onResultChange({ error: errorMessage })
      return
    }

    if (connection) {
      initiatedPublishIds.current.add(publishId)
      executePublish(pendingPublish, match, connection)
    }
  }, [
    isActiveFlow,
    pendingPublish,
    publishId,
    associationsData,
    isLoadingAssociations,
    connection,
    isConnectionError,
    connectionError,
    onStatusChange,
    onResultChange,
    executePublish,
    errorMessages
  ])
}
