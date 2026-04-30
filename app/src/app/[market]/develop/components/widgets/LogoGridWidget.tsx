'use client'

import clsx from 'clsx'
import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Box from '@ux/box'
import Button from '@ux/button'

import { useSendUserMessage } from '@/app/[market]/develop/components/chat/ChatContext'
import OptionButton from '@/app/[market]/develop/components/tool-renderers/OptionButton'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
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
  // Square layout URLs
  transparentUrl?: string
  solidUrl?: string
  mockupUrl?: string
  // Horizontal layout URLs
  horizontalTransparentUrl?: string
  horizontalSolidUrl?: string
  horizontalMockupUrl?: string
  // Vertical layout URLs
  verticalTransparentUrl?: string
  verticalSolidUrl?: string
  verticalMockupUrl?: string
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
  return logo.transparentUrl
    || logo.horizontalTransparentUrl
    || logo.verticalTransparentUrl
    || logo.url
    || logo.watermarkedTransparentUrl
    || logo.solidUrl
    || logo.horizontalSolidUrl
    || logo.verticalSolidUrl
    || logo.watermarkedSolidUrl;
}

const DEFAULT_LOGO_SLOT_NAME = 'logo/primary';

/**
 * Return all slot names that a logo populates, based on which URL fields are present.
 * Each orientation has its own slot: square → logo/primary, horizontal → logo/horizontal, vertical → logo/vertical.
 * Falls back to ['logo/primary'] when no orientation fields are populated.
 */
export function getLogoSlotNames(logo: LogoData): string[] {
  const slots: string[] = [];
  if (logo.transparentUrl || logo.solidUrl || logo.url || logo.watermarkedTransparentUrl || logo.watermarkedSolidUrl) {
    slots.push('logo/primary');
  }
  if (logo.horizontalTransparentUrl || logo.horizontalSolidUrl) {
    slots.push('logo/horizontal');
  }
  if (logo.verticalTransparentUrl || logo.verticalSolidUrl) {
    slots.push('logo/vertical');
  }
  return slots.length > 0 ? slots : [DEFAULT_LOGO_SLOT_NAME];
}

/**
 * Determine the correct slot name for a logo based on which URL fields are populated.
 * Returns the first (highest-priority) matching slot.
 */
export function getLogoSlotName(logo: LogoData): string {
  return getLogoSlotNames(logo)[0]!;
}

/** Agent-facing placement directive for `logo_slot_placement` context (version in-repo, not user-visible). */
const LOGO_SLOT_PLACEMENT_INSTRUCTIONS =
  'The user saved their logo. Update the codebase so that logo appears everywhere it should: use urls.default (img src, framework Image components, CSS when appropriate), use urls.solid (only when showing off logo independently or when the logo is the same color as the background). Add or update header, navigation, footer, favicon, and other branding; replace hardcoded logo image URLs with the provided slotPath wherever this logo orientation should appear.';

function buildLogoPlacementContext(slotNames: string[]): CustomContext {
  const primarySlot = slotNames[0] ?? DEFAULT_LOGO_SLOT_NAME
  const slotBase = `/airo-assets/images/${primarySlot}`
  return {
    type: 'logo_slot_placement',
    data: {
      event: 'user_saved_logo_selection',
      slotPath: primarySlot,
      ...(slotNames.length > 1 && {
        allSlotPaths: slotNames,
        allSlotUrls: Object.fromEntries(
          slotNames.map(s => [s, `/airo-assets/images/${s}`])
        ),
      }),
      urls: {
        default: slotBase,
        solid: `${slotBase}?variant=solid`,
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
    if (!selectedLogo) {
      setSwapError(t('builder_common_error_generic'))
      return
    }

    setSwapError(null)

    // Collect all populated orientation slots so layout:'all' logos update every slot
    const slotsToSwap: Array<{ url: string; slotName: string }> = []
    if (selectedLogo.transparentUrl) {
      slotsToSwap.push({ url: selectedLogo.transparentUrl, slotName: 'logo/primary' })
    }
    if (selectedLogo.horizontalTransparentUrl) {
      slotsToSwap.push({ url: selectedLogo.horizontalTransparentUrl, slotName: 'logo/horizontal' })
    }
    if (selectedLogo.verticalTransparentUrl) {
      slotsToSwap.push({ url: selectedLogo.verticalTransparentUrl, slotName: 'logo/vertical' })
    }

    // Fallback: if no transparent URLs, use getLogoDisplayUrl for the primary slot
    if (slotsToSwap.length === 0) {
      const fallbackUrl = getLogoDisplayUrl(selectedLogo)
      if (!fallbackUrl) {
        setSwapError(t('builder_common_error_generic'))
        return
      }
      slotsToSwap.push({ url: fallbackUrl, slotName: getLogoSlotName(selectedLogo) })
    }

    // Swap all slots — continue on failure so partial success doesn't leave state inconsistent
    let anyFailed = false
    for (const { url, slotName } of slotsToSwap) {
      const swapped = await swapSlot(url, slotName)
      if (!swapped) anyFailed = true
    }
    if (anyFailed) return

    if (sendUserMessage) {
      setPostSaveSuggestionsVisible(true)
    }
  }

  function handleApplyLogoPlacement() {
    if (isProcessing || !sendUserMessage) return
    const selectedLogo = logos[selectedIndex]

    const slotNames = selectedLogo ? getLogoSlotNames(selectedLogo) : [DEFAULT_LOGO_SLOT_NAME]

    sendUserMessage(
      t('builder_logo_grid_next_apply', undefined, 'Apply logo across the site'),
      {
        isActionRequest: true,
        customContext: buildLogoPlacementContext(slotNames),
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
