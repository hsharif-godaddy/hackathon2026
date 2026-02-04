'use client'

import { clsx } from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Button from '@ux/button'
import WindowNewIcon from '@ux/icon/window-new'
import XThickIcon from '@ux/icon/x-thick'

import MarkdownRenderer from './MarkdownRenderer'

interface FullscreenModalProps {
  content?: string
  imageUrl?: string
  imageAlt?: string
  title?: string
  toolName?: string
  layoutId?: string
  type?: 'markdown' | 'image' | 'plain'
  children?: React.ReactNode
}

export default function FullscreenModal({
  content,
  imageUrl,
  imageAlt,
  layoutId,
  type = 'markdown',
  children
}: FullscreenModalProps) {
  const [isOpen, setIsOpen] = useState(false)

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

  if (typeof document === 'undefined') {
    return null
  }

  const isImage = type === 'image';

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
            onClick={() => setIsOpen(false)}
          />

          {/* Modal Container */}
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-2"
            onClick={() => setIsOpen(false)}
          >
            <motion.div
              className={clsx("max-w-7xl shadow-xl flex flex-col overflow-hidden relative", {
                "rounded": isImage,
                "max-h-full w-full bg-intents-ux-box-backgroundColor p-2 rounded-lg": !isImage,
              })}
              initial={isImage ? { opacity: 0 } : { scale: 0.9, opacity: 0 }}
              animate={isImage ? { opacity: 1 } : { scale: 1, opacity: 1 }}
              exit={isImage ? { opacity: 0 } : { scale: 0.9, opacity: 0 }}
              transition={{
                type: "tween",
                duration: 0.2,
                ease: "easeOut"
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className={clsx("absolute", {
                "top-1.5 right-1": !isImage,
                "top-3 right-3": isImage,
              })}>
                <Button
                  onClick={() => setIsOpen(false)}
                  icon={<XThickIcon className="h-3 w-3" />}
                  design="control"
                  aria-label="Close"
                  size="sm"
                />
              </div>

              {/* Content */}
              <motion.div
                className={clsx("flex-1 overflow-auto p-2", {
                  "flex flex-col items-center justify-center": type === 'image'
                })}
                layoutId={!isImage ? layoutId : undefined}
                transition={{
                  type: "tween",
                  duration: 0.2,
                  ease: "easeOut"
                }}
              >
                {type === 'image' && imageUrl ? (
                  <img /* eslint-disable-line @next/next/no-img-element */
                    src={imageUrl}
                    alt={imageAlt || 'Fullscreen image'}
                    className="max-w-full max-h-full object-contain"
                  />
                ) : type === 'plain' ? (
                  <pre className="text-sm whitespace-pre font-mono text-left overflow-auto h-full bg-intents-ux-box-backgroundColor p-2 rounded">
                    {content}
                  </pre>
                ) : (
                  <MarkdownRenderer
                    content={content || ''}
                    className="h-full"
                    fullscreen={true}
                  />
                )}
              </motion.div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )

  return (
    <>
      {children ? (
        <div onClick={() => setIsOpen(true)}>
          {children}
        </div>
      ) : (
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center justify-center w-3 h-3 rounded transition-colors"
          title="Open in fullscreen"
        >
          <WindowNewIcon className="w-2 h-2" />
        </button>
      )}
      {createPortal(modalContent, document.body)}
    </>
  )
}
