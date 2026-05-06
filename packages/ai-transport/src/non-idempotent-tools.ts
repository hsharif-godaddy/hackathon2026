/**
 * Tools that are NOT safe to re-execute on retry after a mid-stream budget error.
 * These tools create external state that cannot be undone by re-running.
 *
 * Matched by base tool name (after stripping skill namespace prefix).
 * E.g., "commerce__manage_products" matches "manage_products".
 *
 * Matching is case-insensitive after stripping skill namespace prefix (e.g., "commerce__" removed).
 * Commerce tools use snake_case (manage_products), core tools use camelCase (socialPostPublish).
 *
 * Update this list when adding new skill tools with non-idempotent side effects.
 */
const NON_IDEMPOTENT_TOOL_NAMES = new Set([
  'socialpostpublish',
  'manage_products',
  'manage_inventory',
  'manage_pricing',
  'manage_media',
  'insertrow',
  'updaterow',
  'deleterow',
])

/**
 * Extract the base tool name from a potentially skill-namespaced tool name.
 * "commerce__manage_products" -> "manage_products"
 * "socialPostPublish" -> "socialpostpublish"
 */
function getBaseToolName(toolName: string): string {
  const lower = toolName.toLowerCase()
  const parts = lower.split('__')
  return parts[parts.length - 1] ?? lower
}

/**
 * Check if any of the executed tool names are non-idempotent.
 * Used to decide between retry (Layer 2) and continuation (Layer 3)
 * after a mid-stream budget exceeded error.
 */
export function hasNonIdempotentTools(executedToolNames: string[]): boolean {
  return executedToolNames.some(name => NON_IDEMPOTENT_TOOL_NAMES.has(getBaseToolName(name)))
}
