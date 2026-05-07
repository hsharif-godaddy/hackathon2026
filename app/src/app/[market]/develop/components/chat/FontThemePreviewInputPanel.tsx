'use client'

import { Check, Loader2 } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import PlusIcon from '@ux/icon/plus'
import text from '@ux/text'

import AgentChoiceActionFooter from '@/app/[market]/develop/components/chat/AgentChoiceActionFooter'
import { useSendUserMessage } from '@/app/[market]/develop/components/chat/ChatContext'
import type { FontThemeSuggestOption } from '@/app/[market]/develop/components/utils/findLatestFontThemeSuggest'
import { previewFontInIframe, revertFontInIframe } from '@/app/[market]/develop/components/utils/previewFontInIframe'
import { useTranslations } from '@/hooks/useTranslations'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'

interface FontThemeRow {
  bodyFont: FontThemeSuggestOption['bodyFont']
  headerFont: FontThemeSuggestOption['headerFont']
  id: string
  name: string
}

function rowFromOption(t: FontThemeSuggestOption): FontThemeRow {
  return {
    bodyFont: t.bodyFont,
    headerFont: t.headerFont,
    id: t.id,
    name: t.name,
  }
}

export interface FontThemePreviewInputPanelProps {
  children?: (parts: { body: ReactNode; footer: ReactNode }) => ReactNode
  disabled?: boolean
  onCancel?: () => void
  selectedIndex?: number
  onSelectedIndexChange?: (index: number) => void
  themes: FontThemeSuggestOption[]
  toolCallId: string
}

export default function FontThemePreviewInputPanel({
  children: childrenFn,
  disabled = false,
  onCancel,
  selectedIndex: controlledSelectedIndex,
  onSelectedIndexChange,
  themes,
  toolCallId,
}: FontThemePreviewInputPanelProps) {
  const t = useTranslations()
  const sendUserMessage = useSendUserMessage()
  const isStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()
  const isProcessing = isStreaming || isLoading

  const rows = useMemo(() => themes.map(rowFromOption), [themes])

  const [internalSelectedIndex, setInternalSelectedIndex] = useState(0)
  const selectedIndex = controlledSelectedIndex !== undefined ? controlledSelectedIndex : internalSelectedIndex
  const setSelectedIndex = onSelectedIndexChange || setInternalSelectedIndex

  const [applying, setApplying] = useState(false)

  useEffect(() => {
    if (!isProcessing) setApplying(false)
  }, [isProcessing])

  useEffect(() => {
    const row = themes[selectedIndex]
    if (row) {
      previewFontInIframe({ bodyFont: row.bodyFont, headerFont: row.headerFont })
    }
  }, [toolCallId])

  useEffect(() => {
    const linkId = 'font-theme-preview-input-google-fonts'
    if (rows.length === 0) return

    const fontMap = new Map<string, Set<string>>()
    for (const row of rows) {
      for (const f of [row.headerFont, row.bodyFont]) {
        if (!f?.name) continue
        const existing = fontMap.get(f.name) || new Set<string>()
        for (const w of f.weights) existing.add(w)
        fontMap.set(f.name, existing)
      }
    }

    const families: string[] = []
    fontMap.forEach((weights, name) => {
      const enc = encodeURIComponent(name).replace(/%20/g, '+')
      families.push(`${enc}:wght@${Array.from(weights).sort().join(';')}`)
    })
    if (families.length === 0) return

    let link = document.getElementById(linkId) as HTMLLinkElement | null
    if (!link) {
      link = document.createElement('link')
      link.id = linkId
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }
    link.href = `https://fonts.googleapis.com/css2?family=${families.join('&family=')}&display=swap`
    return () => {
      link?.remove()
    }
  }, [rows])

  function selectIndex(index: number) {
    if (disabled) return
    const row = rows[index]
    if (!row) return
    setSelectedIndex(index)
    previewFontInIframe({ bodyFont: row.bodyFont, headerFont: row.headerFont })
  }

  function handleApply() {
    const row = rows[selectedIndex]
    if (!row || isProcessing || applying || disabled || !sendUserMessage) return
    setApplying(true)
    setSelectedIndex(0)
    sendUserMessage(
      t('builder_font_theme_apply_message', { themeName: row.name }, `Apply font theme: {themeName}`),
      { isActionRequest: true }
    )
  }

  function handleMoreOptions() {
    if (isProcessing || applying || disabled || !sendUserMessage) return
    handleCancel()
    sendUserMessage(
      t('builder_font_theme_more_options_message', undefined, 'Show me more font options'),
      { isActionRequest: true }
    )
  }

  function handleCancel() {
    setSelectedIndex(0)
    revertFontInIframe()
    onCancel?.()
  }

  const radioName = `font-theme-preview-suggest-${toolCallId}`

  const mainBlock =
    applying ? (
      <div className="flex items-center gap-1.5 px-1 py-2 text-sm text-muted-foreground" aria-live="polite">
        <Loader2 className="size-2.5 shrink-0 animate-spin" />
        <span>{t('builder_theme_preview_applying', undefined, 'Applying theme…')}</span>
      </div>
    ) : (
      <div
        className="flex max-h-48 flex-col gap-0.5 overflow-y-auto pr-0.5"
        role="radiogroup"
        aria-label={`${t('builder_tools_font_theme', undefined, 'Font Theme')}: ${t('builder_tools_font_theme_options', undefined, 'Options')}`}
      >
        {rows.map((row, index) => {
          const isSelected = selectedIndex === index
          const inputId = `font-theme-preview-${toolCallId}-${index}`
          const headerWeight = row.headerFont.weights[row.headerFont.weights.length - 1] || '700'
          const bodyWeight = row.bodyFont.weights[0] || '400'
          const isSameFont = row.headerFont.name === row.bodyFont.name

          const isDisabled = disabled

          return (
            <label
              key={row.id}
              className={`flex cursor-pointer items-center gap-2 rounded-md border-2 px-1.5 py-0.5 transition-all duration-200 ${
                isDisabled ? 'cursor-not-allowed opacity-50' : 'hover:shadow-md'
              }`}
              style={{
                backgroundColor: 'var(--intents-ux-box-backgroundColor)',
                borderColor: isSelected ? '#000000' : undefined,
              }}
              data-testid="font-theme-preview-option"
              htmlFor={inputId}
            >
              <input
                checked={isSelected}
                className="sr-only"
                disabled={isDisabled}
                id={inputId}
                name={radioName}
                onChange={() => selectIndex(index)}
                type="radio"
                value={index}
              />
              <span
                aria-hidden
                className="flex size-3 shrink-0 items-center justify-center rounded-full border-2"
                style={
                  isSelected
                    ? {
                        backgroundColor: '#000000',
                        borderColor: '#000000',
                        color: '#ffffff'
                      }
                    : {
                        backgroundColor: 'transparent',
                        borderColor: 'var(--intents-ux-boxHighContrast-borderColor)',
                      }
                }
              >
                {isSelected && <Check className="size-2" style={{ color: '#ffffff' }} />}
              </span>
              {isSelected ? (
                <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                  <text.span
                    className="truncate font-semibold leading-none"
                    size={0}
                    style={{
                      fontFamily: `"${row.headerFont.name}", ui-sans-serif, system-ui, sans-serif`,
                      fontWeight: headerWeight,
                    }}
                  >
                    {row.name}
                  </text.span>
                  <div className="flex items-center gap-1 text-xs text-intents-ux-boxLowContrast-foregroundColor">
                    {isSameFont ? (
                      <span
                        style={{
                          fontFamily: `"${row.headerFont.name}", ui-sans-serif, system-ui, sans-serif`,
                          fontWeight: headerWeight,
                        }}
                      >
                        {row.headerFont.name}
                      </span>
                    ) : (
                      <>
                        <span
                          style={{
                            fontFamily: `"${row.headerFont.name}", ui-sans-serif, system-ui, sans-serif`,
                            fontWeight: headerWeight,
                          }}
                        >
                          {row.headerFont.name}
                        </span>
                        <PlusIcon className="size-2 shrink-0" />
                        <span
                          style={{
                            fontFamily: `"${row.bodyFont.name}", ui-sans-serif, system-ui, sans-serif`,
                            fontWeight: bodyWeight,
                          }}
                        >
                          {row.bodyFont.name}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <text.span
                  className="min-w-0 shrink truncate font-semibold leading-none"
                  size={0}
                  style={{
                    fontFamily: `"${row.headerFont.name}", ui-sans-serif, system-ui, sans-serif`,
                    fontWeight: headerWeight,
                  }}
                >
                  {row.name}
                </text.span>
              )}
            </label>
          )
        })}
      </div>
    )

  const footerRow = onCancel ? (
    <AgentChoiceActionFooter
      showCancel
      applyLabel={t('builder_common_apply', undefined, 'Apply')}
      applyTestId="font-theme-preview-apply"
      cancelLabel={t('builder_common_cancel', undefined, 'Cancel')}
      cancelTestId="font-theme-preview-cancel"
      disableApply={isProcessing || applying || disabled || !rows[selectedIndex]}
      disableCancel={isProcessing || applying}
      disableGenerateMore={isProcessing || applying || disabled}
      generateMoreLabel={t('builder_common_generate_more', undefined, 'Generate More')}
      generateMoreTestId="font-theme-preview-more-options"
      onApply={handleApply}
      onCancel={handleCancel}
      onGenerateMore={handleMoreOptions}
    />
  ) : (
    <AgentChoiceActionFooter
      applyLabel={t('builder_common_apply', undefined, 'Apply')}
      applyTestId="font-theme-preview-apply"
      disableApply={isProcessing || applying || disabled || !rows[selectedIndex]}
      disableGenerateMore={isProcessing || applying || disabled}
      generateMoreLabel={t('builder_common_generate_more', undefined, 'Generate More')}
      generateMoreTestId="font-theme-preview-more-options"
      onApply={handleApply}
      onGenerateMore={handleMoreOptions}
    />
  )

  const body = (
    <div className="flex flex-col gap-1" data-testid="font-theme-preview-input-panel">
      {mainBlock}
    </div>
  )

  if (childrenFn) {
    return <>{childrenFn({ body, footer: footerRow })}</>
  }

  return (
    <div className="flex flex-col gap-1" data-testid="font-theme-preview-input-panel">
      {mainBlock}
      <div className="mt-1 pb-2">{footerRow}</div>
    </div>
  )
}
