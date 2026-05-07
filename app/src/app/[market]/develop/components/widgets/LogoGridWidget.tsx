'use client'

import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { dynamicApiConfigService } from '@/config/dynamic-api'
import { useTranslations } from '@/hooks/useTranslations'
import { regenerateToken } from '@/lib/jwt-regeneration'
import { logger } from '@/lib/request-context'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'
import { postMessageToIframe } from '@/utils/postMessage'
import { getLogoDisplayUrl, getLogoSlotName, getLogoSlotNames, type LogoData } from './logo-utils'

export { getLogoDisplayUrl, getLogoSlotName, getLogoSlotNames, type LogoData } from './logo-utils'

/**
 * Logo Grid Widget Props
 */
export interface LogoGridWidgetProps {
  logos: LogoData[]
  className?: string
}

/**
 * Logo Grid Widget
 *
 * Displays generated logos stacked vertically at full chat width.
 * Clicking a logo selects it and automatically saves it to the media slot.
 */
export default function LogoGridWidget({ logos, className = '' }: LogoGridWidgetProps) {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [isSwapping, setIsSwapping] = useState(false)
  const [swapError, setSwapError] = useState<string | null>(null)
  const isStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()
  const isProcessing = isStreaming || isLoading
  const appId = useAppIdFromParams()
  const autoSelectedLogoIdRef = useRef<string | null>(null)

  useEffect(function invalidateManifestOnMount() {
    if (!appId) return
    const timer = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['mediaManifest', appId] })
    }, 1000)
    return () => clearTimeout(timer)
  }, [appId, queryClient])

  /**
   * Swap the logo slot's currentUrl via the agents PUT API.
   */
  const swapSlot = useCallback(async (newUrl: string, slotName: string): Promise<boolean> => {
    if (!appId) return false

    setIsSwapping(true)
    try {
      const tokenResult = await regenerateToken({ siteId: appId, force: true })
      const apiConfig = await dynamicApiConfigService.getConfigForSite(appId)
      if (!apiConfig.agentUrl) throw new Error('Agent URL not available')

      const response = await fetch(
        `${apiConfig.agentUrl}/media/${appId}/slots/${slotName}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${tokenResult.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ newUrl }),
        }
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(errorData.error || `Failed to swap slot: ${response.status}`)
      }

      logger.info('logo_grid.slot.swapped', { appId, slotName, newUrl })

      queryClient.invalidateQueries({ queryKey: ['mediaManifest', appId] })

      const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
      if (iframe) {
        postMessageToIframe(iframe, { type: 'RELOAD_MEDIA_SLOT', slotPath: slotName })
      }

      return true
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      logger.error('logo_grid.slot.swap_failed', { appId, error: message })
      setSwapError(message)
      return false
    } finally {
      setIsSwapping(false)
    }
  }, [appId, queryClient])

  /**
   * Handle click on logo — select and auto-save to slot
   */
  const handleLogoClick = useCallback(async (logo: LogoData, index: number) => {
    if (isSwapping || isProcessing) return

    setSelectedIndex(index)
    setSwapError(null)

    const event = new CustomEvent('logo-select', { detail: logo })
    window.dispatchEvent(event)

    logger.debug('logo_grid.logo.selected', {
      logoId: logo.id,
      logoStyle: logo.logoFeatures?.logoStyle,
    })

    // Auto-save: swap slot immediately on click
    const slotsToSwap: Array<{ url: string; slotName: string }> = []
    if (logo.transparentUrl) {
      slotsToSwap.push({ url: logo.transparentUrl, slotName: 'logo/primary' })
    }
    if (logo.horizontalTransparentUrl) {
      slotsToSwap.push({ url: logo.horizontalTransparentUrl, slotName: 'logo/horizontal' })
    }
    if (logo.verticalTransparentUrl) {
      slotsToSwap.push({ url: logo.verticalTransparentUrl, slotName: 'logo/vertical' })
    }

    if (slotsToSwap.length === 0) {
      const fallbackUrl = getLogoDisplayUrl(logo)
      if (!fallbackUrl) {
        setSwapError(t('builder_common_error_generic'))
        return
      }
      slotsToSwap.push({ url: fallbackUrl, slotName: getLogoSlotName(logo) })
    }

    for (const { url, slotName } of slotsToSwap) {
      const ok = await swapSlot(url, slotName)
      if (!ok) break
    }
  }, [isSwapping, isProcessing, swapSlot, t])

  useEffect(function autoSelectSingleLogo() {
    if (logos.length !== 1) return
    const logo = logos[0]!
    const currentId = logo.id ?? null
    if (autoSelectedLogoIdRef.current === currentId) return
    if (isSwapping || isProcessing) return
    autoSelectedLogoIdRef.current = currentId
    handleLogoClick(logo, 0)
  }, [logos, handleLogoClick, isSwapping, isProcessing])

  if (!logos || logos.length === 0) {
    return null
  }

  return (
    <div className={className}>
      {/* Logos stacked vertically at full width */}
      <div className="flex flex-col gap-2">
        {logos.map((logo, index) => (
          <button
            key={logo.id || index}
            onClick={() => handleLogoClick(logo, index)}
            disabled={isSwapping || isProcessing}
            className={clsx(
              "w-full group cursor-pointer overflow-hidden rounded-md border-2 transition-all duration-200 hover:shadow-md bg-intents-ux-boxLowContrast-backgroundColor",
              selectedIndex === index
                ? "border-intents-ux-boxHighContrast-borderColor shadow-md"
                : "border-border hover:border-intents-ux-boxHighContrast-borderColor",
              isSwapping && "opacity-60 pointer-events-none"
            )}
            title={logo.logoFeatures?.logoStyle ? `${logo.logoFeatures.logoStyle} Style` : `Logo ${index + 1}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getLogoDisplayUrl(logo)}
              alt={`Logo ${index + 1}`}
            />
          </button>
        ))}
      </div>

      {swapError && (
        <p className="text-xs text-red-600 mt-1">{swapError}</p>
      )}
    </div>
  )
}
