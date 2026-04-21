'use client'

import Modal from '@ux/modal'

import { useTranslations } from '@/hooks/useTranslations'

/**
 * Font theme modal props
 */
export interface FontThemeModalProps {
  isOpen: boolean
  onClose: () => void
  /** @deprecated since 1.0.0 - Use headerFontName and bodyFontName instead. Will be removed in future version. */
  fontName?: string
  headerFontName?: string
  bodyFontName?: string
}

/**
 * Font size/weight sample configuration
 */
const fontSamples = [
  { size: '2.5rem', weight: '700', label: 'Heading 1', sampleText: 'The quick brown fox', isHeader: true },
  { size: '2rem', weight: '700', label: 'Heading 2', sampleText: 'The quick brown fox jumps', isHeader: true },
  { size: '1.5rem', weight: '600', label: 'Heading 3', sampleText: 'The quick brown fox jumps over', isHeader: true },
  { size: '1.25rem', weight: '600', label: 'Heading 4', sampleText: 'The quick brown fox jumps over the lazy dog', isHeader: true },
  { size: '1rem', weight: '400', label: 'Body', sampleText: 'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.', isHeader: false },
  { size: '0.875rem', weight: '400', label: 'Small', sampleText: 'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump!', isHeader: false },
]

/**
 * Font Theme Modal component
 *
 * Displays font information in a modal showing the font at multiple sizes.
 */
export default function FontThemeModal({
  isOpen,
  onClose,
  fontName,
  headerFontName,
  bodyFontName
}: FontThemeModalProps) {
  const t = useTranslations()

  // Support legacy fontName prop and new headerFontName/bodyFontName props
  const resolvedHeaderFont = headerFontName || fontName || 'Inter'
  const resolvedBodyFont = bodyFontName || fontName || 'Inter'

  const headerFontFamily = `"${resolvedHeaderFont}", -apple-system, BlinkMacSystemFont, sans-serif`
  const bodyFontFamily = `"${resolvedBodyFont}", -apple-system, BlinkMacSystemFont, sans-serif`

  // Display title - show both fonts if different
  const displayTitle = resolvedHeaderFont === resolvedBodyFont
    ? resolvedHeaderFont
    : `${resolvedHeaderFont} + ${resolvedBodyFont}`

  if (!isOpen) return null

  return (
    <Modal
      title={<span style={{ fontFamily: headerFontFamily }}>{displayTitle}</span>}
      onClose={onClose}
      portalElem={document.body}
    >
      <div className="w-full max-w-2xl flex flex-col max-h-[70vh]">
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-3 border rounded-lg p-3 bg-intents-ux-boxLowContrast-backgroundColor">
            {fontSamples.map((sample, index) => (
              <div key={index} className="border-b border-border last:border-b-0 pb-2 last:pb-0">
                <div className="text-xs text-intents-ux-textSubtle-textColor mb-1">
                  {sample.label} ({sample.size})
                  {resolvedHeaderFont !== resolvedBodyFont && (
                    <span className="ml-1 text-intents-ux-textSubtle-textColor">
                      — {sample.isHeader ? resolvedHeaderFont : resolvedBodyFont}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontFamily: sample.isHeader ? headerFontFamily : bodyFontFamily,
                    fontSize: sample.size,
                    fontWeight: sample.weight,
                    lineHeight: 1.3
                  }}
                >
                  {sample.sampleText}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}
