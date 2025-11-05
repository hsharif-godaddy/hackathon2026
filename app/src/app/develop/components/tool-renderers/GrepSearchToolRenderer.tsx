/**
 * Grep Search Tool Renderer
 * 
 * Displays grep/text search results with a summary and expandable details.
 */

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'

/**
 * Grep Search Tool Renderer Component
 * 
 * Shows a one-line summary of search results with a clickable link to view
 * the full search output in a modal.
 */
export default function GrepSearchToolRenderer({ 
  input,
  result, 
  toolStatus 
}: DefaultToolRendererProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)

  const getStatusIndicator = () => {
    switch (toolStatus) {
      case 'running':
        return '⏳'
      case 'completed':
        return '🔍'
      case 'error':
        return '❌'
      default:
        return '🔍'
    }
  }

  const statusIndicator = getStatusIndicator()

  // Parse the result to extract match count and file count
  let matchCount = 0
  let fileCount = 0
  let query = ''
  let hasResults = false

  if (result && typeof result === 'string') {
    // Extract query from input
    if (input && typeof input === 'object' && 'query' in input) {
      query = String(input.query)
    }

    // Parse result string to extract counts
    const matchPattern = /Found (\d+) matches in (\d+) files/
    const match = result.match(matchPattern)
    if (match) {
      matchCount = parseInt(match[1], 10)
      fileCount = parseInt(match[2], 10)
      hasResults = true
    } else if (result.includes('No matches found')) {
      hasResults = false
    }
  }

  // Build display message
  let displayMessage = 'Search'
  if (query) {
    displayMessage = `Search: "${query}"`
  }
  if (hasResults && matchCount > 0) {
    displayMessage += ` - ${matchCount} ${matchCount === 1 ? 'match' : 'matches'} in ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`
  } else if (typeof result === 'string' && result.includes('No matches found')) {
    displayMessage += ' - No matches found'
  }

  const hasDetails = result && typeof result === 'string' && result.length > 0

  return (
    <>
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <span>{statusIndicator}</span>
        {hasDetails ? (
          <button
            onClick={() => setIsModalOpen(true)}
            className="hover:text-blue-600 hover:underline cursor-pointer"
          >
            {displayMessage}
          </button>
        ) : (
          <span>{displayMessage}</span>
        )}
      </div>

      {/* Modal for detailed results */}
      {isModalOpen && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setIsModalOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="px-6 py-4 border-b bg-gray-50 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">
                  Search Results: {query || 'grep'}
                </h2>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                >
                  ×
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-6">
                <pre className="text-sm font-mono whitespace-pre-wrap break-words bg-gray-50 p-4 rounded border">
                  {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
                </pre>
              </div>

              {/* Footer */}
              <div className="px-6 py-3 border-t bg-gray-50 flex justify-end">
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}

