/**
 * AI-Lib Tools Registry
 * Central registry that imports all converted tools from individual files
 */

// Import all individual tools
export { fileEditAITool } from './file-edit.js'
export { directoryListingAITool } from './directory-listing.js'
export { terminalCommandAITool } from './terminal-command.js'
export { gitOperationAITool } from './git-operation.js'
export { readFileAITool } from './read-file.js'
export { grepSearchAITool } from './grep-search.js'
export { mysqlOperationAITool } from './mysql-operation.js'
export { serverRestartAITool, serverStatusAITool } from './server-management.js'
export { imageSearchAITool, imageGenerateAITool } from './image-tools.js'
export { autoAPIGeneratorAITool } from './auto-api-generator.js'
export { iconsValidatorAITool } from './icons-validator.js'
export { viewLogsAITool } from './view-logs.js'
export { appPlanAITool } from './app-plan.js'
export { todoListAITool } from './todo-list.js'
export { memorySetAITool, memoryReadAITool, memorySearchAITool, memoryListKeysAITool } from './memory-tool.js'
export { ragSearchAITool } from './rag-search.js'
export { widgetRenderAITool } from './widget-render.js'

// Re-import for registry
import { fileEditAITool } from './file-edit.js'
import { directoryListingAITool } from './directory-listing.js'
import { terminalCommandAITool } from './terminal-command.js'
import { gitOperationAITool } from './git-operation.js'
import { readFileAITool } from './read-file.js'
import { grepSearchAITool } from './grep-search.js'
import { mysqlOperationAITool } from './mysql-operation.js'
import { serverRestartAITool, serverStatusAITool } from './server-management.js'
import { imageSearchAITool, imageGenerateAITool } from './image-tools.js'
import { autoAPIGeneratorAITool } from './auto-api-generator.js'
import { iconsValidatorAITool } from './icons-validator.js'
import { viewLogsAITool } from './view-logs.js'
import { appPlanAITool } from './app-plan.js'
import { todoListAITool } from './todo-list.js'
import { memorySetAITool, memoryReadAITool, memorySearchAITool, memoryListKeysAITool } from './memory-tool.js'
import { ragSearchAITool } from './rag-search.js'
import { widgetRenderAITool } from './widget-render.js'

/**
 * Complete registry of all AI-Lib converted tools
 * Use this for agents that need access to all tools
 */
export const allAILibTools = {
  fileEdit: fileEditAITool,
  directoryListing: directoryListingAITool,
  terminalCommand: terminalCommandAITool,
  gitOperation: gitOperationAITool,
  readFile: readFileAITool,
  grepSearch: grepSearchAITool,
  mysqlOperation: mysqlOperationAITool,
  serverRestart: serverRestartAITool,
  serverStatus: serverStatusAITool,
  imageSearch: imageSearchAITool,
  imageGenerate: imageGenerateAITool,
  autoAPIGenerator: autoAPIGeneratorAITool,
  iconsValidator: iconsValidatorAITool,
  viewLogs: viewLogsAITool,
  appPlan: appPlanAITool,
  todoList: todoListAITool,
  memorySet: memorySetAITool,
  memoryRead: memoryReadAITool,
  memorySearch: memorySearchAITool,
  memoryListKeys: memoryListKeysAITool,
  ragSearch: ragSearchAITool,
  widgetRender: widgetRenderAITool,
}

/**
 * Grouped tool sets for specific use cases
 */
export const toolGroups = {
  // Core development tools
  core: {
    fileEdit: fileEditAITool,
    directoryListing: directoryListingAITool,
    readFile: readFileAITool,
    grepSearch: grepSearchAITool,
    memorySet: memorySetAITool,
    memoryRead: memoryReadAITool,
    memorySearch: memorySearchAITool,
    memoryListKeys: memoryListKeysAITool,
  },
  
  // System and server tools
  system: {
    terminalCommand: terminalCommandAITool,
    gitOperation: gitOperationAITool,
    serverRestart: serverRestartAITool,
    serverStatus: serverStatusAITool,
  },
  
  // Database and API tools
  backend: {
    mysqlOperation: mysqlOperationAITool,
    autoAPIGenerator: autoAPIGeneratorAITool,
  },
  
  // Media and content tools
  media: {
    imageSearch: imageSearchAITool,
    imageGenerate: imageGenerateAITool,
    iconsValidator: iconsValidatorAITool,
    ragSearch: ragSearchAITool,
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
  }
}

/**
 * Tool counts for reference
 */
export const toolStats = {
  totalTools: Object.keys(allAILibTools).length,
  coreTools: Object.keys(toolGroups.core).length,
  systemTools: Object.keys(toolGroups.system).length,
  backendTools: Object.keys(toolGroups.backend).length,
  mediaTools: Object.keys(toolGroups.media).length,
  debugTools: Object.keys(toolGroups.debug).length,
  planningTools: Object.keys(toolGroups.planning).length,
}