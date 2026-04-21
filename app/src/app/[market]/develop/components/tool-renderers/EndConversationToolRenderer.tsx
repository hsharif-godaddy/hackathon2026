/**
 * End Conversation Tool Renderer
 *
 * Renders nothing - the end_conversation tool is invisible to the user.
 * It's used internally to cleanly end conversations and reset agent state.
 */

import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'

/**
 * End Conversation Tool Renderer Component
 *
 * This tool is intentionally invisible - it performs internal state management
 * (ending conversation, resetting to default agent) without any UI output.
 *
 * @param _props - Tool renderer props (unused)
 * @returns null (renders nothing)
 */
export default function EndConversationToolRenderer(_props: DefaultToolRendererProps) {
  // Intentionally render nothing - this tool is for internal state management only
  return null
}
