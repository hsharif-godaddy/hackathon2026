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
 * Truncate command for display
 */
function truncateCommand(cmd: string, maxLength: number = 60): string {
  if (cmd.length <= maxLength) return cmd
  return cmd.substring(0, maxLength) + '...'
}

/**
 * Custom renderer for terminalCommand tool
 * 
 * Shows compact command on one line with terminal icon.
 * Clickable to show modal with full details (command, output, errors, etc.)
 */
export default function TerminalCommandToolRenderer({
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
  let command = ''
  let originalCommand = ''
  let workingDir = ''
  let exitCode = 0
  let stdout = ''
  let stderr = ''
  let success = true
  let executionTime = 0
  let timedOut = false
  let error = ''
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
        command = parsedResult.command || ''
        originalCommand = parsedResult.originalCommand || ''
        workingDir = parsedResult.workingDir || ''
        exitCode = parsedResult.exitCode ?? 0
        stdout = parsedResult.stdout || ''
        stderr = parsedResult.stderr || ''
        success = parsedResult.success ?? true
        executionTime = parsedResult.executionTime ?? 0
        timedOut = parsedResult.timedOut ?? false
        error = parsedResult.error || ''
      }
    } catch (e) {
      console.error('Failed to parse terminalCommand result:', e)
    }
  }

  // Get command from input if not in result
  if (!command && input && typeof input === 'object') {
    const inputObj = input as any
    command = inputObj.command || ''
  }

  // Has details if we have parsed result data OR markdown content
  const hasDetails = Boolean(
    (parsedResult && (stdout || stderr || error || workingDir)) || 
    isMarkdownFormat
  )

  const displayCommand = truncateCommand(command)

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
              <h2 className="text-xl font-bold mb-4">Terminal Command</h2>

              {/* Markdown format (backwards compatibility) */}
              {isMarkdownFormat && (
                <div className="flex-1 overflow-y-auto">
                  <MarkdownRenderer content={markdownContent} fullscreen={true} />
                </div>
              )}

              {/* JSON format (new) */}
              {!isMarkdownFormat && (
                <div className="flex-1 overflow-y-auto space-y-4">
                  {/* Command */}
                  {originalCommand ? (
                    <div>
                      <div className="text-sm font-bold mb-2">Original Command</div>
                      <div className="border rounded-md p-3 bg-gray-50">
                        <pre className="text-xs font-mono text-gray-800 break-all whitespace-pre-wrap">{originalCommand}</pre>
                      </div>
                      <div className="text-sm font-bold mb-2 mt-3">Transformed Command</div>
                      <div className="border rounded-md p-3 bg-gray-50">
                        <pre className="text-xs font-mono text-gray-800 break-all whitespace-pre-wrap">{command}</pre>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="text-sm font-bold mb-2">Command</div>
                      <div className="border rounded-md p-3 bg-gray-50">
                        <pre className="text-xs font-mono text-gray-800 break-all whitespace-pre-wrap">{command}</pre>
                      </div>
                    </div>
                  )}

                  {/* Metadata */}
                  <KeyValueTable
                    data={{
                      'Working Directory': workingDir || '.',
                      'Exit Code': `${exitCode} ${success ? '✅' : '❌'}`,
                      'Execution Time': `${executionTime}ms`,
                      ...(timedOut ? { 'Status': '⏰ Timed Out' } : {})
                    }}
                  />

                  {/* Error */}
                  {error && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                      <div className="text-sm font-bold text-red-800 mb-1">Error</div>
                      <div className="text-sm text-red-700 whitespace-pre-wrap">{error}</div>
                    </div>
                  )}

                  {/* Standard Output */}
                  {stdout && (
                    <div>
                      <div className="text-sm font-bold mb-2">Standard Output</div>
                      <div className="border rounded-md p-4 bg-gray-50">
                        <pre className="text-xs font-mono whitespace-pre-wrap break-words text-gray-800">
                          {stdout}
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* Standard Error */}
                  {stderr && (
                    <div>
                      <div className="text-sm font-bold mb-2 text-orange-700">Standard Error</div>
                      <div className="border border-orange-200 rounded-md p-4 bg-orange-50">
                        <pre className="text-xs font-mono whitespace-pre-wrap break-words text-orange-900">
                          {stderr}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
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
        {/* Terminal icon */}
        <span className="text-gray-400">💻</span>
        {' '}
        {toolStatus === 'completed' && hasDetails ? (
          <button
            onClick={() => setIsModalOpen(true)}
            className="text-gray-300 hover:text-gray-400 hover:underline cursor-pointer"
          >
            Terminal: <span className="font-mono">{displayCommand}</span>
          </button>
        ) : (
          <span>
            Terminal: <span className="font-mono">{displayCommand}</span>
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

