'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createPortal } from 'react-dom'
import Button from '@ux/button'
import WindowNewIcon from '@ux/icon/window-new'
import MarkdownRenderer from './MarkdownRenderer'
import XThickIcon from '@ux/icon/x-thick'
import { clsx } from 'clsx'

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
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

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
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => setIsOpen(false)}
          >
            <motion.div
              className={clsx("max-w-7xl shadow-xl flex flex-col overflow-hidden relative", {
                "rounded": isImage,
                "max-h-full w-full bg-intents-ux-box-backgroundColor p-4 rounded-lg": !isImage,
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
                "top-3 right-2": !isImage,
                "top-6 right-6": isImage,
              })}>
                <Button
                  onClick={() => setIsOpen(false)}
                  icon={<XThickIcon className="h-6 w-6" />}
                  design="control"
                  aria-label="Close"
                  size="sm"
                />
              </div>

              {/* Content */}
              <motion.div
                className={clsx("flex-1 overflow-auto p-4", {
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
                  <pre className="text-sm whitespace-pre font-mono text-left overflow-auto h-full bg-intents-ux-box-backgroundColor p-4 rounded">
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

  if (!mounted) {
    if (children) {
      return <div>{children}</div>
    }
    return (
      <button
        className="flex items-center justify-center w-6 h-6 rounded transition-colors"
        title="Open in fullscreen"
      >
        <WindowNewIcon className="w-4 h-4" />
      </button>
    )
  }

  return (
    <>
      {children ? (
        <div onClick={() => setIsOpen(true)}>
          {children}
        </div>
      ) : (
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center justify-center w-6 h-6 rounded transition-colors"
          title="Open in fullscreen"
        >
          <WindowNewIcon className="w-4 h-4" />
        </button>
      )}
      {createPortal(modalContent, document.body)}
    </>
  )
}
