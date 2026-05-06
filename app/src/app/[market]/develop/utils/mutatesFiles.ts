import type { ToolCall } from '@/stores/useStreamingConversationStore'

// Source of truth: agents/src/tools/ — only registered mutation tools
// Cross-ref: same tool set in useInitialization.ts:253 (FILE_EDIT_TOOLS) and FileOperationHandler.ts:13-16
// If agents adds a new mutation tool, update all three.
const FILE_MUTATION_TOOL_NAMES = new Set([
  'fileEdit',
  'str_replace_based_edit_tool',
  'textEditor',
])

export function mutatesFiles(tc: ToolCall): boolean {
  if (!FILE_MUTATION_TOOL_NAMES.has(tc.name)) return false
  if (tc.name === 'str_replace_based_edit_tool' || tc.name === 'textEditor') {
    if (tc.input?.command === 'view') return false
  }
  return true
}
