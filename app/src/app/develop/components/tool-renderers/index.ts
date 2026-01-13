/**
 * Tool Renderer Registry
 *
 * Central registry for all available tool renderer components.
 * Maps tool names to their custom React components.
 *
 * Tools not in the registry will use the DefaultToolRenderer.
 */

import ColorSchemeToolRenderer from './ColorSchemeToolRenderer'
import CssColorToolRenderer from './CssColorToolRenderer'
import CssSuggestToolRenderer from './CssSuggestToolRenderer'
import DefaultToolRenderer, { type DefaultToolRendererProps } from './DefaultToolRenderer'
import EndConversationToolRenderer from './EndConversationToolRenderer'
import FileEditToolRenderer from './FileEditToolRenderer'
import FontThemeToolRenderer from './FontThemeToolRenderer'
import GrepSearchToolRenderer from './GrepSearchToolRenderer'
import HandoffToolRenderer from './HandoffToolRenderer'
import ImageSearchToolRenderer from './ImageSearchToolRenderer'
import MediaSearchToolRenderer from './MediaSearchToolRenderer'
import OAuthToolRenderer from './OAuthToolRenderer'
import PublishClientToolRenderer from './PublishClientToolRenderer'
import QRCodeToolRenderer from './QRCodeToolRenderer'
import ReadFileToolRenderer from './ReadFileToolRenderer'
import SecretsToolRenderer from './SecretsToolRenderer'
import SetProjectNameToolRenderer from './SetProjectNameToolRenderer'
import SkillToolRenderer from './SkillToolRenderer'
import SocialConnectToolRenderer from './SocialConnectToolRenderer'
import SocialPostCreateToolRenderer from './SocialPostCreateToolRenderer'
import SocialPublishToolRenderer from './SocialPublishToolRenderer'
import SocialStatusToolRenderer from './SocialStatusToolRenderer'
import SuggestedResponseToolRenderer from './SuggestedResponseToolRenderer'
import TerminalCommandToolRenderer from './TerminalCommandToolRenderer'
import TodoListToolRenderer from './TodoListToolRenderer'

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
  colorScheme: ColorSchemeToolRenderer,
  cssColor: CssColorToolRenderer,
  cssSuggest: CssSuggestToolRenderer,
  fontTheme: FontThemeToolRenderer,
  socialPostCreate: SocialPostCreateToolRenderer,
  socialPostPublish: SocialPublishToolRenderer,
  end_conversation: EndConversationToolRenderer,
  grepSearch: GrepSearchToolRenderer,
  handoff: HandoffToolRenderer,
  readFile: ReadFileToolRenderer,
  fileEdit: FileEditToolRenderer,
  terminalCommand: TerminalCommandToolRenderer,
  mediaSearch: MediaSearchToolRenderer,
  imageSearch: ImageSearchToolRenderer,
  todoList: TodoListToolRenderer,
  suggestedResponse: SuggestedResponseToolRenderer,
  oauthConnect: OAuthToolRenderer,
  qrCode: QRCodeToolRenderer,
  requestSecrets: SecretsToolRenderer,
  setProjectName: SetProjectNameToolRenderer,
  socialStatus: SocialStatusToolRenderer,
  socialConnect: SocialConnectToolRenderer,
  skill: SkillToolRenderer,
  publishClient: PublishClientToolRenderer,
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
export {
  ColorSchemeToolRenderer,
  CssColorToolRenderer,
  CssSuggestToolRenderer,
  DefaultToolRenderer,
  EndConversationToolRenderer,
  FileEditToolRenderer,
  FontThemeToolRenderer,
  GrepSearchToolRenderer,
  HandoffToolRenderer,
  ImageSearchToolRenderer,
  MediaSearchToolRenderer,
  OAuthToolRenderer,
  PublishClientToolRenderer,
  QRCodeToolRenderer,
  ReadFileToolRenderer,
  SecretsToolRenderer,
  SetProjectNameToolRenderer,
  SkillToolRenderer,
  SocialPostCreateToolRenderer,
  SocialPublishToolRenderer,
  SuggestedResponseToolRenderer,
  TerminalCommandToolRenderer,
  TodoListToolRenderer,
}
export type { DefaultToolRendererProps }
