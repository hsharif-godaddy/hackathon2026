/**
 * Grep Search Tool Renderer
 * 
 * Displays grep/text search results with a summary and expandable details.
 */

import { useState, useEffect } from 'react'
import ToolHeader from './ToolHeader'
import ToolModal from './ToolModal'
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
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

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

  const modalContent = (
    <ToolModal
      isOpen={isModalOpen}
      onClose={() => setIsModalOpen(false)}
      title={`Search Results: ${query || 'grep'}`}
      mounted={mounted}
    >
      <div className="flex-1 overflow-y-auto">
        <pre className="text-sm font-mono whitespace-pre-wrap break-words bg-muted p-4 rounded border border-border">
          {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
        </pre>
      </div>
    </ToolModal>
  )

  return (
    <div className="-my-2">
      <ToolHeader
        icon="🔍"
        displayName={displayMessage}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={() => setIsModalOpen(true)}
      />
      {modalContent}
    </div>
  )
}

