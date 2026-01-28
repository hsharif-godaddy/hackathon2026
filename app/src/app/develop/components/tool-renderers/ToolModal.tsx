'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { type ReactNode, type ReactPortal,useEffect } from 'react'
import { createPortal } from 'react-dom'
import Button from '@ux/button'
import XThickIcon from '@ux/icon/x-thick'

/**
 * Props for ToolModal component
 */
interface ToolModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

/**
 * Shared modal component for tool renderers
 *
 * Provides consistent modal UI with backdrop, animations, and close button.
 * Used across multiple tool renderers for displaying detailed information.
 *
 * @param isOpen - Whether the modal is currently open
 * @param onClose - Callback to close the modal
 * @param title - Modal title text
 * @param children - Modal content
 * @returns Modal component
 */
export default function ToolModal({
  isOpen,
  onClose,
  title,
  children
}: ToolModalProps): ReactPortal | null {
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

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-[60] bg-intents-ux-boxHighContrastOverlay-backgroundColor"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
          />

          {/* Modal Container */}
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center p-2"
            onClick={onClose}
          >
            <motion.div
              className="max-w-4xl w-full bg-intents-ux-box-backgroundColor p-3 rounded-lg shadow-xl relative max-h-[85vh] flex flex-col"
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
                  aria-label="Close"
                  size="sm"
                />
              </div>

              {/* Title */}
              <h2 className="text-xl font-bold mb-2">{title}</h2>

              {/* Content */}
              {children}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  )
}
