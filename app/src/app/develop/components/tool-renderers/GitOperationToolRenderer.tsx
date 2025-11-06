'use client'

import React, { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import Button from '@ux/button'
import XThickIcon from '@ux/icon/x-thick'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'

/**
 * Git Operation Tool Renderer
 * 
 * Displays git operation results with operation-specific formatting.
 * Shows a one-line summary with expandable details in a modal.
 */
export default function GitOperationToolRenderer({
  input,
  result,
  toolStatus
}: DefaultToolRendererProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  // Parse result
  let parsedResult: any = null
  if (result && typeof result === 'string') {
    try {
      parsedResult = JSON.parse(result)
    } catch {
      parsedResult = { output: result }
    }
  } else if (result && typeof result === 'object') {
    parsedResult = result
  }

  // Extract operation from input
  const operation = input && typeof input === 'object' && 'operation' in input
    ? String(input.operation)
    : 'unknown'

  // Build display message
  let displayMessage = `Git: ${operation}`
  
  if (parsedResult) {
    if (parsedResult.success === false && parsedResult.error) {
      displayMessage = `Git ${operation}: Error`
    } else if (operation === 'status' && parsedResult.status) {
      const { branch, isClean, ahead, behind } = parsedResult.status
      let statusText = branch ? `on ${branch}` : ''
      if (ahead || behind) {
        statusText += ` (${ahead || 0}↑ ${behind || 0}↓)`
      }
      if (isClean) {
        statusText += ' - clean'
      }
      displayMessage = `Git status: ${statusText}`
    } else if (operation === 'commit' && parsedResult.success) {
      displayMessage = `Git commit: Success`
    } else if (operation === 'log' && parsedResult.commits) {
      displayMessage = `Git log: ${parsedResult.commits.length} commit${parsedResult.commits.length !== 1 ? 's' : ''}`
    } else if (operation === 'branch' && parsedResult.branches) {
      displayMessage = `Git branch: ${parsedResult.branches.length} branch${parsedResult.branches.length !== 1 ? 'es' : ''}`
    } else if (operation === 'diff') {
      displayMessage = `Git diff: ${parsedResult.diff ? 'Changes found' : 'No changes'}`
    }
  }

  const hasDetails = Boolean(parsedResult && (parsedResult.output || parsedResult.diff || parsedResult.commits || parsedResult.branches))

  /**
   * Render the result content as HTML
   */
  function renderResultHTML(): React.JSX.Element {
    if (!parsedResult) {
      return <div className="text-sm text-gray-500">No result data</div>
    }

    return (
      <div className="space-y-4">
        {/* Error */}
        {parsedResult.error && (
          <div className="bg-red-50 border border-red-200 rounded p-3">
            <div className="text-sm font-semibold text-red-800 mb-1">Error</div>
            <div className="text-sm text-red-700">{parsedResult.error}</div>
          </div>
        )}

        {/* Warning */}
        {parsedResult.warning && (
          <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
            <div className="text-sm font-semibold text-yellow-800 mb-1">Warning</div>
            <div className="text-sm text-yellow-700">{parsedResult.warning}</div>
          </div>
        )}

        {/* Status */}
        {parsedResult.status && (
          <div>
            <h3 className="text-base font-semibold text-gray-800 mb-2">Status</h3>
            <div className="bg-gray-50 rounded p-3 space-y-1 text-sm">
              {parsedResult.status.branch && (
                <div><strong>Branch:</strong> {parsedResult.status.branch}</div>
              )}
              {typeof parsedResult.status.ahead === 'number' && (
                <div><strong>Ahead:</strong> {parsedResult.status.ahead} commit{parsedResult.status.ahead !== 1 ? 's' : ''}</div>
              )}
              {typeof parsedResult.status.behind === 'number' && (
                <div><strong>Behind:</strong> {parsedResult.status.behind} commit{parsedResult.status.behind !== 1 ? 's' : ''}</div>
              )}
              {typeof parsedResult.status.isClean === 'boolean' && (
                <div><strong>Working tree:</strong> {parsedResult.status.isClean ? 'Clean' : 'Modified'}</div>
              )}
            </div>
          </div>
        )}

        {/* Commits */}
        {parsedResult.commits && parsedResult.commits.length > 0 && (
          <div>
            <h3 className="text-base font-semibold text-gray-800 mb-2">
              Commits ({parsedResult.commits.length})
            </h3>
            <div className="space-y-2">
              {parsedResult.commits.map((commit: any, index: number) => (
                <div key={commit.hash || index} className="bg-gray-50 rounded p-3 border border-gray-200">
                  <div className="flex items-start gap-2 mb-1">
                    <span className="font-mono text-xs bg-gray-200 px-2 py-0.5 rounded">
                      {commit.hash?.substring(0, 7) || 'unknown'}
                    </span>
                    <span className="text-xs text-gray-600">{commit.date}</span>
                  </div>
                  <div className="text-sm text-gray-900 mb-1">{commit.message}</div>
                  <div className="text-xs text-gray-600">{commit.author}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Branches */}
        {parsedResult.branches && parsedResult.branches.length > 0 && (
          <div>
            <h3 className="text-base font-semibold text-gray-800 mb-2">
              Branches ({parsedResult.branches.length})
            </h3>
            <div className="bg-gray-50 rounded p-3">
              <div className="space-y-1">
                {parsedResult.branches.map((branch: string, index: number) => {
                  const isCurrent = branch.startsWith('* ')
                  const branchName = isCurrent ? branch.substring(2) : branch
                  return (
                    <div key={index} className="text-sm font-mono">
                      {isCurrent && <span className="text-green-600 font-bold">* </span>}
                      <span className={isCurrent ? 'text-green-700 font-semibold' : 'text-gray-700'}>
                        {branchName}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Diff */}
        {parsedResult.diff && (
          <div>
            <h3 className="text-base font-semibold text-gray-800 mb-2">Diff</h3>
            <pre className="text-xs font-mono whitespace-pre-wrap bg-gray-50 p-3 rounded border border-gray-200 overflow-x-auto">
              {parsedResult.diff}
            </pre>
          </div>
        )}

        {/* Output */}
        {parsedResult.output && !parsedResult.diff && (
          <div>
            <h3 className="text-base font-semibold text-gray-800 mb-2">Output</h3>
            <pre className="text-sm font-mono whitespace-pre-wrap bg-gray-50 p-3 rounded border border-gray-200">
              {parsedResult.output}
            </pre>
          </div>
        )}
      </div>
    )
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
              className="max-w-3xl w-full bg-intents-ux-box-backgroundColor p-6 rounded-lg shadow-xl relative max-h-[85vh] flex flex-col"
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
              <h2 className="text-xl font-bold mb-4">
                Git: {operation}
              </h2>

              {/* Content */}
              <div className="flex-1 overflow-y-auto">
                {renderResultHTML()}
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
        {/* Git icon */}
        <span className="text-gray-400">🔀</span>
        {' '}
        {toolStatus === 'completed' && hasDetails ? (
          <button
            onClick={() => setIsModalOpen(true)}
            className="text-gray-300 hover:text-gray-400 hover:underline cursor-pointer"
          >
            {displayMessage}
          </button>
        ) : toolStatus === 'running' ? (
          <span className="inline-flex items-center gap-1">
            <span className="animate-spin">⏳</span>
            {displayMessage}
          </span>
        ) : (
          <span>
            {displayMessage}
          </span>
        )}
      </span>

      {mounted && createPortal(modalContent, document.body)}
    </div>
  )
}
