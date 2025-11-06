'use client'

import { useState, useEffect } from 'react'
import KeyValueTable from './KeyValueTable'
import MarkdownRenderer from '../MarkdownRenderer'
import ToolHeader from './ToolHeader'
import ToolModal from './ToolModal'
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

  const modalContent = (
    <ToolModal
      isOpen={isModalOpen}
      onClose={() => setIsModalOpen(false)}
      title="Terminal Command"
      mounted={mounted}
    >
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
              <div className="border border-border rounded-md p-3 bg-muted">
                <pre className="text-xs font-mono text-foreground/80 break-all whitespace-pre-wrap">{originalCommand}</pre>
              </div>
              <div className="text-sm font-bold mb-2 mt-3">Transformed Command</div>
              <div className="border border-border rounded-md p-3 bg-muted">
                <pre className="text-xs font-mono text-foreground/80 break-all whitespace-pre-wrap">{command}</pre>
              </div>
            </div>
          ) : (
            <div>
              <div className="text-sm font-bold mb-2">Command</div>
              <div className="border border-border rounded-md p-3 bg-muted">
                <pre className="text-xs font-mono text-foreground/80 break-all whitespace-pre-wrap">{command}</pre>
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
            <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-md">
              <div className="text-sm font-bold text-destructive mb-1">Error</div>
              <div className="text-sm text-destructive-foreground whitespace-pre-wrap">{error}</div>
            </div>
          )}

          {/* Standard Output */}
          {stdout && (
            <div>
              <div className="text-sm font-bold mb-2">Standard Output</div>
              <div className="border border-border rounded-md p-4 bg-muted">
                <pre className="text-xs font-mono whitespace-pre-wrap break-words text-foreground/80">
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
    </ToolModal>
  )

  const displayName = `Terminal: ${displayCommand}`

  return (
    <div className="-my-2">
      <ToolHeader
        icon="💻"
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={() => setIsModalOpen(true)}
      />
      {modalContent}
    </div>
  )
}

