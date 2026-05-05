'use client'

import { useCallback, useEffect, useState } from 'react'
import Button from '@ux/button'

import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import { getParentOrigin } from '@/components/security/allowed-frame-ancestors'
import { useIsEmbedded } from '@/hooks/useIsEmbedded'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { fetchAsDataUrl } from '@/utils/image'

type LogoAction = 'add-to-library' | 'set-as-logo'

export default function LogoActionsToolRenderer({
  toolStatus,
  result,
}: DefaultToolRendererProps) {
  const isEmbedded = useIsEmbedded()
  const t = useTranslations()
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<{ url: string | undefined; actions: Set<string> }>({
    url: undefined,
    actions: new Set(),
  })

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

  // "set-as-logo" implies "add-to-library", so treat both as sent
  const hasSent = (action: LogoAction) => {
    if (!sent.url || sent.url !== imageUrl) return false
    if (sent.actions.has(action)) return true
    return action === 'add-to-library' && sent.actions.has('set-as-logo')
  }

  const sendToParent = useCallback(
    async (action: LogoAction) => {
      if (!imageUrl) return
      const parentOrigin = getParentOrigin()
      if (!parentOrigin) return
      setBusy(true)
      try {
        const dataUrl = await fetchAsDataUrl(imageUrl)
        window.parent.postMessage({ action, sender: 'airo-hq', imageUrl: dataUrl }, parentOrigin)
      } catch (err) {
        logger.warn('logoActions.sendToParent.fetchFailed', { error: err })
        const absoluteUrl = new URL(imageUrl, window.location.origin).href
        window.parent.postMessage({ action, sender: 'airo-hq', imageUrl: absoluteUrl }, parentOrigin)
      } finally {
        setBusy(false)
        setSent((prev) => ({
          url: imageUrl,
          actions: prev.url === imageUrl ? new Set(prev.actions).add(action) : new Set([action]),
        }))
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
          design="secondary"
          size="sm"
          disabled={busy || hasSent('add-to-library')}
          onClick={() => { void sendToParent('add-to-library') }}
        >
          {hasSent('add-to-library') ? t('builder_mediaslot_added') : t('builder_mediaslot_add_to_library')}
        </Button>
        <Button
          design="primary"
          size="sm"
          disabled={busy || hasSent('set-as-logo')}
          onClick={() => { void sendToParent('set-as-logo') }}
        >
          {hasSent('set-as-logo') ? t('builder_mediaslot_logo_set') : t('builder_mediaslot_set_as_logo')}
        </Button>
      </div>
      <p className="mt-1 text-sm text-intents-ux-textSubtle-textColor">
        {t('builder_mediaslot_logo_actions_desc')}
      </p>
    </div>
  )
}
