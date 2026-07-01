'use client'

import { Check, Loader2 } from 'lucide-react'
import { type JSX, useEffect, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import text from '@ux/text'

import { useSendUserMessage } from '@/app/[market]/develop/components/chat/ChatContext'
import type { SuggestedDesignKitOption } from '@/app/[market]/develop/components/utils/findLatestDesignKitSuggest'
import { useTranslations } from '@/hooks/useTranslations'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'

export interface DesignKitSelectorPanelProps {
  toolCallId: string
  kits: SuggestedDesignKitOption[]
  /** Show only the first 3 (UI sizing); the agent may return more. */
  limit?: number
}

export default function DesignKitSelectorPanel({
  toolCallId,
  kits,
  limit = 3,
}: DesignKitSelectorPanelProps): JSX.Element {
  const t = useTranslations()
  const sendUserMessage = useSendUserMessage()
  const isStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()
  const isProcessing = isStreaming || isLoading

  const visibleKits: SuggestedDesignKitOption[] = kits.slice(0, limit)
  const [selectedIndex, setSelectedIndex] = useState<number>(0)
  const [submitting, setSubmitting] = useState<boolean>(false)

  // Clear the local submitting state once the agent turn it triggered settles.
  useEffect(() => {
    if (!isProcessing) setSubmitting(false)
  }, [isProcessing])

  // A re-suggest reuses this mounted panel (the composer-takeover motion key is
  // static), so reset the highlight to the first card when fresh kits arrive —
  // otherwise the prior selection carries over. Mirrors the color-scheme panel.
  useEffect(() => {
    setSelectedIndex(0)
  }, [toolCallId])

  function handleChoose(): void {
    const kit: SuggestedDesignKitOption | undefined = visibleKits[selectedIndex]
    if (!kit || isProcessing || submitting || !sendUserMessage) return
    setSubmitting(true)
    sendUserMessage(
      t('builder_design_kit_vibe_use', { name: kit.displayName }, `Use the ${kit.displayName} vibe`),
      { isActionRequest: true }
    )
  }

  function handleSkip(): void {
    if (isProcessing || submitting || !sendUserMessage) return
    setSubmitting(true)
    sendUserMessage(
      t('builder_design_kit_vibe_skip', undefined, 'Skip — pick the best vibe for me'),
      { isActionRequest: true }
    )
  }

  const radioName = `design-kit-vibe-${toolCallId}`

  return (
    <Box
      data-testid="design-kit-selector-panel"
      displayType="flex"
      elevation="raised"
      orientation="vertical"
      blockPadding="sm"
      inlinePadding="sm"
      gap="sm"
    >
      <div className="flex flex-col gap-0.5">
        <text.span size={0} className="font-semibold text-intents-ux-box-foregroundColor">
          {t('builder_design_kit_vibe_title', undefined, 'Pick a vibe that best fits your brand')}
        </text.span>
        <text.span size={-1} className="text-intents-ux-boxLowContrast-foregroundColor">
          {t('builder_design_kit_vibe_subtitle', undefined, 'You can always change it later.')}
        </text.span>
      </div>

      {submitting ? (
        <div className="flex items-center gap-1.5 px-1 py-3 text-sm text-intents-ux-boxLowContrast-foregroundColor" aria-live="polite">
          <Loader2 className="size-2.5 shrink-0 animate-spin" />
          <span>{t('builder_design_kit_vibe_applying', undefined, 'Setting up your kit…')}</span>
        </div>
      ) : (
        <div
          role="radiogroup"
          aria-label={t('builder_design_kit_vibe_title', undefined, 'Pick a vibe that best fits your brand')}
          className="grid grid-cols-3 gap-2"
        >
          {visibleKits.map((kit, index) => {
            const isSelected: boolean = selectedIndex === index
            const inputId = `${radioName}-${index}`
            return (
              <label
                key={kit.slug}
                htmlFor={inputId}
                data-testid="design-kit-option"
                className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border-2 transition-all duration-200 hover:shadow-md"
                style={{ borderColor: isSelected ? 'var(--color-ai)' : 'transparent' }}
              >
                <input
                  id={inputId}
                  type="radio"
                  className="sr-only"
                  name={radioName}
                  value={index}
                  checked={isSelected}
                  onChange={() => setSelectedIndex(index)}
                />
                <div
                  className="relative aspect-[3/4] w-full overflow-hidden bg-intents-ux-boxLowContrast-backgroundColor"
                  style={{ backgroundColor: kit.palette.background }}
                >
                  {kit.thumbnailUrl ? (
                    // Remote CDN thumbnail, not optimizable (plain img avoids next/image domain config).
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={kit.thumbnailUrl}
                      alt={kit.displayName}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                  {isSelected && (
                    <span
                      className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full"
                      style={{ backgroundColor: 'var(--color-ai)' }}
                      aria-hidden
                    >
                      <Check className="size-2.5 text-white" />
                    </span>
                  )}
                </div>
                <div className="p-1.5">
                  <text.span size={0} className="truncate font-semibold text-intents-ux-box-foregroundColor">
                    {kit.displayName}
                  </text.span>
                </div>
              </label>
            )
          })}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          design="control"
          size="small"
          data-testid="design-kit-skip"
          text={t('builder_design_kit_vibe_skip_button', undefined, 'Skip')}
          disabled={isProcessing || submitting}
          onClick={handleSkip}
        />
        <Button
          design="primary"
          size="small"
          data-testid="design-kit-apply"
          text={t('builder_design_kit_vibe_use_button', undefined, 'Use this vibe')}
          disabled={isProcessing || submitting || !visibleKits[selectedIndex]}
          onClick={handleChoose}
        />
      </div>
    </Box>
  )
}
