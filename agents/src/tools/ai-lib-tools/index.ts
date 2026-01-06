/**
 * AI-Lib Tools Registry
 * Central registry that imports all converted tools from individual files
 */

import type { Tool } from '@airo/ai-lib';

// Import all individual tools
export { fileEdit } from './file-edit.js';
export { directoryListingAITool } from './directory-listing.js';
export { terminalCommandAITool } from './terminal-command.js';
export { readFileAITool } from './read-file.js';
export { grepSearchAITool } from './grep-search.js';
export { serverRestartAITool, serverStatusAITool } from './server-management.js';
export { mediaSearchAITool } from './media-tools.js';
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
export {
  commerceStore,
  commerceSearchSkuGroups,
  commerceSetupIntegration,
  commerceSkuGroup,
  commerceSku,
  commerceInventory,
  commerceSkuGroupMedia,
} from './commerce-tools.js';
export { oauthConnect } from './oauth-tool.js';
export { socialConnect } from './social-connect.js';
export { socialStatus } from './social-status.js';
export { socialPostCreateAITool } from './social-post-create.js';
export { colorSchemeAITool } from './color-scheme.js';

export { skillAITool } from './skill-loader.js';
export { websiteScraperAITool } from './website-scraper.js';

// Re-import for registry
import { fileEdit } from './file-edit.js';
import { directoryListingAITool } from './directory-listing.js';
import { terminalCommandAITool } from './terminal-command.js';
import { readFileAITool } from './read-file.js';
import { grepSearchAITool } from './grep-search.js';
import { serverRestartAITool, serverStatusAITool } from './server-management.js';
import { mediaSearchAITool } from './media-tools.js';
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
import {
  commerceSetupIntegration,
  commerceStore,
  commerceSearchSkuGroups,
  commerceSkuGroup,
  commerceSku,
  commerceInventory,
  commerceSkuGroupMedia,
} from './commerce-tools.js';
import { oauthConnect } from './oauth-tool.js';
import { socialConnect } from './social-connect.js';
import { socialStatus } from './social-status.js';
import { socialPostCreateAITool } from './social-post-create.js';
import { colorSchemeAITool } from './color-scheme.js';
import { skillAITool } from './skill-loader.js';
import { websiteScraperAITool } from './website-scraper.js';

/**
 * Complete registry of all AI-Lib converted tools
 * Use this for agents that need access to all tools
 */
export const allAILibTools: Record<string, Tool> = {
  fileEdit: fileEdit,
  directoryListing: directoryListingAITool,
  terminalCommand: terminalCommandAITool,
  readFile: readFileAITool,
  grepSearch: grepSearchAITool,
  serverRestart: serverRestartAITool,
  serverStatus: serverStatusAITool,
  mediaSearch: mediaSearchAITool,
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
  cssColor: cssColorAITool,
  cssSuggest: cssSuggestAITool,
  suggestedResponse: suggestedResponseAITool,
  seoAnalysis: seoAnalyze,
  oauthConnect: oauthConnect,
  commerceSetupIntegration: commerceSetupIntegration,
  commerceStore: commerceStore,
  commerceSearchSkuGroups: commerceSearchSkuGroups,
  commerceSkuGroup: commerceSkuGroup,
  commerceSku: commerceSku,
  commerceInventory: commerceInventory,
  socialConnect: socialConnect,
  socialStatus: socialStatus,
  socialPostCreate: socialPostCreateAITool,
  skill: skillAITool,
  commerceSkuGroupMedia: commerceSkuGroupMedia,
  websiteScraper: websiteScraperAITool,
};

/**
 * Grouped tool sets for specific use cases
 */
export const toolGroups: Record<string, Record<string, Tool>> = {
  // Core development tools
  core: {
    fileEdit: fileEdit,
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

  // Commerce tools
  commerce: {
    oauthConnect: oauthConnect,
    setupIntegration: commerceSetupIntegration,
    store: commerceStore,
    searchSkuGroups: commerceSearchSkuGroups,
    skuGroup: commerceSkuGroup,
    sku: commerceSku,
    inventory: commerceInventory,
    skuGroupMedia: commerceSkuGroupMedia,
  },

  // Media and content tools
  media: {
    mediaSearch: mediaSearchAITool,
    iconsValidator: iconsValidatorAITool,
    ragSearch: ragSearchAITool,
    knowBSearch: knowBSearchAITool,
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
    socialConnect: socialConnect,
    socialStatus: socialStatus,
    socialPostCreate: socialPostCreateAITool,
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
  commerceTools: Object.keys(toolGroups.commerce!).length,
  mediaTools: Object.keys(toolGroups.media!).length,
  debugTools: Object.keys(toolGroups.debug!).length,
  planningTools: Object.keys(toolGroups.planning!).length,
  marketingTools: Object.keys(toolGroups.marketing!).length,
};
