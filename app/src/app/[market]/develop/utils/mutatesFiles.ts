import { isFileMutationToolName } from '@/app/[market]/develop/utils/fileMutationTools'
import type { ToolCall } from '@/stores/useStreamingConversationStore'

export function mutatesFiles(tc: ToolCall): boolean {
  if (!isFileMutationToolName(tc.name)) return false
  if (
    (tc.name === 'str_replace_based_edit_tool' || tc.name === 'textEditor' || tc.name === 'text_editor') &&
    tc.input?.command === 'view'
  ) {
    return false
  }
  return true
}
