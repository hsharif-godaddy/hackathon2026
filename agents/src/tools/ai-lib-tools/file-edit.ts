import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { FileEditTool, FileEditOptions } from '../file-edit.js'
import { AppRepository } from '../../database/repositories/AppRepository.js'

// Constants for error message formatting
const ERROR_TEXT_TRUNCATION_LENGTH = 100

// Initialize tool instances
const fileEditTool = new FileEditTool()
const appRepo = new AppRepository()

/**
 * File Edit Tool for AI-Lib
 * Edit, create, or rewrite files with intelligent mode detection
 */
export const fileEditAITool: Tool = createTool(
  `Edit, create, or rewrite files with intelligent mode detection. Supports partial edits, full rewrites, and new file creation.

CRITICAL: For 'edit' mode, you MUST provide the EXACT text that you want replace in the file for the 'old' field.
- DO NOT guess or assume what the old content is
- DO NOT use placeholders like "existing content" or "current value"
- You MUST read the file, search it, or check the context to get the actual current content
- The 'old' field must match the file contents you want to replace EXACTLY (whitespace, indentation, etc.)
- If you don't know the current content, read the file first

WARNING: DO NOT use this tool to create src/config/commerce-credentials.ts - use the createCommerceCredentials tool instead.`,
  z.object({
    path: z.string().describe('Path to the file to edit (relative to app root)'),
    mode: z.enum(['edit', 'rewrite', 'create']).optional().describe('Edit mode: edit for partial changes, rewrite for full replacement, create for new files (auto-detected if not specified)'),
    edits: z.array(z.object({
      old: z.string().describe('The EXACT text currently in the file to search for and replace. MUST match the file content exactly - read the file first if you are unsure!'),
      new: z.string().describe('The new text to replace with')
    })).optional().describe('Array of search-and-replace operations for partial edits. Each "old" value MUST be the exact current content from the file.'),
    content: z.string().optional().describe('Full content for rewrite or create operations'),
    createDirs: z.boolean().default(true).describe('Create parent directories if they don\'t exist'),
    fuzzyMatch: z.boolean().default(true).describe('Use fuzzy matching for search text if exact match fails'),
    autoCommit: z.boolean().default(false).describe('Automatically commit changes using git after file operation'),
    commitMessage: z.string().optional().describe('Custom commit message for auto-commit (if not provided, a default message will be generated)')
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

    const result = await fileEditTool.editFile(app.path, input as FileEditOptions, {
      appId,
      conversationId: context?.metadata?.conversationId as string
    })

    // CRITICAL FIX: If the file operation failed, throw an error so the agent knows about it
    // Previously, we were returning a formatted string even for failures, which made errors invisible
    if (!result.success) {
      // Include edit details in the error for better debugging
      let errorMessage = `File edit failed: ${result.error || 'Unknown error'}`;
      if (result.warning) {
        errorMessage += `\nEdit attempts:\n${result.warning}`;
      }
      if (input.edits && input.edits.length > 0) {
        errorMessage += `\nRequested edits (${input.edits.length}):\n`;
        input.edits.forEach((edit, index) => {
          errorMessage += `${index + 1}. Replace: "${edit.old.substring(0, ERROR_TEXT_TRUNCATION_LENGTH)}${edit.old.length > ERROR_TEXT_TRUNCATION_LENGTH ? '...' : ''}" with: "${edit.new.substring(0, ERROR_TEXT_TRUNCATION_LENGTH)}${edit.new.length > ERROR_TEXT_TRUNCATION_LENGTH ? '...' : ''}"\n`;
        });
      }
      throw new Error(errorMessage);
    }

    return fileEditTool.formatResult(result)
  }
)
