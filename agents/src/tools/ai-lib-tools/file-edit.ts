import { createTool } from '@airo/ai-lib'
import { z } from 'zod'
import { FileEditTool, FileEditOptions } from '../file-edit.js'
import { AppRepository } from '../../database/repositories/AppRepository.js'
import { fileContextRegistry } from '../../services/FileContextRegistry.js'

// Constants for error message formatting
const ERROR_TEXT_TRUNCATION_LENGTH = 100

// Initialize tool instances
const fileEditTool = new FileEditTool()
const appRepo = new AppRepository()

/**
 * File Edit Tool for AI-Lib
 * Edit, create, or rewrite files with intelligent mode detection
 */
export const fileEditAITool = createTool(
  'Edit, create, or rewrite files with intelligent mode detection. Supports partial edits, full rewrites, and new file creation.',
  z.object({
    path: z.string().describe('Path to the file to edit (relative to app root)'),
    mode: z.enum(['edit', 'rewrite', 'create']).optional().describe('Edit mode: edit for partial changes, rewrite for full replacement, create for new files (auto-detected if not specified)'),
    edits: z.array(z.object({
      old: z.string().describe('The exact text to search for and replace'),
      new: z.string().describe('The new text to replace with')
    })).optional().describe('Array of search-and-replace operations for partial edits'),
    content: z.string().optional().describe('Full content for rewrite or create operations'),
    createDirs: z.boolean().default(true).describe('Create parent directories if they don\'t exist'),
    dryRun: z.boolean().default(false).describe('Preview changes without applying them'),
    fuzzyMatch: z.boolean().default(true).describe('Use fuzzy matching for search text if exact match fails'),
    autoCommit: z.boolean().default(false).describe('Automatically commit changes using git after file operation'),
    commitMessage: z.string().optional().describe('Custom commit message for auto-commit (if not provided, a default message will be generated)'),
    autoBuild: z.boolean().default(true).describe('Automatically run build after file changes')
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

    // Record the file operation for hot file tracking
    fileContextRegistry.recordFileModification(app.path, input.path, result.success)

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
