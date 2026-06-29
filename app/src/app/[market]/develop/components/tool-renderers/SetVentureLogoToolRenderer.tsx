'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import { getParentOrigin } from '@/components/security/allowed-frame-ancestors'
import { useIsEmbedded } from '@/hooks/useIsEmbedded'
import { markFeedbackRevealMilestone } from '@/lib/initial-build-reveal-storage'
import { logger } from '@/lib/request-context'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { fetchAsDataUrl } from '@/utils/image'
import { logImpressionEvent } from '@/utils/instrumentation'

interface VentureLogoUrls {
  horizontalUrl: string
  squareUrl: string
}

function readUrls(result: unknown): VentureLogoUrls | undefined {
  if (!result || typeof result !== 'object') return undefined
  const sc = (result as { structuredContent?: unknown }).structuredContent
  if (!sc || typeof sc !== 'object') return undefined
  const { horizontalUrl, squareUrl } = sc as Record<string, unknown>
  if (typeof horizontalUrl !== 'string' || horizontalUrl.length === 0) return undefined
  if (typeof squareUrl !== 'string' || squareUrl.length === 0) return undefined
  return { horizontalUrl, squareUrl }
}

// TODO(i18n): swap these inline strings for `t(...)` calls once the keys
// builder_logo_setting_to_venture, builder_logo_set_to_venture, and
// builder_logo_set_to_venture_failed are published at
// https://i18n.int.gdcorp.tools/org/airo-app-builder/app/aab.
export default function SetVentureLogoToolRenderer({
  toolStatus,
  result,
}: DefaultToolRendererProps) {
  const isEmbedded = useIsEmbedded()
  const appId = useDevelopPageStore((state) => state.currentAppId)
  const firedRef = useRef(false)
  const [phase, setPhase] = useState<'sending' | 'done' | 'error'>('sending')

  // Memoize so the effect dependency is stable across renders. Without this,
  // `readUrls(result)` returns a fresh object every render and the effect
  // reruns each time — `firedRef` short-circuits today, but a future edit
  // above the guard would silently re-fire.
  const urls = useMemo(
    () => (toolStatus === 'completed' ? readUrls(result) : undefined),
    [toolStatus, result]
  )
  const parentOrigin = isEmbedded ? getParentOrigin() : null
  const shouldRender = !!(urls && parentOrigin)

  useEffect(() => {
    if (!shouldRender || firedRef.current || !urls || !parentOrigin) return
    firedRef.current = true

    // This action is an explicit downstream logo-application success signal.
    if (appId) markFeedbackRevealMilestone(appId, 'logoDownstreamApply')
    logImpressionEvent('develop.brand.logo_set_to_venture', { flow: 'logo-designer' })()

    void (async () => {
      const targets: Array<{ key: 'horizontal' | 'square'; url: string }> = [
        { key: 'square', url: urls.squareUrl },
        { key: 'horizontal', url: urls.horizontalUrl },
      ]

      const data = await Promise.all(
        targets.map(async ({ key, url }) => {
          try {
            const dataUrl = await fetchAsDataUrl(url)
            return { key, dataUrl }
          } catch (err) {
            logger.warn('setVentureLogo.fetchFailed', { variant: key, url, error: err })
            return null
          }
        })
      )

      if (data.filter(Boolean).length === 0) {
        setPhase('error')
        return
      }

      try {
        window.parent.postMessage(
          { action: 'add-to-library', sender: 'airo-hq', data },
          parentOrigin
        )
        setPhase('done')
      } catch (err) {
        logger.warn('setVentureLogo.postMessageFailed', { error: err })
        setPhase('error')
      }
    })()
  }, [shouldRender, urls, parentOrigin, appId])

  if (!shouldRender) return null

  return (
    <div className="my-2">
      <p className="text-sm text-intents-ux-textSubtle-textColor">
        {phase === 'sending' && 'Setting your logo on your dashboard…'}
        {phase === 'done' && 'Logo saved to your dashboard.'}
        {phase === 'error' && "We couldn't sync your logo to your dashboard. Please try again."}
      </p>
    </div>
  )
}
