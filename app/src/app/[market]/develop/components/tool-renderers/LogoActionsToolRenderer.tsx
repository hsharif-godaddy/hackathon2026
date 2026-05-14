'use client'

import { useCallback, useEffect, useState } from 'react'
import Button from '@ux/button'

import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import { getParentOrigin } from '@/components/security/allowed-frame-ancestors'
import { useIsEmbedded } from '@/hooks/useIsEmbedded'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { fetchAsDataUrl } from '@/utils/image'
import { logClickEvent } from '@/utils/instrumentation'

export default function LogoActionsToolRenderer({
  toolStatus,
  result,
}: DefaultToolRendererProps) {
  const isEmbedded = useIsEmbedded()
  const t = useTranslations()
  const [busy, setBusy] = useState(false)
  const [sentUrl, setSentUrl] = useState<string | undefined>(undefined)

  const toolImageUrl =
    toolStatus === 'completed' && result && typeof result === 'object'
      ? (result as Record<string, unknown>).structuredContent
        ? ((result as Record<string, unknown>).structuredContent as Record<string, unknown>)
            ?.imageUrl as string | undefined
        : undefined
      : undefined

  // Track the currently selected logo from the grid widget.
  // When the user picks a different logo, the buttons reset.
  const [selectedUrl, setSelectedUrl] = useState<string | undefined>(undefined)

  useEffect(() => {
    function handleLogoSelect(e: Event) {
      const logo = (e as CustomEvent).detail as { transparentUrl?: string } | undefined
      if (logo?.transparentUrl) {
        setSelectedUrl(logo.transparentUrl)
      }
    }
    window.addEventListener('logo-select', handleLogoSelect)
    return () => window.removeEventListener('logo-select', handleLogoSelect)
  }, [])

  const imageUrl = selectedUrl ?? toolImageUrl

  const hasSent = sentUrl !== undefined && sentUrl === imageUrl

  const setAsLogo = useCallback(
    async () => {
      if (!imageUrl) return
      const parentOrigin = getParentOrigin()
      if (!parentOrigin) return
      setBusy(true)
      logClickEvent('develop.brand.logo_set', { flow: 'logo-designer' })()
      const action = 'set-as-logo'
      try {
        const dataUrl = await fetchAsDataUrl(imageUrl)
        window.parent.postMessage({ action, sender: 'airo-hq', imageUrl: dataUrl }, parentOrigin)
      } catch (err) {
        logger.warn('logoActions.setAsLogo.fetchFailed', { error: err })
        const absoluteUrl = new URL(imageUrl, window.location.origin).href
        window.parent.postMessage({ action, sender: 'airo-hq', imageUrl: absoluteUrl }, parentOrigin)
      } finally {
        setBusy(false)
        setSentUrl(imageUrl)
      }
    },
    [imageUrl]
  )

  if (toolStatus !== 'completed' || !imageUrl || !isEmbedded) {
    return null
  }

  return (
    <div className="my-2">
      <div className="flex gap-2">
        <Button
          design="primary"
          size="sm"
          disabled={busy || hasSent}
          onClick={() => { void setAsLogo() }}
        >
          {hasSent ? t('builder_mediaslot_logo_set') : t('builder_mediaslot_set_as_logo')}
        </Button>
      </div>
      <p className="mt-1 text-sm text-intents-ux-textSubtle-textColor">
        {t('builder_mediaslot_logo_actions_desc')}
      </p>
    </div>
  )
}
