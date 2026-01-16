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

3. Batch behavior and error recovery:
   - Operations execute in the order provided
   - Execution stops on first error (fail-fast)
   - All successful operations before the error are preserved
   - If autoCommit is enabled, all successful operations are committed together in a single commit

   WHEN A BATCH FAILS:
   - You will receive a detailed error showing: completed operations, the failed operation, and unattempted operations
   - Before retrying, you MUST read the current content of ALL files from the failed operation onwards
   - Do NOT retry operations that already succeeded - they are already committed
   - Only retry the failed operation and unattempted operations`,
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
      let errorMessage = `Batch file operation failed: completed ${result.completedOperations}/${result.totalOperations} operations, then stopped at operation ${result.completedOperations + 1}.\n`;

      // List completed operations
      if (result.completedOperations > 0) {
        errorMessage += `\nCOMPLETED:\n`;
        for (let i = 0; i < result.completedOperations; i++) {
          const completedResult = result.results[i];
          if (completedResult) {
            errorMessage += `- ${completedResult.path} (${completedResult.mode})\n`;
          }
        }
      }

      // Detail the failed operation
      const failedResult = result.results[result.completedOperations];
      if (failedResult && !failedResult.success) {
        errorMessage += `\nFAILED:\n`;
        errorMessage += `- ${failedResult.path} (${failedResult.mode})\n`;
        errorMessage += `  Error: ${failedResult.error || 'Unknown error'}\n`;

        // Include attempted edits if available
        const failedOp = normalizedInput.operations[result.completedOperations];
        if (failedOp?.edits && failedOp.edits.length > 0) {
          errorMessage += `  Attempted: `;
          errorMessage += failedOp.edits.map((edit, idx) => {
            const oldTrunc = edit.old.substring(0, ERROR_TEXT_TRUNCATION_LENGTH);
            const newTrunc = edit.new.substring(0, ERROR_TEXT_TRUNCATION_LENGTH);
            return `Replace "${oldTrunc}${edit.old.length > ERROR_TEXT_TRUNCATION_LENGTH ? '...' : ''}" with "${newTrunc}${edit.new.length > ERROR_TEXT_TRUNCATION_LENGTH ? '...' : ''}"`;
          }).join('; ') + '\n';
        }

        if (failedResult.warning) {
          errorMessage += `  Details: ${failedResult.warning}\n`;
        }
      }

      // List unattempted operations
      const unattemptedCount = result.totalOperations - result.completedOperations - 1;
      if (unattemptedCount > 0) {
        errorMessage += `\nNOT ATTEMPTED (must be retried):\n`;
        for (let i = result.completedOperations + 1; i < normalizedInput.operations.length; i++) {
          const unattemptedOp = normalizedInput.operations[i];
          if (unattemptedOp) {
            errorMessage += `- ${unattemptedOp.path} (${unattemptedOp.mode || 'edit'})\n`;
          }
        }
      }

      // Provide explicit action items
      errorMessage += `\nREQUIRED ACTION: Before retrying this batch, you MUST read the current content of these files: `;
      const filesToRead: string[] = [];

      // Add failed file
      if (failedResult) {
        filesToRead.push(failedResult.path);
      }

      // Add all unattempted files
      for (let i = result.completedOperations + 1; i < normalizedInput.operations.length; i++) {
        const unattemptedOp = normalizedInput.operations[i];
        if (unattemptedOp) {
          filesToRead.push(unattemptedOp.path);
        }
      }

      errorMessage += filesToRead.join(', ');

      if (result.completedOperations > 0) {
        errorMessage += `. Do NOT retry the completed operations (${result.results
          .slice(0, result.completedOperations)
          .filter(r => r && r.path)
          .map(r => r.path)
          .join(', ')}).`;
      }

      throw new Error(errorMessage);
    }

    return fileEditTool.formatResult(result)
  }
)
