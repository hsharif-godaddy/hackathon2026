/**
 * AI-Lib Tools Registry
 * Central registry that imports all converted tools from individual files
 */

import type { Tool } from '@airo/ai-lib';

// Import all individual tools
export { textEditorAITool, textEditorSchemaAITool } from './text-editor.js';
export { directoryListingAITool } from './directory-listing.js';
export { terminalCommandAITool } from './terminal-command.js';
export { readFileAITool } from './read-file.js';
export { loadUiKitAITool } from './load-ui-kit.js';
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
export { requestSecrets } from './secrets-tool.js';
export { socialRead } from './social-read.js';
export { socialPostCreateAITool } from './social-post-create.js';
export { socialPostPublish } from './social-post-publish.js';
export { colorSchemeAITool } from './color-scheme.js';
export { fontThemeAITool } from './font-theme.js';

export { skillAITool } from './skill-loader.js';
export { websiteScraperAITool } from './website-scraper.js';
export { qaAnalyzeAITool } from './qa-analyze.js';
export { setProjectNameAITool } from './set-project-name.js';
export { askQuestionAITool } from './ask-question.js';
export { logoCompletionSuggestionsAITool } from './logo-completion-suggestions.js';
export { qrCodeAITool } from './qr-code.js';
export { websiteRebuildAITool } from './website-rebuild.js';
export { rebuildPageSelectorAITool } from './rebuild-page-selector.js';
export { mediaSlotAITool } from './media-slot.js';
export { brandIdentityAITool } from './brand-identity.js';
export { brandAITool } from './brand.js';
export { httpCheckAITool } from './http-check.js';
export { listDesignSystemsAITool } from './list-design-systems.js'
export { installDesignSystemAITool } from './install-design-system.js'
export { showDocAITool } from './show-doc.js';
export { runAgentAITool, awaitAgentsAITool } from './run-agent.js'
export { returnToParentAITool } from './return-to-parent.js';
export { setWizardStepAITool } from './set-wizard-step.js';

// Re-import for registry
import { textEditorAITool } from './text-editor.js';
import { directoryListingAITool } from './directory-listing.js';
import { terminalCommandAITool } from './terminal-command.js';
import { readFileAITool } from './read-file.js';
import { loadUiKitAITool } from './load-ui-kit.js';
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
import { requestSecrets } from './secrets-tool.js';
import { socialRead } from './social-read.js';
import { socialPostCreateAITool } from './social-post-create.js';
import { socialPostPublish } from './social-post-publish.js';
import { colorSchemeAITool } from './color-scheme.js';
import { fontThemeAITool } from './font-theme.js';
import { skillAITool } from './skill-loader.js';
import { websiteScraperAITool } from './website-scraper.js';
import { qaAnalyzeAITool } from './qa-analyze.js';
import { setProjectNameAITool } from './set-project-name.js';
import { askQuestionAITool } from './ask-question.js';
import { logoCompletionSuggestionsAITool } from './logo-completion-suggestions.js';
import { qrCodeAITool } from './qr-code.js';
import { websiteRebuildAITool } from './website-rebuild.js';
import { rebuildPageSelectorAITool } from './rebuild-page-selector.js';
import { mediaSlotAITool } from './media-slot.js';
import { brandIdentityAITool } from './brand-identity.js';
import { brandAITool } from './brand.js';
import { httpCheckAITool } from './http-check.js';
import { listDesignSystemsAITool } from './list-design-systems.js';
import { installDesignSystemAITool } from './install-design-system.js';
import { showDocAITool } from './show-doc.js';
import { runAgentAITool, awaitAgentsAITool } from './run-agent.js'
import { returnToParentAITool } from './return-to-parent.js';
import { setWizardStepAITool } from './set-wizard-step.js';
import { screenshotAITool } from './screenshot.js';
import { crawlPagesAITool } from './crawl-pages.js';
import { registerPostEditHandler } from './post-edit-handlers.js';
import { seoRoutesPostEditHandler } from '../../services/seo-routes-post-edit-handler.js';
import { seoPagePostEditHandler } from '../../services/seo-page-post-edit-handler.js';
import { getPageSeoGaps } from '../../services/SeoPageRegistry.js';
import { todoListTool } from '../todo-list-tool.js';

// Wire template-/feature-specific post-edit side effects into the generic text
// editor here, at the tool composition root — the editor itself stays
// template-agnostic. Registration is idempotent by handler name.
registerPostEditHandler(seoRoutesPostEditHandler);
registerPostEditHandler(seoPagePostEditHandler);

// AC3: gate mark_done on SEO completeness for any page files edited this session.
todoListTool.setSeoGapsChecker(getPageSeoGaps);

/**
 * Complete registry of all AI-Lib converted tools
 * Use this for agents that need access to all tools
 */
export const allAILibTools: Record<string, Tool> = {
  str_replace_based_edit_tool: textEditorAITool,  // Native Anthropic text_editor_20250728
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
  knowledgeSearch: knowBSearchAITool,
  widgetRender: widgetRenderAITool,
  colorScheme: colorSchemeAITool,
  fontTheme: fontThemeAITool,
  cssColor: cssColorAITool,
  cssSuggest: cssSuggestAITool,
  suggestedResponse: suggestedResponseAITool,
  seoAnalysis: seoAnalyze,
  requestSecrets: requestSecrets,
  socialRead: socialRead,
  socialPostCreate: socialPostCreateAITool,
  socialPostPublish: socialPostPublish,
  skill: skillAITool,
  websiteScraper: websiteScraperAITool,
  qaAnalyze: qaAnalyzeAITool,
  setProjectName: setProjectNameAITool,
  askQuestion: askQuestionAITool,
  logoCompletionSuggestions: logoCompletionSuggestionsAITool,
  qrCode: qrCodeAITool,
  websiteRebuild: websiteRebuildAITool,
  rebuildPageSelector: rebuildPageSelectorAITool,
  media: mediaSlotAITool,
  brandBook: brandIdentityAITool,
  brand: brandAITool,
  loadUiKit: loadUiKitAITool,
  httpCheck: httpCheckAITool,
  listDesignSystems: listDesignSystemsAITool,
  installDesignSystem: installDesignSystemAITool,
  showDoc: showDocAITool,
  runAgent: runAgentAITool,
  awaitAgents: awaitAgentsAITool,
  returnToParent: returnToParentAITool,
  setWizardStep: setWizardStepAITool,
  screenshot: screenshotAITool,
  crawlPages: crawlPagesAITool,
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
  },

  // Backend tools (empty - database operations removed)
  backend: {},

  // Media and content tools
  media: {
    mediaSlot: mediaSlotAITool,
    imageEditor: imageEditorAITool,
    iconsValidator: iconsValidatorAITool,
    ragSearch: ragSearchAITool,
    knowledgeSearch: knowBSearchAITool,
    qrCode: qrCodeAITool,
  },

  // Monitoring and debugging tools
  debug: {
    viewLogs: viewLogsAITool,
    grepSearch: grepSearchAITool,
    readFile: readFileAITool,
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
    socialRead: socialRead,
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
