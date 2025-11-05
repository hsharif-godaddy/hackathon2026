'use client'

import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import Button from '@ux/button'
import XThickIcon from '@ux/icon/x-thick'
import KeyValueTable from './KeyValueTable'
import MarkdownRenderer from '../MarkdownRenderer'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'

/**
 * Extract filename from path
 */
function getFilename(path: string): string {
  return path.split('/').pop() || path
}

/**
 * Get mode-specific action verb
 */
function getModeVerb(mode: string): string {
  const verbMap: Record<string, string> = {
    'create': 'Created',
    'edit': 'Edit',
    'rewrite': 'Rewrite',
    'delete': 'Delete'
  }
  return verbMap[mode] || mode
}

/**
 * Custom renderer for fileEdit tool
 * 
 * Shows mode-aware message: "Created {filename}", "Edit {filename} (+5 -3)", etc.
 * Clickable to show modal with full diff and metadata.
 */
export default function FileEditToolRenderer({
  toolName,
  toolStatus,
  input,
  result
}: DefaultToolRendererProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (isModalOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }

    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isModalOpen])

  const getStatusIndicator = () => {
    if (toolStatus === 'running') {
      return (
        <svg className="w-2.5 h-2.5 animate-spin" viewBox="0 0 24 24">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
            fill="none"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )
    }
    return null
  }

  const statusIndicator = getStatusIndicator()

  // Parse result - can be JSON (new format) or Markdown (old format)
  let parsedResult: any = null
  let filePath = ''
  let filename = ''
  let mode = 'edit'
  let changes: { additions: number; deletions: number; totalLines: number } | null = null
  let diff = ''
  let error = ''
  let warning = ''
  let isMarkdownFormat = false
  let markdownContent = ''

  if (result) {
    try {
      // Result might be a string (JSON or Markdown) or already an object
      if (typeof result === 'string') {
        // Try to parse as JSON first
        try {
          parsedResult = JSON.parse(result)
        } catch {
          // If JSON parse fails, it's the old markdown format
          isMarkdownFormat = true
          markdownContent = result
        }
      } else if (typeof result === 'object') {
        parsedResult = result
      }
      
      if (parsedResult) {
        filePath = parsedResult.path || ''
        filename = getFilename(filePath)
        mode = parsedResult.mode || 'edit'
        changes = parsedResult.changes || null
        diff = parsedResult.diff || ''
        error = parsedResult.error || ''
        warning = parsedResult.warning || ''
      }
    } catch (e) {
      console.error('Failed to parse fileEdit result:', e)
    }
  }

  // Also check input for path if result parsing failed
  if (!filePath && input && typeof input === 'object') {
    const inputObj = input as any
    filePath = inputObj.path || ''
    filename = getFilename(filePath)
    mode = inputObj.mode || 'edit'
  }

  const verb = getModeVerb(mode)

  // Build compact display message - format: "Edit: filename +5 -5"
  let displayMessage = `${verb}: ${filename}`
  if (changes && mode !== 'create') {
    displayMessage += ` +${changes.additions} -${changes.deletions}`
  }

  // Has details if we have parsed result data (diff, metadata, etc.) OR markdown content
  const hasDetails = Boolean(
    (parsedResult && (diff || changes || error || warning || filePath)) || 
    isMarkdownFormat
  )

  // Build metadata for modal
  const metadata: Record<string, any> = {}
  if (filePath) {
    metadata['Full Path'] = filePath
  }
  if (mode) {
    metadata['Mode'] = mode
  }
  if (changes) {
    metadata['Lines Added'] = changes.additions
    metadata['Lines Deleted'] = changes.deletions
    metadata['Total Lines'] = changes.totalLines
  }

  const modalContent = mounted && (
    <AnimatePresence>
      {isModalOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-50 bg-intents-ux-boxHighContrastOverlay-backgroundColor"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setIsModalOpen(false)}
          />

          {/* Modal Container */}
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => setIsModalOpen(false)}
          >
            <motion.div
              className="max-w-4xl w-full bg-intents-ux-box-backgroundColor p-6 rounded-lg shadow-xl relative max-h-[85vh] flex flex-col"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'tween', duration: 0.2, ease: 'easeOut' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <div className="absolute top-3 right-3">
                <Button
                  onClick={() => setIsModalOpen(false)}
                  icon={<XThickIcon className="h-6 w-6" />}
                  design="control"
                  aria-label="Close"
                  size="sm"
                />
              </div>

              {/* Title */}
              <h2 className="text-xl font-bold mb-4">{verb} {filename}</h2>

              {/* Markdown format (backwards compatibility) */}
              {isMarkdownFormat && (
                <div className="flex-1 overflow-y-auto">
                  <MarkdownRenderer content={markdownContent} fullscreen={true} />
                </div>
              )}

              {/* JSON format (new) */}
              {!isMarkdownFormat && (
                <>
                  {/* Metadata */}
                  {Object.keys(metadata).length > 0 && (
                    <div className="mb-4">
                      <KeyValueTable data={metadata} />
                    </div>
                  )}

                  {/* Error */}
                  {error && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                      <div className="text-sm font-bold text-red-800 mb-1">Error</div>
                      <div className="text-sm text-red-700 whitespace-pre-wrap">{error}</div>
                    </div>
                  )}

                  {/* Warning */}
                  {warning && (
                    <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                      <div className="text-sm font-bold text-yellow-800 mb-1">Warning</div>
                      <div className="text-sm text-yellow-700 whitespace-pre-wrap">{warning}</div>
                    </div>
                  )}

                  {/* Diff */}
                  {diff && (
                    <div className="flex-1 overflow-y-auto">
                      <div className="text-sm font-bold mb-2">Diff</div>
                      <div className="border rounded-md p-4 bg-gray-50">
                        <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                          {diff}
                        </pre>
                      </div>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )

  return (
    <div className="-my-2">
      <span className="text-gray-300 text-xs">
        {/* File icon */}
        <span className="text-gray-400">📝</span>
        {' '}
        {toolStatus === 'completed' && hasDetails ? (
          <button
            onClick={() => setIsModalOpen(true)}
            className="text-gray-300 hover:text-gray-400 hover:underline cursor-pointer"
          >
            {displayMessage}
          </button>
        ) : (
          <span>
            {displayMessage}
          </span>
        )}
        {statusIndicator && (
          <span className="inline-flex ml-1.5 text-gray-300">
            {statusIndicator}
          </span>
        )}
      </span>
      {mounted && createPortal(modalContent, document.body)}
    </div>
  )
}

