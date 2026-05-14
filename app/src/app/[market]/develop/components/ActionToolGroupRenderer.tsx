'use client'

import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { isHiddenToolCall } from '@/app/[market]/develop/components/actionToolGrouping'
import StatusIndicator from '@/app/[market]/develop/components/tool-renderers/StatusIndicator'
import { getToolIcon } from '@/app/[market]/develop/components/tool-renderers/toolIcons'
import type { ToolStatus } from '@/app/[market]/develop/components/types'
import type { ToolCall } from '@/stores/useStreamingConversationStore'
import { useToolDetailsModalStore } from '@/stores/useToolDetailsModalStore'
import MessageToolCallsRenderer from './MessageToolCallsRenderer'

interface ActionToolGroupRendererProps {
  toolCalls: ToolCall[]
  isActiveStream?: boolean
  isLastAssistantMessage?: boolean
}

function getActionCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'action' : 'actions'}`
}

function getAggregateStatus(toolCalls: ToolCall[]): ToolStatus {
  let hasError = false

  for (const toolCall of toolCalls) {
    if (toolCall.status === 'running') return 'running'
    if (toolCall.status === 'error' || toolCall.status === 'incomplete') hasError = true
  }

  return hasError ? 'error' : 'completed'
}

export default function ActionToolGroupRenderer({
  toolCalls,
  isActiveStream = false,
  isLastAssistantMessage = false
}: ActionToolGroupRendererProps) {
  const openToolId = useToolDetailsModalStore((s) => s.openToolId)
  const visibleToolCalls = useMemo(() => toolCalls.filter((tc) => !isHiddenToolCall(tc)), [toolCalls])
  const containsOpenTool = useMemo(
    () => !!openToolId && visibleToolCalls.some((tc) => tc.id === openToolId),
    [visibleToolCalls, openToolId]
  )
  const [isExpanded, setIsExpanded] = useState(() => containsOpenTool)
  const [justUpdated, setJustUpdated] = useState(false)
  const expandedContentRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(0)

  // Force expand when a contained tool's details modal opens, so the inner
  // renderer mounts and the modal has a host. Don't auto-collapse on close —
  // collapsing is reserved for explicit user action.
  useEffect(() => {
    if (containsOpenTool) setIsExpanded(true)
  }, [containsOpenTool])

  const aggregateStatus = useMemo(() => getAggregateStatus(visibleToolCalls), [visibleToolCalls])

  useEffect(() => {
    // Flash the pill when an existing group gains a new action (3→4, etc.).
    // Skip the initial group render (prevCountRef is 0) — the pill appearing
    // is already a clear visual change and doesn't need a flash.
    if (prevCountRef.current >= 2 && visibleToolCalls.length > prevCountRef.current) {
      setJustUpdated(true)
      const timer = setTimeout(() => setJustUpdated(false), 600)
      prevCountRef.current = visibleToolCalls.length
      return () => clearTimeout(timer)
    }
    prevCountRef.current = visibleToolCalls.length
  }, [visibleToolCalls.length])

  useEffect(() => {
    if (isExpanded && expandedContentRef.current) {
      expandedContentRef.current.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
    }
  }, [isExpanded])

  if (visibleToolCalls.length === 0) {
    return null
  }

  if (visibleToolCalls.length === 1) {
    return (
      <MessageToolCallsRenderer
        toolCalls={visibleToolCalls}
        isActiveStream={isActiveStream}
        isLastAssistantMessage={isLastAssistantMessage}
      />
    )
  }

  const actionCountLabel = getActionCountLabel(visibleToolCalls.length)

  return (
    <div className="space-y-1 pr-1">
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-label={isExpanded ? `Hide ${actionCountLabel}` : `Show ${actionCountLabel}`}
        className={clsx(
          'group/action-toggle flex w-full items-center justify-between rounded-md border px-[4px] py-1 text-left text-xs text-foreground/70 cursor-pointer transition-colors duration-500 hover:border-intents-ux-box-borderColor hover:bg-intents-ux-boxLowContrast-backgroundColor',
          justUpdated ? 'border-intents-ux-box-borderColor bg-intents-ux-boxLowContrast-backgroundColor' : 'border-transparent'
        )}
        onClick={() => setIsExpanded((currentValue) => !currentValue)}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="flex items-center gap-0.5 text-foreground/50 overflow-hidden flex-shrink min-w-0">
            {visibleToolCalls.slice(0, 15).map((toolCall, index) => (
              <span
                key={toolCall.id || index}
                className="inline-flex flex-shrink-0 items-center justify-center rounded border border-foreground/20 bg-intents-ux-box-backgroundColor p-[3px]"
              >
                {getToolIcon(toolCall.name)}
              </span>
            ))}
          </span>
          <span className="whitespace-nowrap">{actionCountLabel}</span>
          {aggregateStatus !== 'completed' && <StatusIndicator status={aggregateStatus} />}
        </span>

        <ChevronDown
          className={clsx('size-3 flex-shrink-0 transition-all', {
            'rotate-180': isExpanded,
            'opacity-0 group-hover/action-toggle:opacity-100': !isExpanded,
          })}
          aria-hidden="true"
        />
      </button>

      {isExpanded && (
        <div ref={expandedContentRef} className="space-y-1 ml-1 pl-2 border-l-2 border-foreground/10 animate-in fade-in duration-150">
          <MessageToolCallsRenderer
            toolCalls={toolCalls}
            isActiveStream={isActiveStream}
            isLastAssistantMessage={isLastAssistantMessage}
          />
        </div>
      )}
    </div>
  )
}
