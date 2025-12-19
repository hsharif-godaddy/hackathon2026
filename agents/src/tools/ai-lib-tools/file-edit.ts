import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { FileEditTool, FileBatchEditOptions } from '../file-edit.js'
import { AppRepository } from '../../database/repositories/AppRepository.js'

// Constants for error message formatting
const ERROR_TEXT_TRUNCATION_LENGTH = 100

// Initialize tool instances
const fileEditTool = new FileEditTool()
const appRepo = new AppRepository()

const fileOperationSchema = z.object({
  path: z.string().describe('Path to the file (relative to app root)'),
  mode: z.enum(['edit', 'rewrite', 'create', 'delete']).optional().describe('Operation mode: edit for partial changes, rewrite for full replacement, create for new files, delete to remove files. Auto-detected if not specified (except delete, which must be explicit)'),
  edits: z.array(z.object({
    old: z.string().describe('The EXACT text currently in the file to search for and replace. MUST match the file content exactly - read the file first if you are unsure!'),
    new: z.string().describe('The new text to replace with')
  })).optional().describe('Array of search-and-replace operations for partial edits. Each "old" value MUST be the exact current content from the file.'),
  content: z.string().optional().describe('Full content for rewrite or create operations')
})

type FileOperation = z.infer<typeof fileOperationSchema>

/**
 * Parse operations from string or return array as-is.
 * Handles cases where LLMs send operations as a JSON string instead of an array.
 */
function parseOperations(value: string | FileOperation[]): FileOperation[] {
  if (Array.isArray(value)) {
    return value
  }

  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('Operations JSON string cannot be empty')
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      return parsed
    }

    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.operations)) {
      return parsed.operations
    }

    if (parsed && typeof parsed === 'object' && 'path' in parsed) {
      const validation = fileOperationSchema.safeParse(parsed)
      if (validation.success) {
        return [validation.data]
      }
      throw new Error(`Single operation object is invalid: ${validation.error.message}`)
    }

    throw new Error('Parsed operations must be an array or an object with an operations array')
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error(`Failed to parse operations JSON string: ${e.message}`)
    }
    throw e
  }
}

// Accept either an array of operations OR a JSON string (some LLMs stringify the array)
const operationsSchema = z.union([
  z.array(fileOperationSchema).min(1),
  z.string().describe('JSON string containing an array of file operations')
]).describe(
  'Array of file operations to perform (or JSON string of the array). Must contain at least one operation.'
)

/**
 * File Edit Tool for AI-Lib
 * Batch file operations: edit, create, rewrite, or delete multiple files in one call
 */
export const fileEditAITool: Tool = createTool(
  `Perform multiple file operations (edit, create, rewrite, delete) in a single batch operation.
Operations execute sequentially and stop on first error (fail-fast), returning all completed operations plus the error.

CRITICAL RULES:
1. For 'edit' mode, you MUST provide the EXACT text that you want to replace in the file for the 'old' field.
   - DO NOT guess or assume what the old content is
   - DO NOT use placeholders like "existing content" or "current value"
   - You MUST read the file, search it, or check the context to get the actual current content
   - The 'old' field must match the file contents you want to replace EXACTLY (whitespace, indentation, etc.)
   - If you don't know the current content, read the file first

2. For 'delete' operations, you MUST explicitly set mode: 'delete'.
   - Delete mode is NEVER auto-detected for safety
   - Simply omitting content/edits will NOT delete a file

3. Batch behavior:
   - Operations execute in the order provided
   - Execution stops on first error (fail-fast)
   - All successful operations before the error are preserved
   - If autoCommit is enabled, all successful operations are committed together in a single commit`,
  z.object({
    operations: operationsSchema,
    createDirs: z.boolean().default(true).describe('Create parent directories if they don\'t exist'),
    fuzzyMatch: z.boolean().default(true).describe('Use fuzzy matching for search text if exact match fails'),
    autoCommit: z.boolean().default(false).describe('Automatically commit all successful changes using git in a single batch commit'),
    commitMessage: z.string().optional().describe('Custom commit message for auto-commit (if not provided, a default message will be generated based on the operations)')
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string
    if (!appId) {
      throw new Error('App ID is required for file editing')
    }

    const app = appRepo.findById(appId)
    if (!app) {
      throw new Error(`App '${appId}' not found`)
    }

    // Normalize operations - handle case where LLM sends as JSON string
    const normalizedInput = {
      ...input,
      operations: parseOperations(input.operations)
    } as FileBatchEditOptions

    const result = await fileEditTool.editFiles(app.path, normalizedInput, {
      appId,
      conversationId: context?.metadata?.conversationId as string
    })

    // CRITICAL: If the batch operation failed, throw an error with details about partial completion
    if (!result.success) {
      let errorMessage = `Batch file operation failed after ${result.completedOperations}/${result.totalOperations} operations: ${result.error || 'Unknown error'}`;

      // Include details about failed operation if available
      // The failed operation is at index result.completedOperations (0-indexed)
      const failedResult = result.results[result.completedOperations];
      if (failedResult && !failedResult.success && failedResult.error) {
        errorMessage += `\nFailed operation: ${failedResult.mode} ${failedResult.path}`;
        errorMessage += `\nError details: ${failedResult.error}`;
        if (failedResult.warning) {
          errorMessage += `\nAttempts: ${failedResult.warning}`;
        }
      }

      // Include details about the specific operation that failed
      if (normalizedInput.operations && result.completedOperations < normalizedInput.operations.length) {
        const failedOp = normalizedInput.operations[result.completedOperations];
        if (failedOp && failedOp.edits && failedOp.edits.length > 0) {
          errorMessage += `\nRequested edits (${failedOp.edits.length}):\n`;
          failedOp.edits.forEach((edit, index) => {
            errorMessage += `${index + 1}. Replace: "${edit.old.substring(0, ERROR_TEXT_TRUNCATION_LENGTH)}${edit.old.length > ERROR_TEXT_TRUNCATION_LENGTH ? '...' : ''}" with: "${edit.new.substring(0, ERROR_TEXT_TRUNCATION_LENGTH)}${edit.new.length > ERROR_TEXT_TRUNCATION_LENGTH ? '...' : ''}"\n`;
          });
        }
      }

      throw new Error(errorMessage);
    }

    return fileEditTool.formatResult(result)
  }
)
