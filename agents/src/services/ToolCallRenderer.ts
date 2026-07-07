/**
 * Tool Call Renderer
 *
 * Renders tool call results in a structured, readable format for conversation history.
 * This helps the LLM understand what actions were taken and what information was gathered.
 */

import { basename } from 'node:path';
import stringify from 'safe-stable-stringify';

export interface ToolCallResult {
  id: string
  toolName: string
  toolArgs: unknown
  toolResult: unknown
  error?: string | undefined
}

export interface RenderedToolCall {
  role: 'tool'
  content: string
  tool_call_id: string
  name: string
}

export class ToolCallRenderer {
  /**
   * Render a tool call result into a formatted string for the LLM
   */
  static renderToolCall(toolCall: ToolCallResult): RenderedToolCall {
    const renderer = this.getRenderer(toolCall.toolName)
    const formattedContent = renderer(toolCall)

    return {
      role: 'tool',
      content: formattedContent,
      tool_call_id: toolCall.id,
      name: toolCall.toolName
    }
  }

  /**
   * Get the appropriate renderer for a tool
   */
  private static getRenderer(toolName: string): (toolCall: ToolCallResult) => string {
    switch (toolName) {
      case 'read_file':
      case 'readFile':
        return this.renderReadFileSummary
      case 'file_edit':
      case 'fileEdit':
      case 'str_replace_based_edit_tool':
      case 'textEditor':
        return this.renderFileEditSummary
      case 'list_dir':
      case 'directoryListing':
        return this.renderListDir
      default:
        return this.renderDefault
    }
  }

  /**
   * Render read_file tool call results as summary
   */
  private static renderReadFileSummary(toolCall: ToolCallResult): string {
    if (toolCall.error) {
      return `Failed to read file: ${toolCall.error}`;
    }

    const args = toolCall.toolArgs as Record<string, unknown>;
    const result = toolCall.toolResult;
    const filePath = (args?.target_file as string) || (args?.file_path as string) || (args?.path as string) || 'unknown';

    if (!result || typeof result !== 'string') {
      return `No content found for file: ${filePath}`;
    }

    const fileName = basename(filePath);
    const lines = result.split('\n');
    const lineCount = lines.length;
    const charCount = result.length;
    const sizeInfo = charCount < 1024 ? `${charCount} chars` : `${(charCount / 1024).toFixed(1)} KB`;

    // Check if it was a partial read based on offset/limit in args
    const offset: number | undefined = args?.offset as number | undefined;
    const limit: number | undefined = args?.limit as number | undefined;
    if (offset != null && limit) {
      const endLine: number = offset + limit;
      return `Read ${fileName} lines ${offset + 1}-${endLine} (${lineCount} lines, ${sizeInfo})`;
    } else if (offset != null && offset > 0) {
      return `Read ${fileName} from line ${offset + 1} (${lineCount} lines, ${sizeInfo})`;
    } else if (limit) {
      return `Read ${fileName} first ${limit} lines (${lineCount} lines, ${sizeInfo})`;
    } else {
      return `Read ${fileName} (${lineCount} lines, ${sizeInfo})`;
    }
  }

  /**
   * Render file_edit tool call results as summary
   *
   * Preserves file names and operation details for better summarization context.
   * Groups operations by mode for readability while keeping specific file information.
   */
  private static renderFileEditSummary(toolCall: ToolCallResult): string {
    if (toolCall.error) {
      return `Failed to edit file: ${toolCall.error}`;
    }

    const args = toolCall.toolArgs as Record<string, unknown>;
    const rawResult = toolCall.toolResult;

    let result: Record<string, unknown> | undefined;
    if (typeof rawResult === 'string') {
      try {
        result = JSON.parse(rawResult);
      } catch {
        result = undefined;
      }
    } else if (rawResult && typeof rawResult === 'object') {
      result = rawResult as Record<string, unknown>;
    }

    // Handle batch operations (new schema)
    const operations = (result?.operations as any[]) || (args?.operations as any[]);
    if (operations && Array.isArray(operations) && operations.length > 0) {
      const totalOperations = (result?.totalOperations as number) || operations.length;
      const completedOperations = (result?.completedOperations as number) || 0;

      if (!(result?.success)) {
        const error = (result?.error as string) || 'Unknown error';
        return `Batch file operation failed after ${completedOperations}/${totalOperations} operations: ${error}`;
      }

      // Group successful operations by mode with file names preserved
      const created: string[] = [];
      const edited: string[] = [];
      const rewritten: string[] = [];
      const deleted: string[] = [];

      for (const op of operations) {
        if (!op.success) continue;
        const filePath = op.path || op.target_file || 'unknown';
        const fileName = basename(filePath);

        switch (op.mode) {
          case 'create':
            created.push(fileName);
            break;
          case 'edit':
            edited.push(fileName);
            break;
          case 'rewrite':
            rewritten.push(fileName);
            break;
          case 'delete':
            deleted.push(fileName);
            break;
        }
      }

      // Build detailed summary with file names
      const parts: string[] = [];
      if (created.length > 0) {
        parts.push(`Created: ${created.join(', ')}`);
      }
      if (edited.length > 0) {
        parts.push(`Edited: ${edited.join(', ')}`);
      }
      if (rewritten.length > 0) {
        parts.push(`Rewrote: ${rewritten.join(', ')}`);
      }
      if (deleted.length > 0) {
        parts.push(`Deleted: ${deleted.join(', ')}`);
      }

      return `File operations:\n${parts.join('\n')}`;
    }

    // Handle single operation (legacy schema)
    const filePath = (args?.path as string) || 'unknown';
    const fileName = basename(filePath);
    const mode = (args?.mode as string) || (result?.mode as string) || 'edit';

    if (!result || !(result.success as boolean)) {
      const error = (result?.error as string) || 'Unknown error';
      return `Failed to ${mode} ${fileName}: ${error}`;
    }

    const changes = result.changes as Record<string, number>;
    switch (mode) {
      case 'create': {
        const createLines = changes?.totalLines || 0;
        return `Created ${fileName} (${createLines} lines)`;
      }

      case 'rewrite': {
        const rewriteLines = changes?.totalLines || 0;
        return `Rewrote ${fileName} (${rewriteLines} lines)`;
      }

      case 'edit': {
        const additions = changes?.additions || 0;
        const deletions = changes?.deletions || 0;
        return `Modified ${fileName} (+${additions} -${deletions} lines)`;
      }

      default:
        return `Updated ${fileName}`;
    }
  }

  /**
   * Render read_file tool call results (detailed - legacy)
   */
  private static renderReadFile(toolCall: ToolCallResult): string {
    if (toolCall.error) {
      return `Failed to read file: ${toolCall.error}`
    }

    const args = toolCall.toolArgs as Record<string, unknown>
    const result = toolCall.toolResult
    const filePath = (args?.target_file as string) || (args?.file_path as string) || 'unknown'

    if (!result || typeof result !== 'string') {
      return `No content found for file: ${filePath}`
    }

    // Count lines and show preview
    const lines = result.split('\n')
    const lineCount = lines.length
    const sizeInfo = `${lineCount} lines, ${result.length} characters`

    // Show first few lines as preview
    const previewLines = lines.slice(0, 10)
    const hasMore = lines.length > 10

    return `**File: \`${filePath}\`** (${sizeInfo})

\`\`\`
${previewLines.join('\n')}${hasMore ? '\n... [truncated]' : ''}
\`\`\`

${hasMore ? `*Full file content available (${lineCount} total lines)*` : '*Complete file content shown*'}`
  }

  /**
   * Render list_dir tool call results
   */
  private static renderListDir(toolCall: ToolCallResult): string {
    if (toolCall.error) {
      return `Failed to list directory: ${toolCall.error}`
    }

    const args = toolCall.toolArgs as Record<string, unknown>
    const result = toolCall.toolResult
    const dirPath = (args?.target_directory as string) || (args?.path as string) || 'unknown'

    if (!result || !Array.isArray(result)) {
      return `No directory listing found for: ${dirPath}`
    }

    // Organize files and directories
    const directories = result.filter(item => item.type === 'directory')
    const files = result.filter(item => item.type === 'file')

    let content = `Directory: ${dirPath} (${result.length} items)\n`

    // Show directories first
    if (directories.length > 0) {
      content += `Directories: ${directories.map(dir => dir.name + '/').join(', ')}\n`
    }

    // Show files
    if (files.length > 0) {
      content += `Files: ${files.map(file => {
        const sizeInfo = file.size ? ` (${this.formatFileSize(file.size)})` : ''
        return file.name + sizeInfo
      }).join(', ')}`
    }

    if (result.length === 0) {
      content += 'Directory is empty'
    }

    return content
  }

  /**
   * Default renderer for unknown tool types
   */
  private static renderDefault(toolCall: ToolCallResult): string {
    if (toolCall.error) {
      return `Tool execution failed: ${toolCall.error}`
    }

    const args = stringify(toolCall.toolArgs, undefined, 2)
    const result = typeof toolCall.toolResult === 'string'
      ? toolCall.toolResult
      : stringify(toolCall.toolResult, undefined, 2)

    return `🔧 **Tool: \`${toolCall.toolName}\`**

**Arguments:**
\`\`\`json
${args}
\`\`\`

**Result:**
\`\`\`
${result}
\`\`\`
`
  }


  /**
   * Format file size in human readable format
   */
  private static formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }
}
