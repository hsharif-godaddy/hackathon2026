'use client'

import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import Button from '@ux/button'
import XThickIcon from '@ux/icon/x-thick'
import MarkdownRenderer from '@/app/develop/components/MarkdownRenderer'
import KeyValueTable from './KeyValueTable'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'

/**
 * Extract filename from path
 */
function getFilename(path: string): string {
  return path.split('/').pop() || path
}

/**
 * Determine if file is markdown based on extension
 */
function isMarkdownFile(path: string): boolean {
  return path.toLowerCase().endsWith('.md') || path.toLowerCase().endsWith('.markdown')
}

/**
 * Strip line numbers from content (format: "   123|content")
 */
function stripLineNumbers(content: string): string {
  return content
    .split('\n')
    .map(line => {
      const match = line.match(/^\s*\d+\|(.*)$/)
      return match ? match[1] : line
    })
    .join('\n')
}

/**
 * Custom renderer for readFile tool
 * 
 * Shows "Read File: {filename}" with a document icon.
 * Clickable to show modal with file contents.
 * Markdown files are rendered, others shown as code.
 */
export default function ReadFileToolRenderer({
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

  // Extract file info from input and result
  let filePath = ''
  let filename = ''
  let fileContent = ''
  let metadata: Record<string, any> = {}

  if (input && typeof input === 'object') {
    const inputObj = input as any
    filePath = inputObj.path || ''
    filename = getFilename(filePath)
    
    if (inputObj.startLine) {
      metadata['Start Line'] = inputObj.startLine
    }
    if (inputObj.numLines) {
      metadata['Number of Lines'] = inputObj.numLines
    }
  }

  if (result && typeof result === 'string') {
    // Parse the result string to extract metadata and content
    const lines = result.split('\n')
    let contentStartIndex = 0
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.startsWith('File: ')) {
        const extractedPath = line.substring(6).trim()
        if (!filePath) {
          filePath = extractedPath
          filename = getFilename(extractedPath)
        }
      } else if (line.startsWith('Lines ')) {
        metadata['Lines Read'] = line.substring(6).trim()
      } else if (line.startsWith('Total lines: ')) {
        metadata['Total Lines'] = line.substring(13).trim()
      } else if (line.startsWith('File size: ')) {
        metadata['File Size'] = line.substring(11).trim()
      } else if (line.trim() === '') {
        contentStartIndex = i + 1
        break
      }
    }
    
    fileContent = lines.slice(contentStartIndex).join('\n')
  }

  const hasContent = Boolean(fileContent)
  const isMarkdown = isMarkdownFile(filePath)
  const cleanContent = stripLineNumbers(fileContent)

  // Add full path to metadata
  if (filePath) {
    metadata = { 'Full Path': filePath, ...metadata }
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
              <h2 className="text-xl font-bold mb-4">{filename}</h2>

              {/* Metadata */}
              {Object.keys(metadata).length > 0 && (
                <div className="mb-4">
                  <KeyValueTable data={metadata} />
                </div>
              )}

              {/* Content area with scroll */}
              <div className="flex-1 overflow-y-auto border rounded-md p-4 bg-gray-50">
                {isMarkdown ? (
                  <MarkdownRenderer
                    content={cleanContent}
                    className="text-sm leading-relaxed"
                  />
                ) : (
                  <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                    {fileContent}
                  </pre>
                )}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )

  return (
    <div className="-my-2">
      <span className="text-gray-300 text-xs">
        {/* Document icon */}
        <span className="text-gray-400">📄</span>
        {' '}
        {toolStatus === 'completed' && hasContent ? (
          <button
            onClick={() => setIsModalOpen(true)}
            className="text-gray-300 hover:text-gray-400 hover:underline cursor-pointer"
          >
            Read File: {filename}
          </button>
        ) : (
          <span>
            Read File{filename && `: ${filename}`}
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

