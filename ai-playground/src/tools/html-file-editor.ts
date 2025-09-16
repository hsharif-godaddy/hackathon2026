import { createTool } from '@airo/ai-lib'
import { z } from 'zod'
import { memoryFS } from './in-memory-fs'

/**
 * Interface for file edit operations, similar to the main file-edit.ts
 */
export interface FileEditOptions {
  /** Path to the file to edit */
  path: string
  /** Edit mode: edit for partial changes, rewrite for full replacement, create for new files */
  mode?: 'edit' | 'rewrite' | 'create'
  /** Array of search-and-replace operations for partial edits */
  edits?: Array<{
    old: string
    new: string
  }>
  /** Full content for rewrite or create operations */
  content?: string
  /** Preview changes without applying them */
  dryRun?: boolean
  /** Use fuzzy matching for search text if exact match fails */
  fuzzyMatch?: boolean
}

export interface FileEditResult {
  /** Whether the operation succeeded */
  success: boolean
  /** Path that was edited */
  path: string
  /** Edit mode that was used */
  mode: 'create' | 'edit' | 'rewrite'
  /** Diff showing changes made */
  diff?: string
  /** Summary of changes */
  changes?: {
    additions: number
    deletions: number
    totalLines: number
  }
  /** Error message if operation failed */
  error?: string
  /** Warning message */
  warning?: string
}

/**
 * HTML File Editor Tool for In-Memory Filesystem
 * Provides comprehensive file editing capabilities with safety features for HTML/CSS/JS files
 */
export class HTMLFileEditor {
  private readonly MAX_FILE_SIZE = 1024 * 1024 // 1MB limit for playground

  /**
   * Execute a file edit operation
   */
  async editFile(options: FileEditOptions): Promise<FileEditResult> {
    try {
      // Auto-detect mode if not specified
      const mode = options.mode || this.detectMode(options)
      
      let result: FileEditResult

      // Route to appropriate handler
      switch (mode) {
        case 'create':
          result = await this.handleCreate(options)
          break
        case 'rewrite':
          result = await this.handleRewrite(options)
          break
        case 'edit':
          result = await this.handleEdit(options)
          break
        default:
          throw new Error(`Unknown edit mode: ${mode}`)
      }
      
      return result
    } catch (error) {
      return {
        success: false,
        path: options.path,
        mode: 'edit' as const,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Auto-detect the appropriate edit mode
   */
  private detectMode(options: FileEditOptions): 'create' | 'edit' | 'rewrite' {
    const exists = memoryFS.exists(options.path)
    
    if (!exists) {
      return 'create'
    }
    
    if (options.content !== undefined && options.edits === undefined) {
      return 'rewrite'
    }
    
    if (options.edits !== undefined) {
      return 'edit'
    }
    
    throw new Error('Cannot determine edit mode: specify either "content" for rewrite or "edits" for partial changes')
  }

  /**
   * Handle creating a new file
   */
  private async handleCreate(options: FileEditOptions): Promise<FileEditResult> {
    if (!options.content) {
      return {
        success: false,
        path: options.path,
        mode: 'create',
        error: 'Content is required for creating a new file',
      }
    }

    if (memoryFS.exists(options.path)) {
      return {
        success: false,
        path: options.path,
        mode: 'create',
        error: 'File already exists. Use mode "rewrite" to overwrite or "edit" to modify',
      }
    }

    const diff = this.createPatch(
      options.path,
      '',
      options.content,
      'non-existent',
      'new file'
    )

    if (!options.dryRun) {
      memoryFS.writeFile(options.path, options.content)
    }

    return {
      success: true,
      path: options.path,
      mode: 'create' as const,
      diff,
      changes: {
        additions: options.content.split('\n').length,
        deletions: 0,
        totalLines: options.content.split('\n').length,
      },
    }
  }

  /**
   * Handle rewriting an entire file
   */
  private async handleRewrite(options: FileEditOptions): Promise<FileEditResult> {
    if (!options.content) {
      return {
        success: false,
        path: options.path,
        mode: 'rewrite',
        error: 'Content is required for rewrite mode',
      }
    }

    // Check file size limit
    if (options.content.length > this.MAX_FILE_SIZE) {
      return {
        success: false,
        path: options.path,
        mode: 'rewrite',
        error: `File content exceeds maximum size limit (${this.MAX_FILE_SIZE} bytes)`,
      }
    }

    let originalContent = ''

    // Read original content if file exists
    if (memoryFS.exists(options.path)) {
      try {
        originalContent = memoryFS.readFile(options.path)
      } catch (error) {
        return {
          success: false,
          path: options.path,
          mode: 'rewrite',
          error: `Failed to read original file: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    }

    const diff = this.createPatch(
      options.path,
      originalContent,
      options.content,
      'original',
      'modified'
    )

    if (!options.dryRun) {
      memoryFS.writeFile(options.path, options.content)
    }

    const changes = this.calculateChanges(originalContent, options.content)

    return {
      success: true,
      path: options.path,
      mode: 'rewrite' as const,
      diff,
      changes,
    }
  }

  /**
   * Handle partial file edits
   */
  private async handleEdit(options: FileEditOptions): Promise<FileEditResult> {
    if (!options.edits || options.edits.length === 0) {
      return {
        success: false,
        path: options.path,
        mode: 'edit',
        error: 'Edits array is required for edit mode',
      }
    }

    if (!memoryFS.exists(options.path)) {
      return {
        success: false,
        path: options.path,
        mode: 'edit',
        error: 'File does not exist. Use mode "create" to create a new file',
      }
    }

    let content: string
    try {
      content = memoryFS.readFile(options.path)
    } catch (error) {
      return {
        success: false,
        path: options.path,
        mode: 'edit',
        error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    // Check file size limit
    if (content.length > this.MAX_FILE_SIZE) {
      return {
        success: false,
        path: options.path,
        mode: 'edit',
        error: `File exceeds maximum size limit (${this.MAX_FILE_SIZE} bytes)`,
      }
    }

    const originalContent = content

    // Apply edits
    const editResults: string[] = []
    for (const edit of options.edits) {
      if (!edit.old || edit.old === undefined) {
        editResults.push(`✗ Failed: Invalid edit - missing 'old' value`)
        continue
      }
      
      const result = this.applyEdit(content, edit, options.fuzzyMatch !== false)
      if (result.success) {
        content = result.content
        editResults.push(`✓ Replaced: ${edit.old.substring(0, 50)}${edit.old.length > 50 ? '...' : ''}`)
      } else {
        editResults.push(`✗ Failed: ${edit.old.substring(0, 50)}${edit.old.length > 50 ? '...' : ''} - ${result.error}`)
      }
    }

    if (content === originalContent) {
      return {
        success: false,
        path: options.path,
        mode: 'edit',
        error: 'No changes were applied. Check that search text exists in the file.',
        warning: editResults.join('\n'),
      }
    }

    const diff = this.createPatch(
      options.path,
      originalContent,
      content,
      'original',
      'modified'
    )

    if (!options.dryRun) {
      memoryFS.writeFile(options.path, content)
    }

    const changes = this.calculateChanges(originalContent, content)

    const result: FileEditResult = {
      success: true,
      path: options.path,
      mode: 'edit',
      diff,
      changes,
    }
    
    if (editResults.length > 0) {
      result.warning = editResults.join('\n')
    }
    
    return result
  }

  /**
   * Apply a single edit operation
   */
  private applyEdit(content: string, edit: { old: string; new: string }, fuzzyMatch: boolean): { success: boolean; content: string; error?: string } {
    // Try exact match first
    if (content.includes(edit.old)) {
      return {
        success: true,
        content: content.replace(edit.old, edit.new),
      }
    }

    // Try fuzzy matching if enabled
    if (fuzzyMatch) {
      const fuzzyResult = this.fuzzySearch(content, edit.old)
      if (fuzzyResult.found) {
        return {
          success: true,
          content: content.replace(fuzzyResult.match, edit.new),
        }
      }
    }

    return {
      success: false,
      content,
      error: 'Search text not found',
    }
  }

  /**
   * Fuzzy search for text with minor differences
   */
  private fuzzySearch(content: string, searchText: string): { found: boolean; match: string } {
    const lines = content.split('\n')
    const searchLines = searchText.split('\n')
    
    // Simple fuzzy matching: ignore leading/trailing whitespace
    const normalizedSearch = searchLines.map(line => line.trim()).join('\n')
    
    for (let i = 0; i <= lines.length - searchLines.length; i++) {
      const candidateLines = lines.slice(i, i + searchLines.length)
      const normalizedCandidate = candidateLines.map(line => line.trim()).join('\n')
      
      if (normalizedCandidate === normalizedSearch) {
        return {
          found: true,
          match: candidateLines.join('\n'),
        }
      }
    }
    
    return { found: false, match: '' }
  }

  /**
   * Calculate changes between original and new content
   */
  private calculateChanges(original: string, modified: string): { additions: number; deletions: number; totalLines: number } {
    const originalLines = original.split('\n')
    const modifiedLines = modified.split('\n')
    
    // Simple line-based diff calculation
    let additions = 0
    let deletions = 0
    
    // For simplicity, we'll do a basic comparison
    // In a real implementation, you'd use a proper diff algorithm
    const maxLines = Math.max(originalLines.length, modifiedLines.length)
    
    for (let i = 0; i < maxLines; i++) {
      const originalLine = originalLines[i] || ''
      const modifiedLine = modifiedLines[i] || ''
      
      if (i >= originalLines.length) {
        additions++ // New line added
      } else if (i >= modifiedLines.length) {
        deletions++ // Line deleted
      } else if (originalLine !== modifiedLine) {
        // Line changed - count as both addition and deletion
        additions++
        deletions++
      }
    }
    
    return {
      additions,
      deletions,
      totalLines: modifiedLines.length,
    }
  }

  /**
   * Create a simple patch/diff representation
   */
  private createPatch(
    filename: string,
    original: string,
    modified: string,
    originalHeader: string,
    modifiedHeader: string
  ): string {
    const originalLines = original.split('\n')
    const modifiedLines = modified.split('\n')
    
    let patch = `--- ${filename} (${originalHeader})\n+++ ${filename} (${modifiedHeader})\n`
    
    const maxLines = Math.max(originalLines.length, modifiedLines.length)
    
    for (let i = 0; i < maxLines; i++) {
      const originalLine = originalLines[i]
      const modifiedLine = modifiedLines[i]
      
      if (originalLine === undefined) {
        // Line added
        patch += `+${modifiedLine}\n`
      } else if (modifiedLine === undefined) {
        // Line deleted
        patch += `-${originalLine}\n`
      } else if (originalLine !== modifiedLine) {
        // Line changed
        patch += `-${originalLine}\n+${modifiedLine}\n`
      } else {
        // Line unchanged (show context)
        patch += ` ${originalLine}\n`
      }
    }
    
    return patch
  }

  /**
   * Get current filesystem state
   */
  getFileSystemState(): Record<string, string> {
    return memoryFS.getAllFiles()
  }

  /**
   * Initialize with sample files
   */
  initializeSample(): void {
    memoryFS.initializeSample()
  }

  /**
   * Format the edit result for display
   */
  formatResult(result: FileEditResult): string {
    const lines: string[] = []
    
    const statusIcon = result.success ? '✅' : '❌'
    lines.push(`${statusIcon} **File ${result.mode}**: \`${result.path}\``)
    
    if (result.changes) {
      lines.push(`📊 **Changes**: +${result.changes.additions} -${result.changes.deletions} lines (${result.changes.totalLines} total)`)
    }
    
    if (result.error) {
      lines.push(`❌ **Error**: ${result.error}`)
    }
    
    if (result.warning) {
      lines.push(`⚠️ **Warnings**:\n${result.warning}`)
    }
    
    if (result.diff && result.success) {
      lines.push('')
      lines.push('📝 **Diff**:')
      lines.push('```diff')
      lines.push(result.diff)
      lines.push('```')
    }
    
    return lines.join('\n')
  }
}

// Global instance for the playground
const htmlEditor = new HTMLFileEditor()

// Export the tool
export const htmlFileEditorTool = createTool(
  'Edit HTML, CSS, and JavaScript files in the playground memory filesystem',
  z.object({
    action: z.enum(['edit', 'read', 'list', 'init']).describe('Action to perform'),
    
    // File editing options
    path: z.string().optional().describe('Path to the file to edit (required for edit/read)'),
    mode: z.enum(['edit', 'rewrite', 'create']).optional().describe('Edit mode'),
    content: z.string().optional().describe('Full content for rewrite or create operations'),
    edits: z.array(z.object({
      old: z.string().describe('Text to find and replace'),
      new: z.string().describe('Replacement text')
    })).optional().describe('Array of search-and-replace operations'),
    dryRun: z.boolean().optional().describe('Preview changes without applying them'),
    fuzzyMatch: z.boolean().optional().describe('Use fuzzy matching for search text')
  }),
  async (params) => {
    try {
      switch (params.action) {
        case 'init':
          htmlEditor.initializeSample()
          const files = htmlEditor.getFileSystemState()
          return {
            success: true,
            message: 'Initialized sample HTML files',
            files: Object.keys(files),
            content: files,
            htmlPreview: {
              type: 'html-files',
              files: files,
              title: 'Sample HTML Files - Initialized'
            }
          }
          
        case 'list':
          const allFiles = htmlEditor.getFileSystemState()
          return {
            success: true,
            files: Object.keys(allFiles),
            content: allFiles,
            htmlPreview: {
              type: 'html-files',
              files: allFiles,
              title: 'Current HTML Files'
            }
          }
          
        case 'read':
          if (!params.path) {
            return { success: false, error: 'Path is required for read action' }
          }
          
          if (!memoryFS.exists(params.path)) {
            return { success: false, error: `File not found: ${params.path}` }
          }
          
          const content = memoryFS.readFile(params.path)
          return {
            success: true,
            path: params.path,
            content,
            size: content.length
          }
          
        case 'edit':
          if (!params.path) {
            return { success: false, error: 'Path is required for edit action' }
          }
          
          const editOptions: FileEditOptions = {
            path: params.path,
            mode: params.mode,
            content: params.content,
            edits: params.edits,
            dryRun: params.dryRun,
            fuzzyMatch: params.fuzzyMatch
          }
          
          const result = await htmlEditor.editFile(editOptions)
          return {
            ...result,
            formattedResult: htmlEditor.formatResult(result),
            currentFiles: htmlEditor.getFileSystemState(),
            htmlPreview: {
              type: 'html-files',
              files: htmlEditor.getFileSystemState(),
              title: `HTML Files - ${result.mode === 'create' ? 'Created' : result.mode === 'edit' ? 'Updated' : 'Rewritten'}: ${result.path}`
            }
          }
          
        default:
          return { success: false, error: `Unknown action: ${params.action}` }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
)