'use client'

import { File } from 'lucide-react'

import MarkdownRenderer from '@/app/[market]/develop/components/MarkdownRenderer'
import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import KeyValueTable from '@/app/[market]/develop/components/tool-renderers/KeyValueTable'
import ToolHeader from '@/app/[market]/develop/components/tool-renderers/ToolHeader'
import ToolModal from '@/app/[market]/develop/components/tool-renderers/ToolModal'
import { useTranslations } from '@/hooks/useTranslations'
import { useToolDetailsModal } from '@/stores/useToolDetailsModalStore'

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
 * Strip line numbers from content (cat -n format: "   123\tcontent" or legacy "   123|content")
 */
function stripLineNumbers(content: string): string {
  return content
    .split('\n')
    .map(line => {
      const match = line.match(/^\s*\d+[\t|](.*)$/)
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
  toolName: _toolName,
  toolStatus,
  toolId,
  input,
  result
}: DefaultToolRendererProps) {
  const t = useTranslations();
  const [isModalOpen, setIsModalOpen] = useToolDetailsModal(toolId)

  // Extract file info from input and result
  let filePath = ''
  let filename = ''
  let fileContent = ''
  let metadata: Record<string, any> = {}
  let offset: number | undefined
  let limit: number | undefined

  if (input && typeof input === 'object') {
    const inputObj = input as any
    filePath = inputObj.path || ''
    filename = getFilename(filePath)

    // Support both new (offset/limit) and legacy (startLine/numLines) params for history compat
    if (inputObj.offset != null) {
      offset = inputObj.offset
      metadata[t('builder_tools_read_file_start_line')] = offset + 1
    } else if (inputObj.startLine) {
      offset = inputObj.startLine - 1
      metadata[t('builder_tools_read_file_start_line')] = inputObj.startLine
    }
    if (inputObj.limit != null) {
      limit = inputObj.limit
      metadata[t('builder_tools_read_file_number_lines')] = limit
    } else if (inputObj.numLines) {
      limit = inputObj.numLines
      metadata[t('builder_tools_read_file_number_lines')] = inputObj.numLines
    }
  }

  if (result && typeof result === 'string') {
    // New format: just cat-n numbered content (no header).
    // Legacy format: "path [N lines]\n" header followed by numbered content.
    const lines = result.split('\n')
    const firstLineIsHeader = /^\S+ \[\d+(-\d+)?( of \d+| lines\])/.test(lines[0] || '')

    if (firstLineIsHeader) {
      // Legacy: skip the header line
      fileContent = lines.slice(1).join('\n')
    } else {
      fileContent = result
    }
  }

  const hasContent = Boolean(fileContent)
  const isMarkdown = isMarkdownFile(filePath)
  const cleanContent = stripLineNumbers(fileContent)

  // Add full path to metadata
  if (filePath) {
    metadata = { 'Full Path': filePath, ...metadata }
  }

  const modalContent = (
    <ToolModal
      isOpen={isModalOpen}
      onClose={() => setIsModalOpen(false)}
      title={filename}
    >
      {/* Metadata */}
      {Object.keys(metadata).length > 0 && (
        <div className="mb-2">
          <KeyValueTable data={metadata} />
        </div>
      )}

      {/* Content area with scroll */}
      <div className="flex-1 overflow-y-auto border border-border rounded-md p-2 bg-muted">
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
    </ToolModal>
  )

  // Build display name with optional range indicator
  let displayName = filename ? `${t('builder_tools_read_file_title')}: ${filename}` : t('builder_tools_read_file_title')

  // Add range indicator if only a subset was read
  if (filename && (offset != null || limit)) {
    const start = (offset ?? 0) + 1
    const end = limit ? start + limit - 1 : '...'
    displayName += ` (lines ${start}-${end})`
  }

  return (
    <div>
      <ToolHeader
        icon={<File className="w-2 h-2" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={hasContent}
        onOpenModal={() => setIsModalOpen(true)}
      />
      {modalContent}
    </div>
  )
}
