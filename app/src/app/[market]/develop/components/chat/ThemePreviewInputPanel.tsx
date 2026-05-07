'use client'

import { Check, Loader2 } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import text from '@ux/text'

import AgentChoiceActionFooter from '@/app/[market]/develop/components/chat/AgentChoiceActionFooter'
import { useSendUserMessage } from '@/app/[market]/develop/components/chat/ChatContext'
import { similar } from '@/app/[market]/develop/components/utils/colorSimilarity'
import type { ColorSchemePaletteOption } from '@/app/[market]/develop/components/utils/findLatestColorSchemeSuggest'
import { previewThemeInIframe } from '@/app/[market]/develop/components/utils/previewThemeInIframe'
import { useTranslations } from '@/hooks/useTranslations'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'

export interface ThemePreviewInputPanelProps {
  toolCallId: string
  palettes: ColorSchemePaletteOption[]
  onCancel?: () => void
  selectedIndex?: number
  onSelectedIndexChange?: (index: number) => void
  /**
   * When set, renders `children({ body, footer })` instead of the default stacked layout.
   * Used with {@link CollapsibleChatInputSection} when `airo-builder-theme-selection-chat` is enabled.
   */
  children?: (parts: { body: ReactNode; footer: ReactNode }) => ReactNode
  /**
   * When true, disables all interactions (radio buttons and action buttons).
   * Used when preview iframe is not visible (e.g., on Code or Settings tabs).
   */
  disabled?: boolean
}

export default function ThemePreviewInputPanel({
  toolCallId,
  palettes,
  onCancel,
  selectedIndex: controlledSelectedIndex,
  onSelectedIndexChange,
  children: childrenFn,
  disabled = false,
}: ThemePreviewInputPanelProps) {
  const t = useTranslations()
  const sendUserMessage = useSendUserMessage()
  const isStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()
  const isProcessing = isStreaming || isLoading

  const [internalSelectedIndex, setInternalSelectedIndex] = useState<number>(0)
  const selectedIndex = controlledSelectedIndex !== undefined ? controlledSelectedIndex : internalSelectedIndex
  const setSelectedIndex = onSelectedIndexChange || setInternalSelectedIndex

  const [applyingTheme, setApplyingTheme] = useState(false)

  useEffect(() => {
    if (!isProcessing) setApplyingTheme(false)
  }, [isProcessing])

  function renderColorCircle(bg: string, palette: ColorSchemePaletteOption['palette']) {
    return (
      <div
        className="-ml-1 size-3 shrink-0 rounded-full first:ml-0"
        style={{
          backgroundColor: bg,
          boxShadow: similar(bg, palette.background)
            ? `inset 0 0 0 1px ${palette.foreground}20`
            : undefined
        }}
      />
    )
  }

  useEffect(() => {
    const paletteToPreview = palettes[selectedIndex]
    if (paletteToPreview) {
      previewThemeInIframe(paletteToPreview.name, paletteToPreview.palette)
    }
  }, [toolCallId])

  function selectPalette(index: number) {
    if (disabled) return
    const option = palettes[index]
    if (!option) return
    setSelectedIndex(index)
    previewThemeInIframe(option.name, option.palette)
  }

  function handleApply() {
    const selectedPalette = palettes[selectedIndex]
    if (!selectedPalette || isProcessing || applyingTheme || disabled || !sendUserMessage) return
    setApplyingTheme(true)
    setSelectedIndex(0)
    sendUserMessage(
      `${t('builder_tools_css_color_scheme_use_color', undefined, 'Use color scheme:')} ${selectedPalette.name}`,
      { isActionRequest: true }
    )
  }

  function handleMoreOptions() {
    if (isProcessing || applyingTheme || disabled || !sendUserMessage) return
    handleCancel()
    sendUserMessage(t('builder_tools_css_color_scheme_more_options', undefined, 'Show me more color scheme options'), { isActionRequest: true })
  }

  function handleCancel() {
    setSelectedIndex(0)
    if (palettes[0]) {
      previewThemeInIframe(palettes[0].name, palettes[0].palette)
    }
    onCancel?.()
  }

  const radioName = `theme-preview-suggest-${toolCallId}`

  const mainBlock =
    applyingTheme ? (
      <div className="flex items-center gap-1.5 px-1 py-2 text-sm text-muted-foreground" aria-live="polite">
        <Loader2 className="size-2.5 shrink-0 animate-spin" />
        <span>{t('builder_theme_preview_applying', undefined, 'Applying theme…')}</span>
      </div>
    ) : (
      <div
        className="flex max-h-48 flex-col gap-0.5 overflow-y-auto pr-0.5"
        role="radiogroup"
        aria-label={t('builder_theme_preview_panel_title', undefined, 'Choose a color scheme')}
      >
        {palettes.map((option, index) => {
          const { palette } = option
          const isSelected = selectedIndex === index
          const inputId = `theme-preview-${toolCallId}-${index}`
          return (
            <label
              key={`${toolCallId}-${index}`}
              htmlFor={inputId}
              data-testid="theme-preview-option"
              className={`flex items-center gap-2 rounded-md border-2 px-1.5 py-0.5 transition-all duration-200 ${
                disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:shadow-md'
              }`}
              style={{
                backgroundColor: palette.background,
                color: palette.foreground,
                borderColor: isSelected ? palette.primary : undefined
              }}
            >
              <input
                id={inputId}
                type="radio"
                className="sr-only"
                name={radioName}
                value={index}
                checked={isSelected}
                disabled={disabled}
                onChange={() => selectPalette(index)}
              />
              <span
                className="flex size-3 shrink-0 items-center justify-center rounded-full border-2"
                style={
                  isSelected
                    ? {
                        backgroundColor: palette.primary,
                        borderColor: palette.primary,
                        color: palette.primaryForeground
                      }
                    : {
                        backgroundColor: 'transparent',
                        borderColor: palette.primary,
                        color: palette.primaryForeground
                      }
                }
                aria-hidden
              >
                {isSelected && <Check className="size-2" style={{ color: palette.primaryForeground }} />}
              </span>

              <text.span size={0} className="min-w-0 shrink truncate font-semibold leading-none">
                {option.name}
              </text.span>
              <div className="ml-auto flex flex-row items-center pl-0.5">
                {renderColorCircle(palette.primary, palette)}
                {renderColorCircle(palette.secondary, palette)}
                {renderColorCircle(palette.accent, palette)}
                {renderColorCircle(palette.muted, palette)}
              </div>
            </label>
          )
        })}
      </div>
    )

  const footerRow = onCancel ? (
    <AgentChoiceActionFooter
      showCancel
      applyLabel={t('builder_common_apply', undefined, 'Apply')}
      applyTestId="theme-preview-apply"
      cancelLabel={t('builder_common_cancel', undefined, 'Cancel')}
      cancelTestId="theme-preview-cancel"
      disableApply={isProcessing || applyingTheme || disabled || !palettes[selectedIndex]}
      disableCancel={isProcessing || applyingTheme}
      disableGenerateMore={isProcessing || applyingTheme || disabled}
      generateMoreLabel={t('builder_common_generate_more', undefined, 'Generate More')}
      generateMoreTestId="theme-preview-more-options"
      onApply={handleApply}
      onCancel={handleCancel}
      onGenerateMore={handleMoreOptions}
    />
  ) : (
    <AgentChoiceActionFooter
      applyLabel={t('builder_common_apply', undefined, 'Apply')}
      applyTestId="theme-preview-apply"
      disableApply={isProcessing || applyingTheme || disabled || !palettes[selectedIndex]}
      disableGenerateMore={isProcessing || applyingTheme || disabled}
      generateMoreLabel={t('builder_common_generate_more', undefined, 'Generate More')}
      generateMoreTestId="theme-preview-more-options"
      onApply={handleApply}
      onGenerateMore={handleMoreOptions}
    />
  )

  const body = (
    <div data-testid="theme-preview-input-panel" className="flex flex-col gap-1">
      {mainBlock}
    </div>
  )

  if (childrenFn) {
    return <>{childrenFn({ body, footer: footerRow })}</>
  }

  return (
    <div data-testid="theme-preview-input-panel" className="flex flex-col gap-1">
      {mainBlock}
      <div className="mt-1 pb-2">{footerRow}</div>
    </div>
  )
}
