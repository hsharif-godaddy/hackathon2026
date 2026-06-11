/**
 * Tool Renderer Registry
 *
 * Central registry for all available tool renderer components.
 * Maps tool names to their custom React components.
 *
 * Tools not in the registry will use the DefaultToolRenderer.
 */

import AskQuestionToolRenderer from './AskQuestionToolRenderer'
import CampaignPlanProposeToolRenderer from './CampaignPlanProposeToolRenderer'
import CampaignPlanToolRenderer from './CampaignPlanToolRenderer'
import ColorSchemeToolRenderer from './ColorSchemeToolRenderer'
import CommerceMcpToolRenderer from './CommerceMcpToolRenderer'
import CssColorToolRenderer from './CssColorToolRenderer'
import CssSuggestToolRenderer from './CssSuggestToolRenderer'
import DefaultToolRenderer, { type DefaultToolRendererProps } from './DefaultToolRenderer'
import DesignSystemToolRenderer from './DesignSystemToolRenderer'
import DirectoryListingToolRenderer from './DirectoryListingToolRenderer'
import DomainToolRenderer from './DomainToolRenderer'
import EndConversationToolRenderer from './EndConversationToolRenderer'
import FileEditToolRenderer from './FileEditToolRenderer'
import FontThemeToolRenderer from './FontThemeToolRenderer'
import GitRestoreDiffRenderer from './GitRestoreDiffRenderer.tsx'
import GoogleReviewsToolRenderer from './GoogleReviewsToolRenderer'
import GrepSearchToolRenderer from './GrepSearchToolRenderer'
import HandoffToolRenderer from './HandoffToolRenderer'
import ImageGeneratorToolRenderer from './ImageGeneratorToolRenderer'
import LogoActionsToolRenderer from './LogoActionsToolRenderer'
import LogoGeneratorToolRenderer from './LogoGeneratorToolRenderer'
import MediaSearchToolRenderer from './MediaSearchToolRenderer'
import MediaSlotToolRenderer from './MediaSlotToolRenderer'
import PublishClientToolRenderer from './PublishClientToolRenderer'
import QRCodeToolRenderer from './QRCodeToolRenderer'
import ReadFileToolRenderer from './ReadFileToolRenderer'
import RebuildBuildPageToolRenderer from './RebuildBuildPageToolRenderer'
import RebuildPageSelectorToolRenderer from './RebuildPageSelectorToolRenderer'
import RunAgentToolRenderer from './RunAgentToolRenderer'
import SecretsToolRenderer from './SecretsToolRenderer'
import SeoAuditToolRenderer from './SeoAuditToolRenderer'
import SetProjectNameToolRenderer from './SetProjectNameToolRenderer'
import SetVentureLogoToolRenderer from './SetVentureLogoToolRenderer'
import ShowDocToolRenderer from './ShowDocToolRenderer'
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
  campaignPlanCreate: CampaignPlanToolRenderer,
  campaignPlanPropose: CampaignPlanProposeToolRenderer,
  campaignCreate: CampaignPlanToolRenderer,
  'marketing-campaigns__campaignPlanCreate': CampaignPlanToolRenderer,
  'marketing-campaigns__campaignPlanPropose': CampaignPlanProposeToolRenderer,
  'marketing-campaigns__campaignCreate': CampaignPlanToolRenderer,
  colorScheme: ColorSchemeToolRenderer,
  // Commerce MCP skill tools. Keep legacy global names for historical chat messages.
  commerce__search_tools: CommerceMcpToolRenderer,
  commerce__execute_tool: CommerceMcpToolRenderer,
  commerce__commerce_store_setup: CommerceMcpToolRenderer,
  commerce__commerce_store_list: CommerceMcpToolRenderer,
  commerce__commerce_store_get: CommerceMcpToolRenderer,
  commerce__commerce_store_channels_get: CommerceMcpToolRenderer,
  commerceSearchTools: CommerceMcpToolRenderer,
  commerce_search_tools: CommerceMcpToolRenderer,
  commerceExecuteTool: CommerceMcpToolRenderer,
  commerce_execute_tool: CommerceMcpToolRenderer,
  cssColor: CssColorToolRenderer,
  listDesignSystems: DesignSystemToolRenderer,
  installDesignSystem: DesignSystemToolRenderer,
  loadUiKit: DesignSystemToolRenderer,
  cssSuggest: CssSuggestToolRenderer,
  directoryListing: DirectoryListingToolRenderer,
  'custom-domain__domainPurchase': DomainToolRenderer,
  fontTheme: FontThemeToolRenderer,
  socialPostCreate: SocialPostCreateToolRenderer,
  socialPostPublish: SocialPublishToolRenderer,
  end_conversation: EndConversationToolRenderer,
  googleReviews: GoogleReviewsToolRenderer, // Legacy global tool (backwards compatibility)
  'google-reviews__fetchReviews': GoogleReviewsToolRenderer, // New skill-specific tool
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
  restore: GitRestoreDiffRenderer,
  suggestedResponse: SuggestedResponseToolRenderer,
  qrCode: QRCodeToolRenderer,
  requestSecrets: SecretsToolRenderer,
  seo__audit: SeoAuditToolRenderer,
  seoAnalysis: SeoAuditToolRenderer,
  setProjectName: SetProjectNameToolRenderer,
  showDoc: ShowDocToolRenderer,
  socialConnect: SocialConnectToolRenderer,
  'social-platform__socialConnect': SocialConnectToolRenderer,
  skill: SkillToolRenderer,
  publishClient: PublishClientToolRenderer,
  publishing__publish: PublishClientToolRenderer,
  returnToParent: () => null,
  runAgent: RunAgentToolRenderer,
  websiteRebuild: WebsiteRebuildToolRenderer,
  rebuildPageSelector: RebuildPageSelectorToolRenderer,
  rebuildBuildPage: RebuildBuildPageToolRenderer,
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
  CampaignPlanToolRenderer,
  ColorSchemeToolRenderer,
  CommerceMcpToolRenderer,
  CssColorToolRenderer,
  CssSuggestToolRenderer,
  DefaultToolRenderer,
  DesignSystemToolRenderer,
  DirectoryListingToolRenderer,
  DomainToolRenderer,
  EndConversationToolRenderer,
  FileEditToolRenderer,
  FontThemeToolRenderer,
  GitRestoreDiffRenderer,
  GoogleReviewsToolRenderer,
  GrepSearchToolRenderer,
  HandoffToolRenderer,
  ImageGeneratorToolRenderer,
  LogoGeneratorToolRenderer,
  MediaSearchToolRenderer,
  MediaSlotToolRenderer,
  PublishClientToolRenderer,
  QRCodeToolRenderer,
  ReadFileToolRenderer,
  RebuildBuildPageToolRenderer,
  RebuildPageSelectorToolRenderer,
  RunAgentToolRenderer,
  SecretsToolRenderer,
  SetProjectNameToolRenderer,
  ShowDocToolRenderer,
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
