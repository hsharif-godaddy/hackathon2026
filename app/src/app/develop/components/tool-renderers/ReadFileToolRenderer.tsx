'use client'

import { File } from 'lucide-react'
import { useEffect,useState } from 'react'

import MarkdownRenderer from '@/app/develop/components/MarkdownRenderer'
import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import KeyValueTable from '@/app/develop/components/tool-renderers/KeyValueTable'
import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import ToolModal from '@/app/develop/components/tool-renderers/ToolModal'
import { useTranslations } from '@/hooks/useTranslations'

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
  toolName: _toolName,
  toolStatus,
  input,
  result
}: DefaultToolRendererProps) {
  const t = useTranslations();
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

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
      metadata[t('builder_tools_read_file_start_line')] = inputObj.startLine
    }
    if (inputObj.numLines) {
      metadata[t('builder_tools_read_file_number_lines')] = inputObj.numLines
    }
  }

  if (result && typeof result === 'string') {
    // Parse the result string to extract metadata and content
    const lines = result.split('\n')
    let contentStartIndex = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.startsWith(`${t('builder_common_file')}: `)) {
        const extractedPath = line.substring(6).trim()
        if (!filePath) {
          filePath = extractedPath
          filename = getFilename(extractedPath)
        }
      } else if (line.startsWith('Lines ')) {
        metadata[t('builder_tools_read_file_lines_read')] = line.substring(6).trim()
      } else if (line.startsWith('Total lines: ')) {
        metadata[t('builder_tools_file_edit_metadata_lines_total')] = line.substring(13).trim()
      } else if (line.startsWith('File size: ')) {
        metadata[t('builder_tools_read_file_size')] = line.substring(11).trim()
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

  const modalContent = (
    <ToolModal
      isOpen={isModalOpen}
      onClose={() => setIsModalOpen(false)}
      title={filename}
      mounted={mounted}
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

  const displayName = filename ? `${t('builder_tools_read_file_title')}: ${filename}` : t('builder_tools_read_file_title')

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
