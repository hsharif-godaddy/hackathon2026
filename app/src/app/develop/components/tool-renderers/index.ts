/**
 * Tool Renderer Registry
 *
 * Central registry for all available tool renderer components.
 * Maps tool names to their custom React components.
 *
 * Tools not in the registry will use the DefaultToolRenderer.
 */

import CssColorToolRenderer from './CssColorToolRenderer'
import CssSuggestToolRenderer from './CssSuggestToolRenderer'
import EndConversationToolRenderer from './EndConversationToolRenderer'
import GrepSearchToolRenderer from './GrepSearchToolRenderer'
import HandoffToolRenderer from './HandoffToolRenderer'
import ReadFileToolRenderer from './ReadFileToolRenderer'
import FileEditToolRenderer from './FileEditToolRenderer'
import TerminalCommandToolRenderer from './TerminalCommandToolRenderer'
import GitOperationToolRenderer from './GitOperationToolRenderer'
import ImageSearchToolRenderer from './ImageSearchToolRenderer'
import MediaSearchToolRenderer from './MediaSearchToolRenderer'
import TodoListToolRenderer from './TodoListToolRenderer'
import SuggestedResponseToolRenderer from './SuggestedResponseToolRenderer'
import OAuthToolRenderer from './OAuthToolRenderer'
import DefaultToolRenderer, { type DefaultToolRendererProps } from './DefaultToolRenderer'

/**
 * Tool renderer component props type
 */
export type ToolRendererProps = DefaultToolRendererProps

/**
 * Tool renderer registry mapping tool names to components
 *
 * Add custom renderers here for specific tools that need special visualization.
 * Example:
 *   'file_edit': FileEditToolRenderer,
 *   'image_search': ImageSearchToolRenderer,
 */
export const toolRendererRegistry = {
  cssColor: CssColorToolRenderer,
  cssSuggest: CssSuggestToolRenderer,
  end_conversation: EndConversationToolRenderer,
  grepSearch: GrepSearchToolRenderer,
  handoff: HandoffToolRenderer,
  readFile: ReadFileToolRenderer,
  fileEdit: FileEditToolRenderer,
  terminalCommand: TerminalCommandToolRenderer,
  gitOperation: GitOperationToolRenderer,
  mediaSearch: MediaSearchToolRenderer,
  imageSearch: ImageSearchToolRenderer,
  todoList: TodoListToolRenderer,
  suggestedResponse: SuggestedResponseToolRenderer,
  oauthConnect: OAuthToolRenderer,
} as const

/**
 * Tool renderer type names
 */
export type RegisteredToolType = keyof typeof toolRendererRegistry

/**
 * Check if a tool has a custom renderer
 */
export function hasCustomRenderer(toolName: string): toolName is RegisteredToolType {
  return toolName in toolRendererRegistry
}

/**
 * Get tool renderer component by tool name
 *
 * Returns a custom renderer if one is registered for the tool,
 * otherwise returns the DefaultToolRenderer.
 *
 * @param toolName - Name of the tool to get renderer for
 * @returns Tool renderer component
 */
export function getToolRenderer(toolName: string) {
  if (hasCustomRenderer(toolName)) {
    return toolRendererRegistry[toolName]
  }
  return DefaultToolRenderer
}

/**
 * Export tool renderer components
 */
export { CssColorToolRenderer, CssSuggestToolRenderer, EndConversationToolRenderer, GrepSearchToolRenderer, HandoffToolRenderer, ReadFileToolRenderer, FileEditToolRenderer, TerminalCommandToolRenderer, GitOperationToolRenderer, MediaSearchToolRenderer, ImageSearchToolRenderer, TodoListToolRenderer, SuggestedResponseToolRenderer, OAuthToolRenderer, DefaultToolRenderer }
export type { DefaultToolRendererProps }
