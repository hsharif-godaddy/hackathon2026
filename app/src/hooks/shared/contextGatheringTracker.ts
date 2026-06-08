import { shipAnalyticsLog } from '@/lib/logging'
import { logImpressionEvent } from '@/utils/instrumentation'

const QUESTION_TOOLS = new Set(['askQuestion', 'suggestedResponse'])

const GATHER_PHASE_TOOLS = new Set([
  'askQuestion', 'suggestedResponse',
  'setProjectName', 'todoList', 'memorySet',
  'colorScheme', 'fontTheme', 'brandBook',
])

let gathering = false
let trackedAppId: string | null = null

interface ToolLike {
  name: string
  input?: { command?: string }
}

/**
 * Call on every tool_result event. Fires at the same point as develop.tool.*.impression:
 * - Question tool results enter gathering (fires `started` once per Q&A phase)
 * - Any non-gather tool result ends gathering (fires `completed`)
 * - Gather-phase tools (branding, project name, etc.) are neutral
 * - Read-only editor views are neutral
 * - Gathering persists across agent turns until a non-gather tool fires
 */
export function trackFromToolResult(
  tool: ToolLike,
  appId: string | null,
  hasError: boolean,
): void {
  if (hasError) return

  if (appId !== trackedAppId) {
    if (gathering) {
      fireCompleted(trackedAppId)
    }
    trackedAppId = appId
  }

  if (QUESTION_TOOLS.has(tool.name)) {
    if (!gathering) {
      gathering = true
      fireStarted(appId)
    }
    return
  }

  if (!gathering) return

  if (isReadOnlyView(tool)) return

  if (!GATHER_PHASE_TOOLS.has(tool.name)) {
    fireCompleted(appId)
  }
}

export function isGathering(): boolean {
  return gathering
}

export function reset(): void {
  gathering = false
  trackedAppId = null
}

function isReadOnlyView(tool: ToolLike): boolean {
  if (tool.name !== 'str_replace_based_edit_tool' && tool.name !== 'textEditor') return false
  return tool.input?.command === 'view'
}

function fireStarted(appId: string | null): void {
  shipAnalyticsLog('funnel.context_gathering.started', { appId })
  logImpressionEvent('develop.contextGathering.started', { appId: appId ?? '' })()
}

function fireCompleted(appId: string | null): void {
  shipAnalyticsLog('funnel.context_gathering.completed', { appId })
  logImpressionEvent('develop.contextGathering.completed', { appId: appId ?? '' })()
  gathering = false
}
