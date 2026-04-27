'use client'

import clsx from 'clsx'
import MapPinIcon from '@ux/icon/map-pin'
import text from '@ux/text'

import type { CompletePalette } from '@/app/[market]/develop/components/types/colorScheme'
import { similar } from '@/app/[market]/develop/components/utils/colorSimilarity'
import { previewThemeInIframe } from '@/app/[market]/develop/components/utils/previewThemeInIframe'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { postMessageToIframe } from '@/utils/postMessage'

/**
 * Color palette widget props
 */
export interface ColorPaletteWidgetProps {
  name?: string
  palette: CompletePalette
  className?: string
  isSelected?: boolean
  /** When true, renders a non-interactive summary (e.g. after theme apply). */
  readOnly?: boolean
}

/**
 * Color Palette Widget
 */
export default function ColorPaletteWidget(props: ColorPaletteWidgetProps) {
  const { data: isThemeSelectionChatEnabled } = useSwitchboard('airo-builder-theme-selection-chat')
  if (isThemeSelectionChatEnabled) {
    return <ColorPaletteWidgetModern {...props} />
  }
  return <ColorPaletteWidgetLegacy {...props} />
}

function ColorPaletteWidgetModern({
  name,
  palette,
  className = '',
  isSelected = false,
  readOnly = false
}: ColorPaletteWidgetProps) {
  const t = useTranslations()

  function handleClick() {
    if (!name || readOnly) return
    previewThemeInIframe(name, palette)
  }

  const renderColorCircle = (color: string) => (
    <div
      className="size-3 shrink-0 rounded-full -ml-1 first:ml-0"
      style={{
        backgroundColor: color,
        boxShadow: similar(color, palette?.background)
        ? `inset 0 0 0 1px ${palette?.foreground}20`
        : undefined,
      }}
    />
  );

  const shellClass = clsx(
    'flex w-full flex-row items-center gap-2 rounded-md border-2 border-border px-1.5 py-0.5 relative',
    !readOnly && 'transition-all duration-200 hover:shadow-md hover:cursor-pointer',
    className,
    {
      'shadow-md': isSelected
    }
  )

  const inner = (
    <>
      <text.span size={0} className="min-w-0 shrink truncate font-semibold leading-none">
        {name || t('builder_tools_css_color_scheme', undefined, 'Color Scheme')}
      </text.span>
      <div className="ml-auto flex flex-row items-center pl-0.5">
        {renderColorCircle(palette?.primary)}
        {renderColorCircle(palette?.secondary)}
        {renderColorCircle(palette?.accent)}
        {renderColorCircle(palette?.muted)}
      </div>
    </>
  )

  const style = { backgroundColor: palette?.background, color: palette?.foreground }

  if (readOnly) {
    return (
      <div
        data-testid="color-palette-option"
        className={shellClass}
        style={style}
      >
        {inner}
      </div>
    )
  }

  return (
    <button
      data-testid="color-palette-option"
      type="button"
      className={shellClass}
      style={style}
      onClick={handleClick}
    >
      {inner}
    </button>
  )
}

/** @deprecated Remove when `airo-builder-theme-selection-chat` is permanently on */
function ColorPaletteWidgetLegacy({ name, palette, className = '', isSelected = false }: ColorPaletteWidgetProps) {
  function handleClick() {
    if (!name) return

    const paletteData = {
      name,
      ...palette
    }

    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement

    if (iframe && iframe.contentWindow) {
      postMessageToIframe(iframe, {
        type: 'PREVIEW_THEME',
        palette: paletteData
      })
    }

    const event = new CustomEvent('palette-preview', {
      detail: paletteData
    })
    window.dispatchEvent(event)
  }

  const renderColorCircle = (color: string) => (
    <div
      className="size-4 rounded-full -ml-1"
      style={{
        backgroundColor: color,
        boxShadow: similar(color, palette?.background)
        ? `inset 0 0 0 1px ${palette?.foreground}15`
        : undefined,
      }}
    />
  );

  return (
    <button
      data-testid="color-palette-option"
      className={clsx(
        "flex flex-col w-full gap-2 p-2 rounded-md border-2 border-border transition-all duration-300 hover:shadow-md hover:cursor-pointer hover:border-intents-ux-boxHighContrast-borderColor relative",
        className,
        {
          "border-intents-ux-boxHighContrast-borderColor shadow-md": isSelected,
        }
      )}
      style={{ backgroundColor: palette?.background, color: palette?.foreground }}
      onClick={handleClick}
    >
      <div className="flex flex-row gap-1 justify-between items-center w-full">
        <div className="flex flex-col items-start">
          <text.span size={3} className="!font-semibold !leading-none">Aa</text.span>
          <text.span size={0} className="!font-thin !leading-none">Aa</text.span>
        </div>
        <div
          style={{ backgroundColor: palette?.primary, color: palette?.primaryForeground }}
          className="size-6 rounded-sm flex items-center justify-center"
        >
          <MapPinIcon className="size-3" />
        </div>
      </div>
      <div className="flex flex-row pl-1">
        {renderColorCircle(palette?.primary)}
        {renderColorCircle(palette?.secondary)}
        {renderColorCircle(palette?.accent)}
        {renderColorCircle(palette?.muted)}
      </div>
    </button>
  )
}
