'use client'

import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { useRef, useState } from 'react'
import CheckIcon from '@ux/icon/checkmark'
import ClipboardIcon from '@ux/icon/copy'
import OkIcon from '@ux/icon/ok'

import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'

interface ResponseMetadataProps {
  duration: number
  content: string
  usedFreeGrants?: boolean
}

/**
 * Display response metadata including completion time and copy functionality
 *
 * Shows the time taken to complete a response and provides a copy button
 * to copy the response content to clipboard.
 *
 * @param duration - Time taken to complete the response in milliseconds
 * @param content - The response content to copy to clipboard
 *
 * @example
 * ```tsx
 * <ResponseMetadata
 *   duration={2500}
 *   content="Response text to copy"
 * />
 * ```
 */
export default function ResponseMetadata({ duration, content, usedFreeGrants }: ResponseMetadataProps) {
  const t = useTranslations()
  const [copiedToClipboard, setCopiedToClipboard] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  const completedText = usedFreeGrants
    ? t('builder_chat_completed_free')
    : t('builder_chat_completed')


  /**
   * Format duration in milliseconds to human-readable string
   *
   * @param ms - Duration in milliseconds
   * @returns Formatted duration string (e.g., "1.5s", "2m 30.0s")
   */
  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`

    const minutes = Math.floor(ms / 60000)
    const seconds = ((ms % 60000) / 1000).toFixed(0)
    return `${minutes}m ${seconds}s`
  }

  /**
   * Copy response content to clipboard and show confirmation
   */
  const handleCopyResponse = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedToClipboard(true)

      // Clear existing timeout if any
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }

      // Set new timeout
      timeoutRef.current = setTimeout(() => {
        setCopiedToClipboard(false)
        timeoutRef.current = null
      }, 5000)
    } catch (err) {
      logger.error('response_metadata.copy.failed', {
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  /**
   * Handle mouse leave - clear timeout and reset state
   */
  const handleMouseLeave = () => {
    setIsHovered(false)

    // Clear timeout and reset copied state
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setCopiedToClipboard(false)
  }

  return (
    <button
      className={clsx(
        'group flex items-center justify-between mt-1.5 text-xs cursor-pointer w-full',
        usedFreeGrants ? 'text-intents-ux-feedbackHighContrastSuccess-feedbackColor' : 'text-foreground/50'
      )}
      onClick={handleCopyResponse}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      title={t('builder_chat_copy_clipboard')}
    >
      <div className="flex gap-1 items-center">
        <OkIcon className="w-2 h-2" />
        <div className={clsx(
          'flex gap-0.5 items-center overflow-hidden',
          !usedFreeGrants && 'group-hover:text-foreground'
        )}>
          {completedText}
          <AnimatePresence>
            {isHovered && (
              <motion.span
                className="whitespace-nowrap"
                initial={{ opacity: 0, x: -10, width: 0 }}
                animate={{ opacity: 1, x: 0, width: 'auto' }}
                exit={{ opacity: 0, x: -10, width: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
              >
                {t('builder_chat_in_duration', {duration: formatDuration(duration)})}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>
      <AnimatePresence>
        {isHovered && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {copiedToClipboard ? (
              <motion.div
                initial={{ scale: 0.5 }}
                animate={{ scale: [0.5, 1.2, 1] }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
              >
                <CheckIcon className="w-2 h-2" />
              </motion.div>
            ) : (
              <ClipboardIcon className="w-2 h-2" />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </button>
  )
}

