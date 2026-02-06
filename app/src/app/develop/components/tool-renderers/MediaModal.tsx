'use client'

import Button from '@ux/button'
import XThickIcon from '@ux/icon/x-thick'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface MediaModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Max width class for the modal (default: max-w-4xl) */
  maxWidth?: string
}

/**
 * Shared modal component for media tool renderers
 *
 * Provides consistent modal structure with:
 * - Animated backdrop and modal
 * - Close button
 * - Title
 * - Scrollable content area
 * - Escape key to close
 * - Click outside to close
 */
export default function MediaModal({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = 'max-w-4xl'
}: MediaModalProps) {
  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

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
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={onClose}
          >
            <motion.div
              className={`${maxWidth} w-full bg-intents-ux-box-backgroundColor rounded-lg shadow-xl relative max-h-[90vh] flex flex-col`}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'tween', duration: 0.2, ease: 'easeOut' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="p-4 pb-0 flex-shrink-0">
                {/* Close button */}
                <div className="absolute top-2 right-2 z-10">
                  <Button
                    onClick={onClose}
                    icon={<XThickIcon className="h-3 w-3" />}
                    design="control"
                    aria-label="Close"
                    size="sm"
                  />
                </div>

                {/* Title */}
                <h2 className="text-xl font-bold mb-3">{title}</h2>
              </div>

              {/* Scrollable content area */}
              <div className="p-4 pt-0 flex-1 overflow-y-auto">
                {children}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )

  // Only render portal on client side
  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(modalContent, document.body)
}
