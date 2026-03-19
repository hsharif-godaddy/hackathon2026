/**
 * File Operation Handler
 *
 * Tracks file operations (create, modify, delete) from tool calls
 * Updates CodeSyncStore to trigger UI synchronization in Code view
 */

import { logger } from '@/lib/request-context'
import { type FileOperationType, useCodeSyncStore } from '@/stores/useCodeSyncStore'
import type { MessageHandler, WebSocketMessage } from './types'

// File operation tool names
const FILE_OPERATION_TOOLS = new Set([
  'str_replace_based_edit_tool',  // Native Anthropic text editor
  'textEditor',  // Legacy name
  'fileEdit',    // Legacy batch tool
  'write_file',
  'delete_file',
  'create_file'
])

/**
 * Extract file paths from tool input based on tool name
 * Returns array of paths to handle batch operations
 */
function extractFilePaths(toolName: string, input: any): string[] {
  if (!input) return []

  // Handle batch operations (fileEdit legacy tool with operations array)
  if (toolName === 'fileEdit' && Array.isArray(input.operations)) {
    return input.operations
      .map((op: any) => op.path)
      .filter((path: any): path is string => typeof path === 'string')
  }

  // Single file operation (textEditor and other tools use 'path' field)
  const singlePath = input.path || input.file_path || null
  return singlePath ? [singlePath] : []
}

/**
 * Determine operation type from tool name and input
 * For the text editor tool, the command determines the operation type
 */
function getOperationType(toolName: string, input?: any): FileOperationType | null {
  if (toolName === 'str_replace_based_edit_tool' || toolName === 'textEditor') {
    const command = input?.command
    if (command === 'view') return null  // view doesn't modify files
    if (command === 'create') return 'create'
    return 'modify'  // str_replace, insert
  }
  if (toolName === 'fileEdit') return 'modify'
  if (toolName === 'write_file' || toolName === 'create_file') return 'create'
  if (toolName === 'delete_file') return 'delete'
  return null
}

/**
 * Handler for tracking file operations from tool calls
 * Listens to both tool_call (start) and tool_result (complete) events
 */
export class FileOperationHandler implements MessageHandler {
  readonly type = 'file_operation'

  /**
   * This handler is manually called by ToolCallHandler and ToolResultHandler
   * It's not registered in the registry since it piggybacks on existing handlers
   */
  async handle(data: WebSocketMessage): Promise<void> {
    const tool = data.data?.tool as any
    if (!tool) return

    const toolName = tool.name
    if (!FILE_OPERATION_TOOLS.has(toolName)) return

    logger.info('file-operation-handler.tool-detected', {
      toolName,
      messageType: data.type,
      hasInput: !!tool.input,
      inputKeys: tool.input ? Object.keys(tool.input) : []
    })

    const filePaths = extractFilePaths(toolName, tool.input)
    if (filePaths.length === 0) {
      logger.warn('file-operation-handler.missing-paths', {
        toolName,
        message: 'No file paths found in tool input',
        input: tool.input
      })
      return
    }

    const operationType = getOperationType(toolName, tool.input)
    if (!operationType) return

    const { markFileStreaming, markFileComplete, clearFileChange } = useCodeSyncStore.getState()

    // Handle tool start (tool_call message) - mark as streaming
    if (data.type === 'tool_call') {
      for (const filePath of filePaths) {
        markFileStreaming(filePath, operationType)
        logger.info('file-operation-handler.streaming', {
          filePath,
          operation: operationType,
          toolName
        })
      }
    }

    // Handle tool completion (tool_result message) - mark as complete
    if (data.type === 'tool_result') {
      const hasError = tool.error || tool.is_error
      for (const filePath of filePaths) {
        if (!hasError) {
          markFileComplete(filePath, operationType)
          logger.info('file-operation-handler.complete', {
            filePath,
            operation: operationType,
            toolName
          })
        } else {
          // Clear the streaming state on error
          clearFileChange(filePath)
          logger.warn('file-operation-handler.error', {
            filePath,
            operation: operationType,
            toolName,
            error: tool.error
          })
        }
      }
    }
  }
}

// Singleton instance
export const fileOperationHandler = new FileOperationHandler()
