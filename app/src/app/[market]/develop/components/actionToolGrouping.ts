import type { ToolCall } from '@/stores/useStreamingConversationStore'
import type { ContentBlock } from './contentBlocks'

// Convert snake_case / skill__tool names to camelCase so a single canonical
// list handles both variants.
function toCamelCase(name: string): string {
  return name.replace(/_+([a-z])/g, (_, c) => c.toUpperCase())
}

// Allowlist of tools known to render as compact one-line action rows (camelCase canonical form).
// New tools default to standalone rendering until explicitly opted in,
// so interactive/rich tools are never accidentally hidden in a group.
const ACTION_GROUP_TOOL_NAMES = new Set([
  'appPlan',
  'codeSearch',
  'codebaseSearch',
  'directoryListing',
  'fileEdit',
  'fileRead',
  'gitOperation',
  'grepSearch',
  'iconsValidator',
  'mysqlOperation',
  'readFile',
  'runCommand',
  'serverRestart',
  'serverStatus',
  'setProjectName',
  'strReplaceBasedEditTool',
  'terminal',
  'terminalCommand',
  'textEditor',
  'todoList',
  'validateCode',
  'viewLogs',
  'websiteScraper',
  'skill',
  'httpCheck',
  'listDesignSystems',
  'installDesignSystem',
  'loadUiKit',
  // Commerce MCP skill tools
  'commerceSearchTools',
  'commerceExecuteTool',
  'commerceCommerceStoreSetup',
  'commerceCommerceStoreList',
  'commerceCommerceStoreGet',
  'commerceCommerceStoreChannelsGet',
  'commerceCommerceStoreChannelEnsure',
  // Hidden tools (render as null) — must be groupable so they don't break action groups
  'returnToParent',
])

export function isMediaSlotTool(name?: string): boolean {
  return name === 'media'
}

// todoList operations whose renderer returns null
const TODO_LIST_HIDDEN_OPS = new Set(['mark_done', 'mark_undone', 'mark_in_progress', 'show_list'])

// System/internal tools that must never render as a chat-transcript row: they
// drive builder UI state (setWizardStep advances the design-kit wizard stepper),
// run as preflight (listDesignSystems loads the kit catalog), or surface their
// output through a dedicated widget rather than the transcript (suggestDesignKits
// drives the vibe picker — DesignKitSelectorPanel). The tool result still reaches
// the agent and the widget; only the noisy transcript row is suppressed.
// camelCase canonical form (matches toCamelCase normalization).
const SYSTEM_HIDDEN_TOOL_NAMES = new Set([
  'setWizardStep',
  'listDesignSystems',
  'suggestDesignKits',
])

/**
 * True when a tool call is an internal/system tool that should never appear in
 * the chat transcript — it exists only to drive a UI side effect. Callers
 * filter these out of the rendered tool stream entirely.
 */
export function isSystemHiddenToolCall(toolCall?: ToolCall): boolean {
  if (!toolCall?.name) return false
  return SYSTEM_HIDDEN_TOOL_NAMES.has(toCamelCase(toolCall.name))
}

export function isActionToolGroupEligible(toolCall?: ToolCall): boolean {
  if (!toolCall?.name) return false

  return ACTION_GROUP_TOOL_NAMES.has(toCamelCase(toolCall.name))
}

export function isHiddenToolCall(toolCall: ToolCall): boolean {
  return toCamelCase(toolCall.name) === 'todoList' &&
    TODO_LIST_HIDDEN_OPS.has(toolCall.input?.operation as string)
}

function groupConsecutiveToolBlocks(
  blocks: ContentBlock[],
  predicate: (block: ContentBlock) => boolean,
  groupType: ContentBlock['type'],
  splitTrailingRunning = false
): ContentBlock[] {
  const result: ContentBlock[] = []
  let group: ContentBlock[] = []

  const flush = () => {
    let toGroup = group
    let trailing: ContentBlock[] = []

    // When splitTrailingRunning is enabled, peel off trailing running tools
    // so they render as visible standalone blocks below the collapsed group.
    if (splitTrailingRunning && toGroup.length > 0) {
      let splitIndex = toGroup.length
      while (splitIndex > 0 && toGroup[splitIndex - 1]!.toolCall?.status === 'running') {
        splitIndex--
      }
      if (splitIndex < toGroup.length) {
        trailing = toGroup.slice(splitIndex)
        toGroup = toGroup.slice(0, splitIndex)
      }
    }

    if (toGroup.length > 1) {
      result.push({
        type: groupType,
        toolCalls: toGroup.map((block) => block.toolCall!).filter(Boolean),
        order: toGroup[0]!.order,
      })
    } else if (toGroup.length === 1) {
      result.push(toGroup[0]!)
    }

    // Emit trailing running tools as standalone blocks
    for (const block of trailing) {
      result.push(block)
    }

    group = []
  }

  for (const block of blocks) {
    if (block.type === 'tool' && predicate(block)) {
      group.push(block)
    } else {
      flush()
      result.push(block)
    }
  }

  flush()

  return result
}

export function groupConsecutiveMediaTools(blocks: ContentBlock[]): ContentBlock[] {
  return groupConsecutiveToolBlocks(blocks, (block) => isMediaSlotTool(block.toolCall?.name), 'tool-group')
}

export function groupConsecutiveActionTools(blocks: ContentBlock[]): ContentBlock[] {
  return groupConsecutiveToolBlocks(blocks, (block) => isActionToolGroupEligible(block.toolCall), 'action-group', true)
}
