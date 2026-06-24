'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import LinkIcon from '@ux/icon/link'

import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import DefaultToolRenderer from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/[market]/develop/components/tool-renderers/ToolHeader'
import { useChatContext } from '@/contexts/ChatContext'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { socialV2Client } from '@/lib/social'
import { defaultMessageForGbpSyncKey, type GbpSyncKey } from '@/lib/translations/gbp-sync-defaults'
import { isGoogleConnection } from '@/lib/utils/social-type-guards'
import type { GoogleBusinessProfile } from '@/types/social'
import { GBP_PROFILE_READY, GBP_UPDATE_DONE } from '@/types/social'

type FetchStatus = 'working' | 'done' | 'error'
type GbpAction = 'getGbpProfile' | 'updateGbp'

/**
 * Frontend half of the google-business-profile-sync round-trips. The skill
 * tools (agents/) can't call SocialV2Client directly, so they emit a signal
 * with a socialId; this renderer resolves the connection, calls SocialV2Client
 * with the browser JWT, and posts the result back as a context attachment for
 * the tool's second pass:
 *
 * - getGbpProfile → read the listing → GBP_PROFILE_READY { profile }
 * - updateGbp     → write fields back → GBP_UPDATE_DONE { field, updated, error? }
 */
function GbpSyncToolRenderer({
  toolStatus,
  toolId,
  conversationId,
  result,
  isLastAssistantMessage = false,
  ...rest
}: DefaultToolRendererProps) {
  const { sendMessage } = useChatContext()
  const t = useTranslations()
  const tg = (key: GbpSyncKey): string => t(key, undefined, defaultMessageForGbpSyncKey(key))
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>('working')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const hasRunRef = useRef(false)

  const r = (toolStatus === 'completed' && result && typeof result === 'object')
    ? result as Record<string, unknown>
    : null

  const action = r?.action as GbpAction | undefined
  const socialId = r?.socialId as string | undefined
  const field = r?.field as string | undefined
  // Stabilize identity: the `?? {}` fallback would otherwise mint a new object every
  // render, churning the effect's dep array. `r` is the same reference as `result`
  // (the cast is a no-op), so this recomputes only when the tool result changes.
  const updates = useMemo<Partial<GoogleBusinessProfile>>(() => (r?.updates ?? {}) as Partial<GoogleBusinessProfile>, [r])
  const isGbpAction = action === 'getGbpProfile' || action === 'updateGbp'

  // Values are passed in at fire time rather than closed over from the freshly-derived
  // `r`, so runAction's identity doesn't churn with every render.
  const runAction = useCallback(async (act: GbpAction, id: string, fieldArg: string | undefined, updatesArg: Partial<GoogleBusinessProfile>) => {
    try {
      const connection = await socialV2Client.getConnectionById(id)
      if (!isGoogleConnection(connection)) {
        throw new Error(`Expected GOOGLE_BUSINESS_PROFILE connection, got ${connection.platform}`)
      }

      const { userTokenId, locationId } = connection
      if (!userTokenId) {
        throw new Error('No user token found for this Google connection')
      }
      if (!locationId) {
        throw new Error('Google Business Profile connection is missing a location. Please reconnect your Google Business Profile and select your business location.')
      }

      if (act === 'getGbpProfile') {
        const profile: GoogleBusinessProfile = await socialV2Client.getGoogleBusinessProfile(userTokenId, locationId)
        logger.info('gbp-sync-renderer.profile-read', { socialId: id })
        setFetchStatus('done')
        sendMessage({
          content: 'Google Business Profile listing is ready',
          isActionRequest: false,
          customContext: { type: GBP_PROFILE_READY, data: { profile } },
        })
        return
      }

      // updateGbp
      const { updated } = await socialV2Client.updateGoogleBusinessProfile(userTokenId, locationId, updatesArg)
      logger.info('gbp-sync-renderer.updated', { socialId: id, field: fieldArg, updated })
      setFetchStatus('done')
      sendMessage({
        content: 'Google Business Profile update complete',
        isActionRequest: false,
        customContext: { type: GBP_UPDATE_DONE, data: { field: fieldArg, updated } },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to reach your Google Business Profile'
      logger.error('gbp-sync-renderer.error', { socialId: id, action: act, error: msg })
      setErrorMessage(msg)
      setFetchStatus('error')
      // Surface the failure to the skill's second pass so it can prompt reconnect/retry —
      // both directions must report back, or the agent's pass 2 waits forever for an
      // attachment that never arrives.
      if (act === 'updateGbp') {
        sendMessage({
          content: 'Google Business Profile update failed',
          isActionRequest: false,
          customContext: { type: GBP_UPDATE_DONE, data: { field: fieldArg, updated: [], error: msg } },
        })
      } else {
        sendMessage({
          content: 'Google Business Profile read failed',
          isActionRequest: false,
          customContext: { type: GBP_PROFILE_READY, data: { error: msg } },
        })
      }
    }
  }, [sendMessage])

  useEffect(() => {
    if (!isLastAssistantMessage || !isGbpAction || !socialId || hasRunRef.current) return
    hasRunRef.current = true
    runAction(action as GbpAction, socialId, field, updates)
  }, [isLastAssistantMessage, isGbpAction, action, socialId, field, updates, runAction])

  if (isGbpAction && socialId) {
    const reading = action === 'getGbpProfile'
    return (
      <>
        <ToolHeader
          icon={<LinkIcon className="w-2 h-2" />}
          displayName={tg(reading ? 'builder_gbp_sync_reading_title' : 'builder_gbp_sync_updating_title')}
          hasDetails={false}
          toolStatus={toolStatus}
          onOpenModal={undefined}
        />
        {fetchStatus === 'working' && (
          <p className="text-sm text-ux-text-secondary px-3 py-2">
            {tg(reading ? 'builder_gbp_sync_reading_progress' : 'builder_gbp_sync_updating_progress')}
          </p>
        )}
        {fetchStatus === 'done' && (
          <p className="text-sm text-ux-text-secondary px-3 py-2">
            {tg(reading ? 'builder_gbp_sync_reading_done' : 'builder_gbp_sync_updating_done')}
          </p>
        )}
        {fetchStatus === 'error' && (
          <p className="text-sm text-ux-text-danger px-3 py-2">{errorMessage ?? tg('builder_gbp_sync_error_generic')}</p>
        )}
      </>
    )
  }

  return <DefaultToolRenderer toolStatus={toolStatus} toolId={toolId} conversationId={conversationId} result={result} {...rest} />
}

export default memo(GbpSyncToolRenderer)
