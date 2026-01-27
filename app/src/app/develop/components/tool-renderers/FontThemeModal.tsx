'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import Button from '@ux/button'
import XThickIcon from '@ux/icon/x-thick'

import { useTranslations } from '@/hooks/useTranslations'

/**
 * Font theme modal props
 */
export interface FontThemeModalProps {
  isOpen: boolean
  onClose: () => void
  fontName: string
}

/**
 * Font size/weight sample configuration
 */
const fontSamples = [
  { size: '2.5rem', weight: '700', label: 'Heading 1', sampleText: 'The quick brown fox' },
  { size: '2rem', weight: '700', label: 'Heading 2', sampleText: 'The quick brown fox jumps' },
  { size: '1.5rem', weight: '600', label: 'Heading 3', sampleText: 'The quick brown fox jumps over' },
  { size: '1.25rem', weight: '600', label: 'Heading 4', sampleText: 'The quick brown fox jumps over the lazy dog' },
  { size: '1rem', weight: '400', label: 'Body', sampleText: 'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.' },
  { size: '0.875rem', weight: '400', label: 'Small', sampleText: 'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump!' },
]

/**
 * Font Theme Modal component
 *
 * Displays font information in a modal showing the font at multiple sizes.
 */
export default function FontThemeModal({
  isOpen,
  onClose,
  fontName
}: FontThemeModalProps) {
  const t = useTranslations()

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }

    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isOpen])

  if (typeof document === 'undefined') return null

  const fontFamily = `"${fontName}", -apple-system, BlinkMacSystemFont, sans-serif`

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-50 bg-intents-ux-boxHighContrastOverlay-backgroundColor"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
          />

          {/* Modal Container */}
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-2"
            onClick={onClose}
          >
            <motion.div
              className="max-w-2xl w-full bg-intents-ux-box-backgroundColor p-3 rounded-lg shadow-xl relative max-h-[80vh] flex flex-col"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'tween', duration: 0.2, ease: 'easeOut' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <div className="absolute top-1.5 right-1.5">
                <Button
                  onClick={onClose}
                  icon={<XThickIcon className="h-3 w-3" />}
                  design="control"
                  aria-label={t('builder_common_close', undefined, 'Close')}
                  size="sm"
                />
              </div>

              {/* Title */}
              <h2
                className="text-xl font-bold mb-3"
                style={{ fontFamily }}
              >
                {fontName}
              </h2>

              {/* Content area with scroll */}
              <div className="flex-1 overflow-y-auto">
                {/* Type Scale Section */}
                <div className="space-y-3 border rounded-lg p-3 bg-intents-ux-boxLowContrast-backgroundColor">
                  {fontSamples.map((sample, index) => (
                    <div key={index} className="border-b border-border last:border-b-0 pb-2 last:pb-0">
                      <div className="text-xs text-intents-ux-textSubtle-textColor mb-1">
                        {sample.label} ({sample.size})
                      </div>
                      <div
                        style={{
                          fontFamily,
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
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )

  return createPortal(modalContent, document.body)
}
