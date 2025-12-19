'use client'

import { SquareTerminal } from 'lucide-react'
import { useState } from 'react'

import MarkdownRenderer from '@/app/develop/components/MarkdownRenderer'
import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import KeyValueTable from '@/app/develop/components/tool-renderers/KeyValueTable'
import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import ToolModal from '@/app/develop/components/tool-renderers/ToolModal'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'

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
  const t = useTranslations();

  const [isModalOpen, setIsModalOpen] = useState(false)

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
      logger.error('tool.terminal_command.parse.failed', {
        error: e instanceof Error ? e.message : String(e),
        resultLength: result?.length
      })
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

  const modalContent = (
    <ToolModal
      isOpen={isModalOpen}
      onClose={() => setIsModalOpen(false)}
      title={t('builder_tools_terminal_title')}
    >
      {/* Markdown format (backwards compatibility) */}
      {isMarkdownFormat && (
        <div className="flex-1 overflow-y-auto">
          <MarkdownRenderer content={markdownContent} fullscreen={true} />
        </div>
      )}

      {/* JSON format (new) */}
      {!isMarkdownFormat && (
        <div className="flex-1 overflow-y-auto space-y-2">
          {/* Command */}
          {originalCommand ? (
            <div>
              <div className="text-sm font-bold mb-1">{t('builder_tools_terminal_original')}</div>
              <div className="border border-border rounded-md p-1.5 bg-muted overflow-x-auto">
                <pre className="text-xs font-mono text-foreground/80 whitespace-pre">{originalCommand}</pre>
              </div>
              <div className="text-sm font-bold mb-1 mt-1.5">{t('builder_tools_terminal_transformed')}</div>
              <div className="border border-border rounded-md p-1.5 bg-muted overflow-x-auto">
                <pre className="text-xs font-mono text-foreground/80 whitespace-pre">{command}</pre>
              </div>
            </div>
          ) : (
            <div>
              <div className="text-sm font-bold mb-1">{t('builder_tools_terminal_command')}</div>
              <div className="border border-border rounded-md p-1.5 bg-muted overflow-x-auto">
                <pre className="text-xs font-mono text-foreground/80 whitespace-pre">{command}</pre>
              </div>
            </div>
          )}

          {/* Metadata */}
          <KeyValueTable
            data={{
              [t('builder_tools_terminal_meta_directory')]: workingDir || '.',
              [t('builder_tools_terminal_meta_exit')]: `${exitCode} ${success ? '✅' : '❌'}`,
              [t('builder_tools_terminal_meta_execution')]: `${executionTime}ms`,
              ...(timedOut ? { [t('builder_common_status')]: `⏰ ${t('builder_tools_terminal_meta_timed_out')}` } : {})
            }}
          />

          {/* Error */}
          {error && (
            <div className="p-1.5 bg-destructive/10 border border-destructive/30 rounded-md">
              <div className="text-sm font-bold text-destructive mb-0.5">{t('builder_status_error')}</div>
              <div className="text-sm text-destructive-foreground whitespace-pre-wrap">{error}</div>
            </div>
          )}

          {/* Standard Output */}
          {stdout && (
            <div>
              <div className="text-sm font-bold mb-1">{t('builder_tools_terminal_standard_output')}</div>
              <div className="border border-border rounded-md p-2 bg-muted">
                <pre className="text-xs font-mono whitespace-pre-wrap break-words text-foreground/80">
                  {stdout}
                </pre>
              </div>
            </div>
          )}

          {/* Standard Error */}
          {stderr && (
            <div>
              <div className="text-sm font-bold mb-1">{t('builder_tools_terminal_standard_error')}</div>
              <div className="border rounded-md p-2 bg-orange-50">
                <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                  {stderr}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </ToolModal>
  )

  const displayName = `${t('builder_tools_terminal_simple_title')}: ${command}`

  return (
    <div>
      <ToolHeader
        icon={<SquareTerminal className="w-2 h-2" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={() => setIsModalOpen(true)}
      />
      {modalContent}
    </div>
  )
}
