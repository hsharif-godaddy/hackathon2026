'use client'

import clsx from 'clsx'
import { useEffect, useState } from 'react'
import Button from '@ux/button'

import { useSendUserMessage } from '@/app/develop/components/chat/ChatContext'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'

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
  // Get the first available best URL to use
  return logo.transparentUrl || logo.url || logo.watermarkedTransparentUrl || logo.solidUrl || logo.watermarkedSolidUrl;
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
 * Displays generated logos in a 2x2 grid with selection controls.
 * Users can click to select a logo, then save or request more options.
 */
export default function LogoGridWidget({ logos, className = '' }: LogoGridWidgetProps) {
  const t = useTranslations()
  const [selectedLogo, setSelectedLogo] = useState<LogoData | null>(null)
  const sendUserMessage = useSendUserMessage()
  const isStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()
  const isProcessing = isStreaming || isLoading

  // Listen for logo selection events
  useEffect(() => {
    function handleLogoSelect(event: Event) {
      const customEvent = event as CustomEvent
      setSelectedLogo(customEvent.detail)
    }

    window.addEventListener('logo-select', handleLogoSelect)
    return () => {
      window.removeEventListener('logo-select', handleLogoSelect)
    }
  }, [])

  /**
   * Handle click on logo - select it
   */
  function handleLogoClick(logo: LogoData) {
    setSelectedLogo(logo)

    // Emit custom event for any listeners
    const event = new CustomEvent('logo-select', {
      detail: logo
    })
    window.dispatchEvent(event)

    logger.debug('logo_grid.logo.selected', {
      logoId: logo.id,
      logoStyle: logo.logoFeatures?.logoStyle
    })
  }

  /**
   * Clear selection
   */
  function handleRevert() {
    setSelectedLogo(null)
    logger.debug('logo_grid.selection.cleared', {
      message: 'Logo selection cleared'
    })
  }

  /**
   * Save the selected logo by sending message to chat
   */
  function handleSave() {
    if (!selectedLogo || isProcessing || !sendUserMessage) {return}

    // Send action to use the selected logo
    const logoIndex = logos.findIndex(l => l.id === selectedLogo.id) + 1
    sendUserMessage(`Use logo ${logoIndex}`, { isActionRequest: true })
    setSelectedLogo(null)
  }

  /**
   * Handle "More options" button click
   */
  function handleMoreOptions() {
    if (isProcessing || !sendUserMessage) {return}

    sendUserMessage('Generate more logo options', { isActionRequest: true })
  }

  // Check if logos array is empty or invalid
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
            onClick={() => handleLogoClick(logo)}
            className={clsx(
              "aspect-square group cursor-pointer overflow-hidden rounded-md border-2 transition-all duration-200 hover:shadow-md bg-intents-ux-boxLowContrast-backgroundColor",
              selectedLogo?.id === logo.id
                ? "border-intents-ux-boxHighContrast-borderColor shadow-md"
                : "border-border hover:border-intents-ux-boxHighContrast-borderColor"
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

      {/* Button Controls - Always visible */}
      <div className="mt-3 flex items-center gap-1 flex-wrap justify-end pr-0.5">
        <Button
          text={t('builder_common_more_options')}
          design="tertiary"
          size="sm"
          disabled={isProcessing}
          onClick={handleMoreOptions}
        />

        <Button
          text={t('builder_common_revert')}
          design="secondary"
          size="sm"
          onClick={handleRevert}
        />
        <Button
          text={t('builder_common_save')}
          design="primary"
          size="sm"
          disabled={isProcessing || !selectedLogo}
          onClick={handleSave}
        />
      </div>

      {/* Helper message */}
      <div className="flex items-center gap-1 text-xs text-intents-ux-textSubtle-textColor mt-2">
        <span className="text-sm">Click a logo to select, then save or request more options</span>
      </div>
    </div>
  )
}
