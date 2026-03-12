/**
 * AI-Lib Tools Registry
 * Central registry that imports all converted tools from individual files
 */

import type { Tool } from '@airo/ai-lib';

// Import all individual tools
export { fileEditAITool } from './file-edit.js';
export { textEditorAITool } from './text-editor.js';
export { directoryListingAITool } from './directory-listing.js';
export { terminalCommandAITool } from './terminal-command.js';
export { readFileAITool } from './read-file.js';
export { grepSearchAITool } from './grep-search.js';
export { serverRestartAITool, serverStatusAITool } from './server-management.js';
export { imageEditorAITool } from '../image-editor-tool.js';
export { iconsValidatorAITool } from './icons-validator.js';
export { viewLogsAITool } from './view-logs.js';
export { appPlanAITool } from './app-plan.js';
export { todoListAITool } from './todo-list.js';
export {
  memorySetAITool,
  memoryReadAITool,
  memorySearchAITool,
  memoryListKeysAITool,
} from './memory-tool.js';
export { memoryAITool } from './memory.js';
export { ragSearchAITool } from './rag-search.js';
export { knowBSearchAITool } from './knowb-search.js';
export { widgetRenderAITool } from './widget-render.js';
export { cssColorAITool } from './css-color.js';
export { cssSuggestAITool } from './css-suggest.js';
export { suggestedResponseAITool } from './suggested-response.js';
export { seoAnalyze } from './seo-analyze.js';
export { oauthConnect } from './oauth-tool.js';
export { requestSecrets } from './secrets-tool.js';
export { socialConnect } from './social-connect.js';
export { socialPostCreateAITool } from './social-post-create.js';
export { socialPostPublish } from './social-post-publish.js';
export { colorSchemeAITool } from './color-scheme.js';
export { domainPurchaseAITool } from './domain-purchase.js';
export { fontThemeAITool } from './font-theme.js';

export { skillAITool } from './skill-loader.js';
export { websiteScraperAITool } from './website-scraper.js';
export { publishClientAITool } from './publish-client.js';
export { publishStatusAITool } from './publish-status.js';
export { qaAnalyzeAITool } from './qa-analyze.js';
export { setProjectNameAITool } from './set-project-name.js';
export { askQuestionAITool } from './ask-question.js';
export { qrCodeAITool } from './qr-code.js';
export { websiteRebuildAITool } from './website-rebuild.js';
export { rebuildPageSelectorAITool } from './rebuild-page-selector.js';
export { mediaSlotAITool } from './media-slot.js';

// Re-import for registry
import { fileEditAITool } from './file-edit.js';
import { textEditorAITool } from './text-editor.js';
import { directoryListingAITool } from './directory-listing.js';
import { terminalCommandAITool } from './terminal-command.js';
import { readFileAITool } from './read-file.js';
import { grepSearchAITool } from './grep-search.js';
import { serverRestartAITool, serverStatusAITool } from './server-management.js';
import { imageEditorAITool } from '../image-editor-tool.js';
import { iconsValidatorAITool } from './icons-validator.js';
import { viewLogsAITool } from './view-logs.js';
import { appPlanAITool } from './app-plan.js';
import { todoListAITool } from './todo-list.js';
import {
  memorySetAITool,
  memoryReadAITool,
  memorySearchAITool,
  memoryListKeysAITool,
} from './memory-tool.js';
import { memoryAITool } from './memory.js';
import { ragSearchAITool } from './rag-search.js';
import { knowBSearchAITool } from './knowb-search.js';
import { widgetRenderAITool } from './widget-render.js';
import { cssColorAITool } from './css-color.js';
import { cssSuggestAITool } from './css-suggest.js';
import { suggestedResponseAITool } from './suggested-response.js';
import { seoAnalyze } from './seo-analyze.js';
import { oauthConnect } from './oauth-tool.js';
import { requestSecrets } from './secrets-tool.js';
import { socialConnect } from './social-connect.js';
import { socialPostCreateAITool } from './social-post-create.js';
import { socialPostPublish } from './social-post-publish.js';
import { colorSchemeAITool } from './color-scheme.js';
import { domainPurchaseAITool } from './domain-purchase.js';
import { fontThemeAITool } from './font-theme.js';
import { skillAITool } from './skill-loader.js';
import { websiteScraperAITool } from './website-scraper.js';
import { publishClientAITool } from './publish-client.js';
import { publishStatusAITool } from './publish-status.js';
import { qaAnalyzeAITool } from './qa-analyze.js';
import { setProjectNameAITool } from './set-project-name.js';
import { askQuestionAITool } from './ask-question.js';
import { qrCodeAITool } from './qr-code.js';
import { websiteRebuildAITool } from './website-rebuild.js';
import { rebuildPageSelectorAITool } from './rebuild-page-selector.js';
import { mediaSlotAITool } from './media-slot.js';

/**
 * Complete registry of all AI-Lib converted tools
 * Use this for agents that need access to all tools
 */
export const allAILibTools: Record<string, Tool> = {
  str_replace_based_edit_tool: textEditorAITool,  // Native Anthropic text_editor_20250728
  fileEdit: fileEditAITool,       // LEGACY: Batch tool (deprecated, use str_replace_based_edit_tool)
  directoryListing: directoryListingAITool,
  terminalCommand: terminalCommandAITool,
  readFile: readFileAITool,
  grepSearch: grepSearchAITool,
  serverRestart: serverRestartAITool,
  serverStatus: serverStatusAITool,
  imageEditor: imageEditorAITool,
  iconsValidator: iconsValidatorAITool,
  viewLogs: viewLogsAITool,
  appPlan: appPlanAITool,
  todoList: todoListAITool,
  memorySet: memorySetAITool,
  memoryRead: memoryReadAITool,
  memorySearch: memorySearchAITool,
  memoryListKeys: memoryListKeysAITool,
  memory: memoryAITool,
  ragSearch: ragSearchAITool,
  knowBSearch: knowBSearchAITool,
  widgetRender: widgetRenderAITool,
  colorScheme: colorSchemeAITool,
  domainPurchase: domainPurchaseAITool,
  fontTheme: fontThemeAITool,
  cssColor: cssColorAITool,
  cssSuggest: cssSuggestAITool,
  suggestedResponse: suggestedResponseAITool,
  seoAnalysis: seoAnalyze,
  oauthConnect: oauthConnect,
  requestSecrets: requestSecrets,
  socialConnect: socialConnect,
  socialPostCreate: socialPostCreateAITool,
  socialPostPublish: socialPostPublish,
  skill: skillAITool,
  websiteScraper: websiteScraperAITool,
  publishClient: publishClientAITool,
  publishStatus: publishStatusAITool,
  qaAnalyze: qaAnalyzeAITool,
  setProjectName: setProjectNameAITool,
  askQuestion: askQuestionAITool,
  qrCode: qrCodeAITool,
  websiteRebuild: websiteRebuildAITool,
  rebuildPageSelector: rebuildPageSelectorAITool,
  media: mediaSlotAITool,
};

/**
 * Grouped tool sets for specific use cases
 */
export const toolGroups: Record<string, Record<string, Tool>> = {
  // Core development tools
  core: {
    str_replace_based_edit_tool: textEditorAITool,
    directoryListing: directoryListingAITool,
    readFile: readFileAITool,
    grepSearch: grepSearchAITool,
    memorySet: memorySetAITool,
    memoryRead: memoryReadAITool,
    memorySearch: memorySearchAITool,
    memoryListKeys: memoryListKeysAITool,
    memory: memoryAITool,
  },

  // System and server tools
  system: {
    terminalCommand: terminalCommandAITool,
    serverRestart: serverRestartAITool,
    serverStatus: serverStatusAITool,
    publishClient: publishClientAITool,
    publishStatus: publishStatusAITool,
  },

  // Backend tools (empty - database operations removed)
  backend: {},

  // Media and content tools
  media: {
    mediaSlot: mediaSlotAITool,
    imageEditor: imageEditorAITool,
    iconsValidator: iconsValidatorAITool,
    ragSearch: ragSearchAITool,
    knowBSearch: knowBSearchAITool,
    qrCode: qrCodeAITool,
  },

  // Monitoring and debugging tools
  debug: {
    viewLogs: viewLogsAITool,
    grepSearch: grepSearchAITool,
    readFile: readFileAITool,
    publishStatus: publishStatusAITool,
  },

  // Planning and project management
  planning: {
    appPlan: appPlanAITool,
    todoList: todoListAITool,
    directoryListing: directoryListingAITool,
  },

  // Marketing tools
  marketing: {
    seoAnalysis: seoAnalyze,
    socialConnect: socialConnect,
    socialPostCreate: socialPostCreateAITool,
    socialPostPublish: socialPostPublish,
  },
};

/**
 * Tool counts for reference
 */
export const toolStats = {
  totalTools: Object.keys(allAILibTools).length,
  coreTools: Object.keys(toolGroups.core!).length,
  systemTools: Object.keys(toolGroups.system!).length,
  backendTools: Object.keys(toolGroups.backend!).length,
  mediaTools: Object.keys(toolGroups.media!).length,
  debugTools: Object.keys(toolGroups.debug!).length,
  planningTools: Object.keys(toolGroups.planning!).length,
  marketingTools: Object.keys(toolGroups.marketing!).length,
};
