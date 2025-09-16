// Export base tool classes and utilities
export * from './base-tool.js'

// Export built-in tools
export * from './built-in/index.js'

// Convenience object for easy tool access
import { createWebSearchTool, createFileOperationTools } from './built-in/index.js'

export const tools = {
  webSearch: createWebSearchTool,
  fileOperations: createFileOperationTools,
  
  // Individual file operation tools
  readFile: () => createFileOperationTools().readFile,
  writeFile: () => createFileOperationTools().writeFile,
  listDirectory: () => createFileOperationTools().listDirectory
}
