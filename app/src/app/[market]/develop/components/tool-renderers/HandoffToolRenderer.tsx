'use client'

import { Bot } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import Collapsible from '@ux/collapsible'

import MarkdownRenderer from '@/app/[market]/develop/components/MarkdownRenderer'
import { completePartialJson } from '@/app/[market]/develop/components/tool-renderers/json-completion-utils'
import { useTranslations } from '@/hooks/useTranslations'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import KeyValueTable from './KeyValueTable'
import ToolHeader from './ToolHeader'
import ToolModal from './ToolModal'

/**
 * Get agent display name from agent ID
 */
function getAgentDisplayName(agentId: string, t: (key: string) => string): string {
  const nameMap: Record<string, string> = {
    'api': t('builder_tools_handoff_display_api'),
    'develop': t('builder_tools_handoff_display_develop'),
    'database': t('builder_tools_handoff_display_database'),
    'color-scheme': t('builder_tools_handoff_display_color'),
    'colorScheme': t('builder_tools_handoff_display_color'),
    'marketing': t('builder_tools_handoff_display_marketing')
  }
  return nameMap[agentId] || agentId
}

/**
 * Parse partial or complete JSON input to extract planTitle and prompt word count.
 * Returns null fields when parsing is not yet possible (early in stream).
 */
function parseStreamingHandoff(input: string): { planTitle: string | null; wordCount: number | null; targetAgent: string | null } {
  if (!input || input.length < 10) {
    return { planTitle: null, wordCount: null, targetAgent: null }
  }

  let parsed: any = null

  try {
    parsed = JSON.parse(input)
  } catch {
    const completed = completePartialJson(input)
    if (completed) {
      try {
        parsed = JSON.parse(completed)
      } catch {
        return { planTitle: null, wordCount: null, targetAgent: null }
      }
    }
  }

  if (!parsed) {
    return { planTitle: null, wordCount: null, targetAgent: null }
  }

  const planTitle = typeof parsed.planTitle === 'string' && parsed.planTitle.trim()
    ? parsed.planTitle.trim()
    : null

  const targetAgent = typeof parsed.targetAgent === 'string' && parsed.targetAgent.trim()
    ? parsed.targetAgent.trim()
    : null

  let wordCount: number | null = null
  if (typeof parsed.prompt === 'string' && parsed.prompt.trim()) {
    wordCount = parsed.prompt.trim().split(/\s+/).length
  }

  return { planTitle, wordCount, targetAgent }
}

/**
 * Custom renderer for handoff tool.
 *
 * Two display modes based on whether planTitle is present:
 *
 * Plan mode (planTitle provided — strategic handoffs like initial→develop):
 *   - running:   "Building a plan: {title}... 245 words"
 *   - completed: "Plan: {title}" (clickable)
 *
 * Routing mode (no planTitle — task routing like develop↔marketing):
 *   - running:   "Now talking with {Agent}" + spinner
 *   - completed: "Talked with {Agent}" (clickable)
 */
export default function HandoffToolRenderer({
  toolName: _toolName,
  toolStatus,
  input,
  result,
  partialInput
}: DefaultToolRendererProps) {
  const t = useTranslations()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const lastWordCountRef = useRef<number | null>(null)
  const lastPlanTitleRef = useRef<string | null>(null)
  const lastTargetAgentRef = useRef<string | null>(null)

  // Track planTitle, word count, and targetAgent from streaming input via effect
  useEffect(() => {
    if (toolStatus === 'running' && partialInput) {
      const streaming = parseStreamingHandoff(partialInput)
      if (streaming.planTitle !== null) lastPlanTitleRef.current = streaming.planTitle
      if (streaming.wordCount !== null) lastWordCountRef.current = streaming.wordCount
      if (streaming.targetAgent !== null) lastTargetAgentRef.current = streaming.targetAgent
    }
  }, [toolStatus, partialInput])

  // Extract target agent from final input/result, falling back to streaming value
  let targetAgent: string | null = null
  if (input && typeof input === 'object') {
    const inputObj = input as any
    const rawAgent = inputObj.targetAgent || inputObj.target_agent || ''
    if (rawAgent) targetAgent = getAgentDisplayName(rawAgent, t)
  }
  if (result && typeof result === 'object') {
    const resultObj = result as any
    if (resultObj.targetAgent) {
      targetAgent = getAgentDisplayName(resultObj.targetAgent, t)
    }
  }
  if (!targetAgent && lastTargetAgentRef.current) {
    targetAgent = getAgentDisplayName(lastTargetAgentRef.current, t)
  }

  // Read planTitle from final input (normalized), falling back to streaming value
  const rawFinalPlanTitle = (input as any)?.planTitle
  const finalPlanTitle = typeof rawFinalPlanTitle === 'string' && rawFinalPlanTitle.trim()
    ? rawFinalPlanTitle.trim()
    : null
  const planTitle = finalPlanTitle ?? lastPlanTitleRef.current

  const hasDetails = Boolean(input || result)

  // Extract prompt and other arguments for modal
  let prompt: string | null = null
  let otherArguments: Record<string, any> = {}

  if (input && typeof input === 'object') {
    const inputObj = input as Record<string, any>
    if (inputObj.prompt && typeof inputObj.prompt === 'string') {
      prompt = inputObj.prompt
      otherArguments = Object.fromEntries(
        Object.entries(inputObj).filter(([key]) => key !== 'prompt')
      )
    } else {
      otherArguments = inputObj
    }
  }

  // Build display name based on mode and status.
  // Default to "Planning" while running — partial JSON may not have planTitle yet.
  // Only show "Now talking with" when completed with no planTitle.
  let displayName: string
  if (planTitle) {
    if (toolStatus === 'running') {
      const wordCount = lastWordCountRef.current
      displayName = wordCount
        ? `${t('builder_tools_handoff_planning')} ${wordCount} words`
        : t('builder_tools_handoff_planning')
    } else {
      displayName = t('builder_tools_handoff_plan', { planTitle })
    }
  } else if (toolStatus === 'running') {
    const wordCount = lastWordCountRef.current
    displayName = wordCount
      ? `${t('builder_tools_handoff_planning')} ${wordCount} words`
      : t('builder_tools_handoff_planning')
  } else {
    const agentDisplay = targetAgent ?? t('builder_tools_handoff_display_unknown')
    displayName = t('builder_tools_handoff_talking_with', { targetAgent: agentDisplay })
  }

  const agentForModal = targetAgent ?? t('builder_tools_handoff_display_unknown')
  const modalTitle = planTitle ?? t('builder_tools_handoff_to', { targetAgent: agentForModal })

  const modalContent = (
    <ToolModal
      isOpen={isModalOpen}
      onClose={() => setIsModalOpen(false)}
      title={modalTitle}
    >
      <div className="flex-1 overflow-y-auto space-y-4">
        {prompt && (
          <div>
            {!planTitle && <h3 className="text-sm font-semibold mb-2">Prompt</h3>}
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <MarkdownRenderer content={prompt} />
            </div>
          </div>
        )}

        {Object.keys(otherArguments).length > 0 && (
          <Collapsible
            id="handoff-arguments"
            title={t('builder_tools_default_arguments')}
            defaultOpen={false}
          >
            <KeyValueTable data={otherArguments} />
          </Collapsible>
        )}

        {result && typeof result === 'object' && (
          <KeyValueTable data={result as Record<string, any>} title={t('builder_tools_default_result')} />
        )}
      </div>
    </ToolModal>
  )

  return (
    <div>
      <ToolHeader
        icon={<Bot className="w-2 h-2" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={() => setIsModalOpen(true)}
      />
      {modalContent}
    </div>
  )
}
