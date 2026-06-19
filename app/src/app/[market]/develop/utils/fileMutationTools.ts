// Mutation tool names for preview edit-turn detection (isMutatingFiles, override guard).
// Intentionally distinct from FILE_EDIT_TOOLS (build overlay) and FILE_OPERATION_TOOLS (handler).
export const FILE_MUTATION_TOOL_NAMES = new Set([
  'fileEdit',
  'file_edit',
  'str_replace_based_edit_tool',
  'textEditor',
  'text_editor',
  'write_file',
  'writeFile',
])

export function isFileMutationToolName(toolName: string): boolean {
  return FILE_MUTATION_TOOL_NAMES.has(toolName)
}
