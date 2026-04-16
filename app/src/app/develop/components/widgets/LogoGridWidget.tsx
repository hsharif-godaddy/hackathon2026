'use client'

import clsx from 'clsx'
import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Box from '@ux/box'
import Button from '@ux/button'

import { useSendUserMessage } from '@/app/develop/components/chat/ChatContext'
import OptionButton from '@/app/develop/components/tool-renderers/OptionButton'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import { dynamicApiConfigService } from '@/config/dynamic-api'
import { useTranslations } from '@/hooks/useTranslations'
import { regenerateToken } from '@/lib/jwt-regeneration'
import { logger } from '@/lib/request-context'
import type { CustomContext } from '@/services/websocket/ChatMessageBuilder'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'
import { postMessageToIframe } from '@/utils/postMessage'

/**
 * Logo data structure
 */
export interface LogoData {
  id: string
  // V2 URLs
  transparentUrl?: string
  solidUrl?: string
  mockupUrl?: string
  // V1 Extra Urls when not entitled or deprecated
  watermarkedTransparentUrl?: string
  watermarkedSolidUrl?: string
  url?: string
  // Existing optional fields
  logoFeatures?: {
    logoStyle?: string
    businessDescription?: string
    logoColors?: {
      description?: string
      hexValues?: string[]
    }
  }
  foregroundColor?: string
  backgroundColor?: string
  palette?: string[]
}

/**
 * Get the appropriate logo URL based on entitlement and background preference
 */
export function getLogoDisplayUrl(
  logo: LogoData,
): string | undefined {
  return logo.transparentUrl || logo.url || logo.watermarkedTransparentUrl || logo.solidUrl || logo.watermarkedSolidUrl;
}

const LOGO_SLOT_NAME = 'logo/primary';

/** Agent-facing placement directive for `logo_slot_placement` context (version in-repo, not user-visible). */
const LOGO_SLOT_PLACEMENT_INSTRUCTIONS =
  'The user saved their logo in the primary media slot. Update the codebase so that logo appears everywhere it should: use urls.default on light backgrounds (img src, framework Image components, CSS when appropriate) and urls.solidOnDark on dark backgrounds. Add or update header, navigation, footer, favicon, and other branding; replace hardcoded logo image URLs with these slot paths where the live primary logo should show.';

function buildLogoPlacementContext(): CustomContext {
  const slotBase = `/airo-assets/images/${LOGO_SLOT_NAME}`
  return {
    type: 'logo_slot_placement',
    data: {
      event: 'user_saved_logo_selection',
      slotPath: LOGO_SLOT_NAME,
      urls: {
        default: slotBase,
        solidOnDark: `${slotBase}?variant=solid`,
      },
      instructions: LOGO_SLOT_PLACEMENT_INSTRUCTIONS,
    },
    persistence: 'ephemeral',
    source: 'logo-grid-widget',
  }
}

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
 * Displays generated logos in a 2x2 grid with interactive selection.
 * Clicking a logo highlights it. Save swaps the media slot via the API,
 * reloads slot images in the preview, then offers suggested-response style
 * next steps; applying runs a short chat line with `logo_slot_placement` context.
 */
export default function LogoGridWidget({ logos, className = '' }: LogoGridWidgetProps) {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [isSwapping, setIsSwapping] = useState(false)
  const [swapError, setSwapError] = useState<string | null>(null)
  const [postSaveSuggestionsVisible, setPostSaveSuggestionsVisible] = useState(false)
  const sendUserMessage = useSendUserMessage()
  const isStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()
  const isProcessing = isStreaming || isLoading
  const appId = useAppIdFromParams()

  useEffect(function invalidateManifestOnMount() {
    if (!appId) return
    // Small delay to ensure the backend has finished writing the manifest
    const timer = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['mediaManifest', appId] })
    }, 1000)
    return () => clearTimeout(timer)
  }, [appId, queryClient])

  // Listen for logo selection events
  useEffect(() => {
    function handleLogoSelect(event: Event) {
      const customEvent = event as CustomEvent
      const logo = customEvent.detail as LogoData
      const idx = logos.findIndex(l => l.id === logo.id)
      if (idx >= 0) setSelectedIndex(idx)
    }

    window.addEventListener('logo-select', handleLogoSelect)
    return () => {
      window.removeEventListener('logo-select', handleLogoSelect)
    }
  }, [logos])

  /**
   * Swap the logo slot's currentUrl via the agents PUT API.
   * The slot name contains a slash — do NOT encodeURIComponent it,
   * the Express wildcard route /:slotName(*) expects the raw path.
   */
  const swapSlot = useCallback(async (newUrl: string): Promise<boolean> => {
    if (!appId) return false

    setIsSwapping(true)
    setSwapError(null)
    try {
      const tokenResult = await regenerateToken({ siteId: appId, force: true })
      const apiConfig = await dynamicApiConfigService.getConfigForSite(appId)
      if (!apiConfig.agentUrl) throw new Error('Agent URL not available')

      const response = await fetch(
        `${apiConfig.agentUrl}/media/${appId}/slots/${LOGO_SLOT_NAME}`,
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

      logger.info('logo_grid.slot.swapped', { appId, newUrl })

      queryClient.invalidateQueries({ queryKey: ['mediaManifest', appId] })

      const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
      if (iframe) {
        postMessageToIframe(iframe, { type: 'RELOAD_MEDIA_SLOT', slotPath: LOGO_SLOT_NAME })
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

  useEffect(function resetPostSaveWhenLogosChange() {
    setPostSaveSuggestionsVisible(false)
  }, [logos])

  /**
   * Handle click on logo -- only update visual selection, no API call
   */
  function handleLogoClick(logo: LogoData, index: number) {
    if (index === selectedIndex) return

    setSelectedIndex(index)

    const event = new CustomEvent('logo-select', { detail: logo })
    window.dispatchEvent(event)

    logger.debug('logo_grid.logo.selected', {
      logoId: logo.id,
      logoStyle: logo.logoFeatures?.logoStyle,
    })
  }

  /**
   * Swap the slot to the selected logo, then show optional next-step suggestions
   * (same interaction pattern as suggestedResponse tool) when chat is available.
   */
  async function handleSave() {
    setPostSaveSuggestionsVisible(false)
    if (isSwapping || isProcessing) return

    const selectedLogo = logos[selectedIndex]
    const urlToSwap = selectedLogo ? getLogoDisplayUrl(selectedLogo) : undefined
    if (!urlToSwap) {
      setSwapError(t('builder_common_error_generic'))
      return
    }

    setSwapError(null)
    const swapped = await swapSlot(urlToSwap)
    if (!swapped) return

    if (sendUserMessage) {
      setPostSaveSuggestionsVisible(true)
    }
  }

  function handleApplyLogoPlacement() {
    if (isProcessing || !sendUserMessage) return
    sendUserMessage(
      t('builder_logo_grid_next_apply', undefined, 'Apply logo across the site'),
      {
        isActionRequest: true,
        customContext: buildLogoPlacementContext(),
      }
    )
    setPostSaveSuggestionsVisible(false)
  }

  function handleDismissPostSaveSuggestions() {
    setPostSaveSuggestionsVisible(false)
  }

  /**
   * Handle "More options" button click
   */
  function handleMoreOptions() {
    if (isProcessing || !sendUserMessage) return
    sendUserMessage('Generate more logo options', { isActionRequest: true })
  }

  if (!logos || logos.length === 0) {
    return null
  }

  return (
    <div className={className}>
      {/* Logo Grid - 2x2 layout */}
      <div className="grid grid-cols-2 gap-2">
        {logos.slice(0, 4).map((logo, index) => (
          <button
            key={logo.id || index}
            onClick={() => handleLogoClick(logo, index)}
            disabled={isSwapping}
            className={clsx(
              "aspect-square group cursor-pointer overflow-hidden rounded-md border-2 transition-all duration-200 hover:shadow-md bg-intents-ux-boxLowContrast-backgroundColor",
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
              className="w-full h-full object-contain p-2 opacity-90 group-hover:opacity-100 transition-opacity"
            />
          </button>
        ))}
      </div>

      {/* Button Controls */}
      <div className="mt-3 flex items-center gap-1 flex-wrap justify-end pr-0.5">
        <Button
          text={t('builder_common_more_options')}
          design="tertiary"
          size="sm"
          disabled={isProcessing || isSwapping}
          onClick={handleMoreOptions}
        />
        <Button
          text={t('builder_common_save')}
          design="primary"
          size="sm"
          disabled={isProcessing || isSwapping}
          onClick={handleSave}
        />
      </div>

      {swapError && (
        <p className="text-xs text-red-600 mt-1">{swapError}</p>
      )}

      {postSaveSuggestionsVisible && (
        <Box gap="sm" className="mt-3">
          <div className="text-sm leading-relaxed break-words text-intents-ux-text-default-textColor">
            {t('builder_logo_grid_next_question', undefined, 'Logo saved. What would you like to do next?')}
          </div>
          <Box orientation="vertical" gap="sm">
            <OptionButton
              text={t('builder_logo_grid_next_apply', undefined, 'Apply logo across the site')}
              disabled={isProcessing}
              onClick={handleApplyLogoPlacement}
              animationDelay={0}
              isSelectable
            />
            <OptionButton
              text={t('builder_logo_grid_next_skip', undefined, 'Not now')}
              disabled={isProcessing}
              onClick={handleDismissPostSaveSuggestions}
              animationDelay={0.2}
              isSelectable
            />
          </Box>
          <span className="text-xs text-intents-ux-textSubtle-textColor">
            {t('builder_tools_suggested_response')}
          </span>
        </Box>
      )}

      {/* Helper message */}
      <div className="flex items-center gap-1 text-xs text-intents-ux-textSubtle-textColor mt-2">
        <span className="text-sm">Click a logo to preview, then save to use it</span>
      </div>
    </div>
  )
}
