import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useConnectionById, useSiteAssociations } from '@/hooks/useSocial'
import { useTranslations } from '@/hooks/useTranslations'
import type { SiteAssociation, SocialConnection } from '@/types/social'
import { type PendingPublish, type PublishFlowCallbacks,PublishFlowState, SocialPostState } from '@/types/social-posts'
import { type PublishErrorMessages,publishToPlatform, storePostResult } from './api'

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
    platformMismatchFacebook: t('builder_social_error_platform_mismatch_facebook', undefined, 'Connection platform mismatch: expected Facebook'),
    platformMismatchInstagram: t('builder_social_error_platform_mismatch_instagram', undefined, 'Connection platform mismatch: expected Instagram'),
    missingPageCredentials: t('builder_social_error_missing_page_credentials', undefined, 'Missing page ID or page token'),
    missingInstagramCredentials: t('builder_social_error_missing_instagram_credentials', undefined, 'Missing Instagram account ID or token'),
    instagramImageRequired: t('builder_social_error_instagram_image_required', undefined, 'Instagram posts require at least one image'),
    platformNotSupported: t('builder_social_error_platform_not_supported', { platform: pendingPublish?.platform || '' }, 'Platform {platform} not supported'),
  }), [t, pendingPublish?.platform])

  const { data: associationsData, isLoading: isLoadingAssociations } = useSiteAssociations(appId)
  const [selectedAssociation, setSelectedAssociation] = useState<SiteAssociation | null>(null)

  const isPublishingRef = useRef(false)
  const initiatedPublishIds = useRef<Set<string>>(new Set())

  const { data: connection, isError: isConnectionError, error: connectionError } = useConnectionById(
    selectedAssociation?.social_id || '',
    !!selectedAssociation
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
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'

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
  }, [appId, onStatusChange, onResultChange, errorMessages])

  useEffect(() => {
    if (!isActiveFlow || !pendingPublish) return
    if (initiatedPublishIds.current.has(publishId)) return
    if (isLoadingAssociations) return

    const associations = associationsData?.associations || []
    const match = findMatchingAssociation(associations, pendingPublish.platform)

    if (!match) {
      onStatusChange(PublishFlowState.Error)
      onResultChange({ error: `No ${pendingPublish.platform} connection found. Please connect first.` })
      return
    }

    setSelectedAssociation(match)

    if (isConnectionError && connectionError) {
      const errorMessage = connectionError instanceof Error ? connectionError.message : 'Failed to fetch connection'
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
    executePublish
  ])
}
