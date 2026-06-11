/**
 * Shared handling for `logo` generation events pushed from the backend.
 *
 * Used by BOTH transports' client handlers (WS `LogoHandler`, SSE path) so a
 * logo-generation result produces the same customer-visible outcome — a
 * per-app store update (so the chat card swaps in place), a `RELOAD_MEDIA_SLOT`
 * postMessage per affected slot (so the preview swaps shimmer→logo / reverts),
 * AND a Growl toast — regardless of transport. WS is the reference behavior;
 * keep this in lockstep with it.
 */

import Growl from '@ux/growl'

import { type LogoSessionLogo,mapLogoSessionToLogoData } from '@/app/[market]/develop/components/widgets/logo-utils'
import { getQueryClient } from '@/components/providers/QueryClientProvider'
import { logger } from '@/lib/request-context'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { postMessageToIframe } from '@/utils/postMessage'

export interface LogoEventData {
  status: string
  appId?: string
  jobId?: string
  slots?: string[]
  error?: string
  slotSaveFailed?: boolean
  /** Layout names whose slots were not updated. The wire payload sends `LogoLayout[]`
   *  from the agent; over the JSON boundary these arrive as layout-name strings. */
  failedLayouts?: string[]
  logo?: unknown
  suppressGrowl?: boolean
}

function isLogoEventData(raw: unknown): raw is LogoEventData {
  return !!raw && typeof (raw as { status?: unknown }).status === 'string'
}

export interface HandleLogoNotificationParams {
  raw: Record<string, unknown>
  clientAppId: string | null
  t: (id: string, values?: Record<string, unknown>) => string
  logPrefix: string
}

export function handleLogoNotification(params: HandleLogoNotificationParams): void {
  const { raw, clientAppId, t, logPrefix } = params

  if (!isLogoEventData(raw)) {
    logger.warn(`${logPrefix}.invalid-payload`, { appId: clientAppId, received: typeof (raw as Record<string, unknown>)?.status })
    return
  }

  const { status, appId: payloadAppId, jobId, slots, error, slotSaveFailed, failedLayouts } = raw

  if (payloadAppId && clientAppId && payloadAppId !== clientAppId) {
    logger.debug(`${logPrefix}.ignored`, { clientAppId, payloadAppId, reason: 'appId mismatch' })
    return
  }
  const targetAppId = clientAppId ?? payloadAppId
  if (!targetAppId) {
    logger.debug(`${logPrefix}.ignored`, { reason: 'no appId' })
    return
  }

  logger.info(`${logPrefix}.received`, { appId: targetAppId, status, jobId })

  try {
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      const eventLogo = raw.logo as LogoSessionLogo | undefined
      useDevelopPageStore.getState().setLogoJobResult(targetAppId, {
        jobId: jobId ?? '', status, slots: slots ?? [], ...(error ? { error } : {}),
        ...(eventLogo ? { logo: eventLogo } : {}),
        ...(slotSaveFailed ? { slotSaveFailed: true, failedLayouts: failedLayouts ?? [] } : {}),
      })

      // Invalidate the media manifest query so Brand Book + media surfaces refetch
      // the new slot state (clears pendingJobId / shows the real logo) without a tab nav.
      const qc = getQueryClient()
      if (qc) {
        void qc.invalidateQueries({ queryKey: ['mediaManifest', targetAppId] })
      }
    }

    if (Array.isArray(slots) && slots.length > 0 && typeof document !== 'undefined') {
      const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement | null
      if (iframe) {
        for (const slotPath of slots) {
          postMessageToIframe(iframe, { type: 'RELOAD_MEDIA_SLOT', slotPath })
          logger.debug(`${logPrefix}.preview_reload`, { appId: targetAppId, slotPath })
        }
      }
    }

    if (status === 'completed') {
      // Mirror the synchronous flow (toolSideEffects): preview the new logo in the
      // Brand Book immediately via the 'logo-generated' window event (sets its
      // previewLogoUrl), rather than relying solely on the manifest refetch above.
      const completedLogo = raw.logo as LogoSessionLogo | undefined
      if (completedLogo && typeof window !== 'undefined') {
        try {
          window.dispatchEvent(
            new CustomEvent('logo-generated', { detail: mapLogoSessionToLogoData(completedLogo) }),
          )
        } catch (e) {
          logger.warn(`${logPrefix}.logo_event_failed`, {
            appId: targetAppId, error: e instanceof Error ? e.message : String(e),
          })
        }
      }

      if (slotSaveFailed) {
        // suppressGrowl (synchronous background:false runs) → the agent presents the
        // partial-save outcome inline, so skip the redundant toast.
        if (!raw.suppressGrowl) {
          const layouts: string[] = failedLayouts ?? []
          Growl.addGrowlMessage({
            id: `logo-warning-${jobId}`,
            title: t('builder_logo_partial_title') || 'Logo partially applied',
            children:
              t('builder_logo_partial_description', { layouts: layouts.join(', ') }) ||
              'Some logo layouts could not be applied.',
            emphasis: 'warning', lifetime: 8000,
          })
        }
        logger.info(`${logPrefix}.completed_partial`, { appId: targetAppId, jobId, failedLayouts: failedLayouts ?? [] })
      } else {
        if (!raw.suppressGrowl) {
          Growl.addGrowlMessage({
            id: `logo-success-${jobId}`,
            title: t('builder_logo_ready_title') || 'Logo ready',
            children: t('builder_logo_ready_description') || 'Your logo has been generated.',
            emphasis: 'success', lifetime: 5000,
          })
        }
        logger.info(`${logPrefix}.completed`, { appId: targetAppId, jobId })
      }
    } else if (status === 'failed') {
      if (!raw.suppressGrowl) {
        Growl.addGrowlMessage({
          id: `logo-failure-${jobId}`,
          title: t('builder_logo_failed_title') || 'Logo generation failed',
          children: t('builder_logo_failed_default_error') || 'Your logo could not be generated. Ask me to try again.',
          emphasis: 'critical', lifetime: 8000,
        })
      }
      logger.error(`${logPrefix}.failed`, { appId: targetAppId, jobId, error: error || 'Unknown error' })
    } else if (status === 'cancelled') {
      logger.info(`${logPrefix}.cancelled`, { appId: targetAppId, jobId })
    } else {
      logger.warn(`${logPrefix}.unhandled_status`, { appId: targetAppId, jobId, status })
    }
  } catch (err) {
    logger.warn(`${logPrefix}.notification_failed`, {
      appId: targetAppId, status, error: err instanceof Error ? err.message : String(err),
    })
  }
}
