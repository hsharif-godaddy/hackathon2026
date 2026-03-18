/**
 * Grep Search Tool Renderer
 *
 * Displays grep/text search results with a summary and expandable details.
 */

import { TextSearch } from 'lucide-react'
import { useState } from 'react'

import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import ToolModal from '@/app/develop/components/tool-renderers/ToolModal'
import { useTranslations } from '@/hooks/useTranslations'

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
  const t = useTranslations();
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Parse the result to extract match count and file count
  let matchCount = 0
  let fileCount = 0
  let query = ''
  let hasResults = false

  if (result && typeof result === 'string') {
    // Extract query from input
    if (input && typeof input === 'object') {
      if ('pattern' in input) query = String(input.pattern)
      else if ('query' in input) query = String(input.query)
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
  let displayMessage = t('builder_tools_grep_title')
  if (query) {
    displayMessage = `${t('builder_tools_grep_title')}: "${query}"`
  }
  if (hasResults && matchCount > 0) {
    displayMessage += `${t('builder_tools_grep_matches', { matchCount, fileCount })}`
    displayMessage += ` - ${t('builder_tools_grep_no_matches')}`
  }

  const hasDetails = result && typeof result === 'string' && result.length > 0

  const modalContent = (
      <ToolModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={`${t('builder_tools_grep_results_title')}: ${query || 'grep'}`}
    >
      <div className="flex-1 overflow-y-auto">
        <pre className="text-sm font-mono whitespace-pre-wrap break-words bg-muted p-2 rounded border border-border">
          {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
        </pre>
      </div>
    </ToolModal>
  )

  return (
    <div>
      <ToolHeader
        icon={<TextSearch className="w-2 h-2" />}
        displayName={displayMessage}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={() => setIsModalOpen(true)}
      />
      {modalContent}
    </div>
  )
}
