'use client'

import { ShoppingBag } from 'lucide-react'
import { useState } from 'react'

import MarkdownRenderer from '@/app/[market]/develop/components/MarkdownRenderer'
import ToolHeader from '@/app/[market]/develop/components/tool-renderers/ToolHeader'
import ToolModal from '@/app/[market]/develop/components/tool-renderers/ToolModal'
import { useTranslations } from '@/hooks/useTranslations'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'

/**
 * Renderer for Commerce MCP skill tools:
 *   - commerce__search_tools
 *   - commerce__execute_tool
 *
 * The Commerce MCP server owns the actual tool catalog. That means the
 * raw bridge tool name is not a useful UI label, so this renderer derives
 * a friendlier label from the tool input:
 *
 *   commerce__search_tools { query: "get store info" }
 *       \u2192 "Finding commerce tools: get store info"
 *
 *   commerce__execute_tool { name: "get_store_info", arguments: {\u2026} }
 *       \u2192 "Commerce: get_store_info"
 *
 * The modal body still shows the full input/output JSON so operators
 * can debug the raw MCP payload when something goes wrong.
 */

function humanizeMcpToolName(name: string | undefined): string | null {
  if (typeof name !== 'string' || name.length === 0) return null
  // Keep the raw name \u2014 MCP tool names are already snake_case and
  // recognizable (e.g. get_store_info). Just trim and collapse underscores
  // for display in the header.
  return name.replace(/__+/g, '_').trim()
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}\u2026`
}

function buildLabel(
  toolName: string,
  input?: Record<string, unknown>,
): string {
  const isSearch =
    toolName === 'commerce__search_tools' ||
    toolName === 'commerce_search_tools' ||
    toolName === 'commerceSearchTools'
  const isExecute =
    toolName === 'commerce__execute_tool' ||
    toolName === 'commerce_execute_tool' ||
    toolName === 'commerceExecuteTool'

  if (isSearch) {
    const query = typeof input?.query === 'string' ? input.query : ''
    return query
      ? `Finding commerce tools: ${truncate(query, 60)}`
      : 'Finding commerce tools'
  }

  if (isExecute) {
    // Prefer `name` (agent\u2010side input), fall back to `tool` (server shape).
    const inner =
      humanizeMcpToolName(input?.name as string | undefined) ??
      humanizeMcpToolName(input?.tool as string | undefined)
    return inner ? `Commerce: ${inner}` : 'Running commerce tool'
  }

  if (toolName.startsWith('commerce__commerce_store_')) {
    return `Commerce: ${toolName.replace(/^commerce__/, '').replace(/_/g, ' ')}`
  }

  // Unknown \u2014 caller misrouted; fall back to the raw name.
  return toolName
}

export default function CommerceMcpToolRenderer({
  toolName,
  toolStatus,
  duration,
  input,
  result,
  error,
}: DefaultToolRendererProps) {
  const t = useTranslations()
  const [isModalOpen, setIsModalOpen] = useState(false)

  const label = buildLabel(toolName, input)
  const hasDetails = Boolean(
    result || error || (input && Object.keys(input).length > 0),
  )

  const formatDuration = (ms?: number) => {
    if (!ms) return ''
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  return (
    <div>
      <ToolHeader
        icon={<ShoppingBag className="w-2 h-2" />}
        displayName={label}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={() => setIsModalOpen(true)}
      />

      <ToolModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={label}
      >
        <div className="flex-1 overflow-y-auto space-y-2">
          {duration && (
            <div>
              <div className="text-sm font-bold mb-1">
                {t('builder_tools_default_duration')}
              </div>
              <div className="text-sm">{formatDuration(duration)}</div>
            </div>
          )}

          {input && Object.keys(input).length > 0 && (
            <div>
              <div className="text-sm font-bold mb-1">
                {t('builder_tools_default_arguments')}
              </div>
              <pre className="text-xs whitespace-pre-wrap font-mono bg-muted p-1.5 rounded border border-border max-h-48 overflow-y-auto">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}

          {result && !error && (
            <div>
              <div className="text-sm font-bold mb-1">
                {t('builder_tools_default_output')}
              </div>
              <div className="bg-muted p-1.5 rounded border border-border max-h-96 overflow-y-auto">
                <MarkdownRenderer
                  content={
                    typeof result === 'string'
                      ? result
                      : JSON.stringify(result, null, 2)
                  }
                  className="text-sm leading-relaxed break-words"
                />
              </div>
            </div>
          )}

          {error && (
            <div>
              <div className="text-sm font-bold mb-1 text-destructive">
                {t('builder_status_error')}
              </div>
              <div className="bg-destructive/10 border border-destructive/30 p-1.5 rounded">
                <pre className="text-xs whitespace-pre-wrap font-mono text-destructive-foreground">
                  {error}
                </pre>
              </div>
            </div>
          )}
        </div>
      </ToolModal>
    </div>
  )
}
