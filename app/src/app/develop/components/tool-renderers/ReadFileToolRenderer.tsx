'use client'

import { useState, useEffect } from 'react'
import MarkdownRenderer from '@/app/develop/components/MarkdownRenderer'
import KeyValueTable from './KeyValueTable'
import ToolHeader from './ToolHeader'
import ToolModal from './ToolModal'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import { File } from 'lucide-react'

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

  const displayName = filename ? `Read File: ${filename}` : 'Read File'

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
