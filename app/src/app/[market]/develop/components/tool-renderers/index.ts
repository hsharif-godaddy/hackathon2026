/**
 * Tool Renderer Registry
 *
 * Central registry for all available tool renderer components.
 * Maps tool names to their custom React components.
 *
 * Tools not in the registry will use the DefaultToolRenderer.
 */

import AskQuestionToolRenderer from './AskQuestionToolRenderer'
import ColorSchemeToolRenderer from './ColorSchemeToolRenderer'
import CommerceInstallStorefrontToolRenderer from './CommerceInstallStorefrontToolRenderer'
import CommerceToolRenderer from './CommerceToolRenderer'
import CssColorToolRenderer from './CssColorToolRenderer'
import CssSuggestToolRenderer from './CssSuggestToolRenderer'
import DefaultToolRenderer, { type DefaultToolRendererProps } from './DefaultToolRenderer'
import DomainToolRenderer from './DomainToolRenderer'
import EndConversationToolRenderer from './EndConversationToolRenderer'
import FileEditToolRenderer from './FileEditToolRenderer'
import FontThemeToolRenderer from './FontThemeToolRenderer'
import GrepSearchToolRenderer from './GrepSearchToolRenderer'
import HandoffToolRenderer from './HandoffToolRenderer'
import ImageGeneratorToolRenderer from './ImageGeneratorToolRenderer'
import LogoActionsToolRenderer from './LogoActionsToolRenderer'
import LogoGeneratorToolRenderer from './LogoGeneratorToolRenderer'
import MediaSearchToolRenderer from './MediaSearchToolRenderer'
import MediaSlotToolRenderer from './MediaSlotToolRenderer'
import OAuthToolRenderer from './OAuthToolRenderer'
import PublishClientToolRenderer from './PublishClientToolRenderer'
import QRCodeToolRenderer from './QRCodeToolRenderer'
import ReadFileToolRenderer from './ReadFileToolRenderer'
import RebuildPageSelectorToolRenderer from './RebuildPageSelectorToolRenderer'
import SecretsToolRenderer from './SecretsToolRenderer'
import SetProjectNameToolRenderer from './SetProjectNameToolRenderer'
import SetVentureLogoToolRenderer from './SetVentureLogoToolRenderer'
import SkillToolRenderer from './SkillToolRenderer'
import SocialConnectToolRenderer from './SocialConnectToolRenderer'
import SocialPostCreateToolRenderer from './SocialPostCreateToolRenderer'
import SocialPublishToolRenderer from './SocialPublishToolRenderer'
import SuggestedResponseToolRenderer from './SuggestedResponseToolRenderer'
import TerminalCommandToolRenderer from './TerminalCommandToolRenderer'
import TextEditorToolRenderer from './TextEditorToolRenderer'
import TodoListToolRenderer from './TodoListToolRenderer'
import ValidateCodeToolRenderer from './ValidateCodeToolRenderer'
import VideoGeneratorToolRenderer from './VideoGeneratorToolRenderer'
import WebsiteRebuildToolRenderer from './WebsiteRebuildToolRenderer'

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
  askQuestion: AskQuestionToolRenderer,
  colorScheme: ColorSchemeToolRenderer,
  commerce__setup_store: CommerceToolRenderer,
  commerce__fetch_catalog: CommerceToolRenderer,
  commerce__install_storefront: CommerceInstallStorefrontToolRenderer,
  commerce__manage_products: CommerceToolRenderer,
  commerce__manage_inventory: CommerceToolRenderer,
  commerce__manage_pricing: CommerceToolRenderer,
  commerce__manage_media: CommerceToolRenderer,
  commerce__get_orders: CommerceToolRenderer,
  cssColor: CssColorToolRenderer,
  cssSuggest: CssSuggestToolRenderer,
  'custom-domain__domainPurchase': DomainToolRenderer,
  fontTheme: FontThemeToolRenderer,
  socialPostCreate: SocialPostCreateToolRenderer,
  socialPostPublish: SocialPublishToolRenderer,
  end_conversation: EndConversationToolRenderer,
  grepSearch: GrepSearchToolRenderer,
  handoff: HandoffToolRenderer,
  readFile: ReadFileToolRenderer,
  fileEdit: FileEditToolRenderer,
  str_replace_based_edit_tool: TextEditorToolRenderer,
  textEditor: TextEditorToolRenderer, // Legacy name for old chat history
  terminalCommand: TerminalCommandToolRenderer,
  media: MediaSlotToolRenderer,
  mediaSearch: MediaSearchToolRenderer,
  todoList: TodoListToolRenderer,
  validateCode: ValidateCodeToolRenderer,
  suggestedResponse: SuggestedResponseToolRenderer,
  oauthConnect: OAuthToolRenderer,
  qrCode: QRCodeToolRenderer,
  requestSecrets: SecretsToolRenderer,
  setProjectName: SetProjectNameToolRenderer,
  socialConnect: SocialConnectToolRenderer,
  skill: SkillToolRenderer,
  publishClient: PublishClientToolRenderer,
  publishing__publish: PublishClientToolRenderer,
  websiteRebuild: WebsiteRebuildToolRenderer,
  rebuildPageSelector: RebuildPageSelectorToolRenderer,
  'media-logo__generate_logo': LogoGeneratorToolRenderer,
  'media-logo__edit_logo': LogoGeneratorToolRenderer,
  'media-logo__offer_logo_actions': LogoActionsToolRenderer,
  'media-logo__set_venture_logo': SetVentureLogoToolRenderer,
  'media-image__generate_image': ImageGeneratorToolRenderer,
  'media-image__edit_image': ImageGeneratorToolRenderer,
  'media-video__generate_video': VideoGeneratorToolRenderer,
  // Legacy names for existing chat history
  media__generate_logo: LogoGeneratorToolRenderer,
  media__generate_image: ImageGeneratorToolRenderer,
  media__edit_image: ImageGeneratorToolRenderer,
  media__generate_video: VideoGeneratorToolRenderer,
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
  AskQuestionToolRenderer,
  ColorSchemeToolRenderer,
  CommerceInstallStorefrontToolRenderer,
  CommerceToolRenderer,
  CssColorToolRenderer,
  CssSuggestToolRenderer,
  DefaultToolRenderer,
  DomainToolRenderer,
  EndConversationToolRenderer,
  FileEditToolRenderer,
  FontThemeToolRenderer,
  GrepSearchToolRenderer,
  HandoffToolRenderer,
  ImageGeneratorToolRenderer,
  LogoGeneratorToolRenderer,
  MediaSearchToolRenderer,
  MediaSlotToolRenderer,
  OAuthToolRenderer,
  PublishClientToolRenderer,
  QRCodeToolRenderer,
  ReadFileToolRenderer,
  RebuildPageSelectorToolRenderer,
  SecretsToolRenderer,
  SetProjectNameToolRenderer,
  SkillToolRenderer,
  SocialPostCreateToolRenderer,
  SocialPublishToolRenderer,
  SuggestedResponseToolRenderer,
  TerminalCommandToolRenderer,
  TextEditorToolRenderer,
  TodoListToolRenderer,
  VideoGeneratorToolRenderer,
  WebsiteRebuildToolRenderer,
}
export type { DefaultToolRendererProps }
