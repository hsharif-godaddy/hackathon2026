import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { FileEditTool } from '../file-edit.js'
import { AppRepository } from '../../database/repositories/AppRepository.js'

// Initialize tool instances
const fileEditTool = new FileEditTool()
const appRepo = new AppRepository()

// Schema for batch operations
const fileOperationSchema = z.object({
  path: z.string().describe('File path relative to app root'),
  mode: z.enum(['edit', 'rewrite', 'create', 'delete']).optional()
    .describe('Auto-detected if omitted (except delete must be explicit)'),
  edits: z.array(z.object({
    old: z.string().describe('EXACT text to replace (read file first!)'),
    new: z.string().describe('Replacement text'),
    replaceAll: z.boolean().optional().describe('Replace all occurrences')
  })).optional().describe('For edit mode'),
  content: z.string().optional().describe('For create/rewrite modes')
})

/**
 * Parse operations from string or return array as-is.
 * Handles cases where LLMs send operations as a JSON string instead of an array.
 */
function parseOperations(value: string | z.infer<typeof fileOperationSchema>[]): z.infer<typeof fileOperationSchema>[] {
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
 * Unified File Edit Tool - Supports single file or batch operations
 */
export const fileEdit: Tool = createTool(
  `Edit files - supports single or batch mode.

SINGLE FILE: { path, old, new, replaceAll }
BATCH: { operations: [{ path, mode, edits/content }], continueOnError }

CRITICAL: Read files first. Match text exactly including whitespace.
If text appears multiple times, use replaceAll: true or add more context.

Use batch for: features, refactors, coordinated changes (single commit).
Use single for: simple edits, independent changes.`,

  z.union([
    // Single file mode
    z.object({
      path: z.string().describe('File path relative to app root'),
      old: z.string().describe('EXACT text from file to replace (read file first!)'),
      new: z.string().describe('Replacement text'),
      replaceAll: z.boolean().default(false).describe(
        'Replace ALL occurrences. If false and multiple matches exist, fails with error.'
      ),
      dryRun: z.boolean().default(false).describe('Preview without applying'),
      autoCommit: z.boolean().default(false).describe('Auto-commit changes'),
      commitMessage: z.string().optional().describe('Custom commit message')
    }),
    // Batch mode
    z.object({
      operations: operationsSchema,
      createDirs: z.boolean().default(true).describe('Create parent dirs'),
      fuzzyMatch: z.boolean().default(true).describe('Fuzzy whitespace matching'),
      dryRun: z.boolean().default(false).describe('Preview without applying'),
      autoCommit: z.boolean().default(false).describe('Single batch commit'),
      commitMessage: z.string().optional().describe('Custom commit message'),
      continueOnError: z.boolean().default(false).describe(
        'Continue on error (default: false = stop on first error)'
      )
    })
  ]),

  async (input, context) => {
    const appId = context?.metadata?.appId as string
    if (!appId) {
      throw new Error('App ID is required for file editing')
    }

    const app = appRepo.findById(appId)
    if (!app) {
      throw new Error(`App '${appId}' not found`)
    }

    // Detect mode: single file or batch
    const isSingleMode = 'old' in input && 'new' in input

    if (isSingleMode) {
      // SINGLE FILE MODE
      const singleInput = input as {
        path: string
        old: string
        new: string
        replaceAll?: boolean
        dryRun?: boolean
        autoCommit?: boolean
        commitMessage?: string
      }

      const options: any = {
        path: singleInput.path,
        mode: 'edit' as const,
        edits: [{
          old: singleInput.old,
          new: singleInput.new,
          replaceAll: singleInput.replaceAll ?? false
        }],
        dryRun: singleInput.dryRun ?? false,
        createDirs: true,
        fuzzyMatch: true,
        autoCommit: singleInput.autoCommit ?? false,
      }

      if (singleInput.commitMessage) {
        options.commitMessage = singleInput.commitMessage
      }

      const result = await fileEditTool.editFile(app.path, options, {
        appId,
        conversationId: context?.metadata?.conversationId as string
      })

      if (!result.success) {
        let error = `Failed to edit ${result.path}: ${result.error}`

        if (result.error?.includes('not found')) {
          error += `\n\n💡 Tips: Read file first, match whitespace exactly, copy exact text`
        } else if (result.error?.includes('appears') && result.error?.includes('times')) {
          error += `\n\n💡 Set replaceAll: true to replace all occurrences`
        }

        throw new Error(error)
      }

      return fileEditTool.formatResult(result)

    } else {
      // BATCH MODE
      const batchInput = input as {
        operations: string | z.infer<typeof fileOperationSchema>[]
        createDirs?: boolean
        fuzzyMatch?: boolean
        dryRun?: boolean
        autoCommit?: boolean
        commitMessage?: string
        continueOnError?: boolean
      }

      const normalizedOperations = parseOperations(batchInput.operations)

      const options: any = {
        operations: normalizedOperations,
        createDirs: batchInput.createDirs ?? true,
        fuzzyMatch: batchInput.fuzzyMatch ?? true,
        dryRun: batchInput.dryRun ?? false,
        autoCommit: batchInput.autoCommit ?? false,
        continueOnError: batchInput.continueOnError ?? false
      }

      if (batchInput.commitMessage) {
        options.commitMessage = batchInput.commitMessage
      }

      const result = await fileEditTool.editFiles(app.path, options, {
        appId,
        conversationId: context?.metadata?.conversationId as string
      })

      if (!result.success) {
        const failedOp = result.results[result.completedOperations]
        let error = `Batch failed after ${result.completedOperations}/${result.totalOperations} ops`

        if (failedOp) {
          error += `\n\nFailed: ${failedOp.mode} ${failedOp.path}`
          error += `\nError: ${failedOp.error}`
          if (failedOp.warning) error += `\nDetails: ${failedOp.warning}`
        }

        if (batchInput.continueOnError && result.error) {
          error = result.error
        }

        throw new Error(error)
      }

      return fileEditTool.formatResult(result)
    }
  }
)
