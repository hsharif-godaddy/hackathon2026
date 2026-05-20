'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import StarIcon from '@ux/icon/star'

import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import DefaultToolRenderer from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/[market]/develop/components/tool-renderers/ToolHeader'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import { logger } from '@/lib/request-context'
import { socialV2Client } from '@/lib/social'
import { isGoogleConnection } from '@/lib/utils/social-type-guards'
import type { GoogleReview } from '@/types/social'
import { GOOGLE_REVIEWS_READY } from '@/types/social'

type FetchStatus = 'fetching' | 'done' | 'error'

function GoogleReviewsToolRenderer({
  toolStatus,
  toolId,
  conversationId,
  result,
  isLastAssistantMessage = false,
  ...rest
}: DefaultToolRendererProps) {
  const { sendMessage } = useWebSocketContext()
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>('fetching')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const hasFetchedRef = useRef(false)

  const r = (toolStatus === 'completed' && result && typeof result === 'object')
    ? result as Record<string, unknown>
    : null

  const socialId = r?.socialId as string | undefined

  const fetchAndSendReviews = useCallback(async (id: string) => {
    try {
      const connection = await socialV2Client.getConnectionById(id)
      if (!isGoogleConnection(connection)) {
        throw new Error(`Expected GOOGLE_BUSINESS_PROFILE connection, got ${connection.platform}`)
      }

      const { userTokenId, locationId } = connection
      if (!userTokenId) {
        throw new Error('No user token found for this Google connection')
      }

      const reviews: GoogleReview[] = await socialV2Client.getGoogleReviews(userTokenId, locationId)

      logger.info('google-reviews-renderer.fetched', { socialId: id, count: reviews.length })
      setFetchStatus('done')

      sendMessage({
        content: 'Google reviews are ready',
        isActionRequest: false,
        customContext: {
          type: GOOGLE_REVIEWS_READY,
          data: { reviews },
        }
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch reviews'
      logger.error('google-reviews-renderer.error', { socialId: id, error: msg })
      setErrorMessage(msg)
      setFetchStatus('error')
    }
  }, [sendMessage])

  useEffect(() => {
    if (!isLastAssistantMessage || !socialId || hasFetchedRef.current) return
    hasFetchedRef.current = true
    fetchAndSendReviews(socialId)
  }, [isLastAssistantMessage, socialId, fetchAndSendReviews])

  if (r?.action === 'fetchReviews' && socialId) {
    return (
      <>
        <ToolHeader
          icon={<StarIcon className="w-2 h-2" />}
          displayName="Fetching Google Reviews"
          hasDetails={false}
          toolStatus={toolStatus}
          onOpenModal={undefined}
        />
        {fetchStatus === 'fetching' && (
          <p className="text-sm text-ux-text-secondary px-3 py-2">Loading your Google reviews…</p>
        )}
        {fetchStatus === 'done' && (
          <p className="text-sm text-ux-text-secondary px-3 py-2">Reviews loaded.</p>
        )}
        {fetchStatus === 'error' && (
          <p className="text-sm text-ux-text-danger px-3 py-2">{errorMessage ?? 'Failed to load reviews.'}</p>
        )}
      </>
    )
  }

  return <DefaultToolRenderer toolStatus={toolStatus} toolId={toolId} conversationId={conversationId} result={result} {...rest} />
}

export default memo(GoogleReviewsToolRenderer)
