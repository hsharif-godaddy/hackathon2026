import { basename } from 'node:path';
import type { LLMMessage } from '../ConversationHistoryLoader.js';
import { isOpenAIMessage } from '../ConversationHistoryLoader.js';
import { OperationLogPruner } from './OperationLogPruner.js';

/**
 * A single operation entry extracted from tool calls
 */
export interface OperationLogEntry {
  /** Tool that was used */
  tool: string;
  /** Files affected (if applicable) */
  files?: string[];
  /** Operation mode (create, edit, delete, etc.) */
  mode?: string;
  /** Brief description of what was done */
  description: string;
}

/**
 * Extracts a structured operation log from conversation messages.
 *
 * This log survives compression and provides a cumulative record of
 * all significant operations performed during the conversation.
 * It's designed to be injected into summarization prompts to ensure
 * the LLM has visibility into what was done even after message
 * compression removes the original tool calls.
 *
 * ## Growth Strategy
 *
 * The operation log is intentionally cumulative and grows with the conversation.
 * This is by design to preserve a complete history of work performed. The format()
 * method groups and deduplicates file operations to keep the output concise.
 *
 * For very long conversations (thousands of operations), future enhancements could:
 * - Implement time-based or size-based pruning of old operations
 * - Add summarization of repetitive operations (e.g., "edited file X 50 times")
 * - Store operation log separately with pagination
 *
 * Current implementation prioritizes completeness over size optimization, which
 * is appropriate for typical development workflows where operation history provides
 * critical context for understanding what code has been modified.
 *
 * ## Testing
 *
 * TODO: Add comprehensive unit tests covering:
 * - Each tool type extraction (str_replace_based_edit_tool, readFile, terminalCommand, git)
 * - Edge cases (missing args, malformed JSON, undefined paths)
 * - Format function grouping and deduplication behavior
 * - File name extraction from various path formats
 */
export class OperationLogExtractor {
  private static readonly logVersion = 1;

  /**
   * Extract operation log entries from a list of messages
   *
   * @param messages - Messages to extract operations from
   * @returns Array of operation log entries
   */
  static extract(messages: LLMMessage[]): OperationLogEntry[] {
    const entries: OperationLogEntry[] = [];

    for (const msg of messages) {
      if (msg.role !== 'assistant') continue;
      if (!isOpenAIMessage(msg)) continue;
      if (!msg.tool_calls || msg.tool_calls.length === 0) continue;

      for (const tc of msg.tool_calls) {
        const entry = this.extractFromToolCall(tc);
        if (entry) {
          entries.push(entry);
        }
      }
    }

    return entries;
  }

  /**
   * Extract an operation entry from a single tool call
   */
  private static extractFromToolCall(toolCall: {
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }): OperationLogEntry | null {
    const name = toolCall.function?.name || 'unknown';
    let args: Record<string, unknown> = {};

    try {
      args = JSON.parse(toolCall.function?.arguments || '{}');
    } catch {
      return null;
    }

    switch (name) {
      case 'str_replace_based_edit_tool':
      case 'fileEdit':
        if (args.command === 'view') {
          return this.extractReadFileOperation(args);
        }
        return this.extractFileEditOperation(args);

      case 'readFile':
        return this.extractReadFileOperation(args);

      case 'terminalCommand':
        return this.extractTerminalOperation(args);

      case 'git':
        return this.extractGitOperation(args);

      default:
        // Skip tools that don't produce meaningful operation log entries
        return null;
    }
  }

  private static extractFileEditOperation(args: Record<string, unknown>): OperationLogEntry | null {
    const operations = args.operations as Array<{ path?: string; mode?: string }> | undefined;

    if (operations && Array.isArray(operations) && operations.length > 0) {
      const filesByMode: Record<string, string[]> = {};

      for (const op of operations) {
        const mode = op.mode || 'edit';
        const fileName = this.getFileName(op.path);
        if (fileName) {
          if (!filesByMode[mode]) filesByMode[mode] = [];
          filesByMode[mode].push(fileName);
        }
      }

      const parts: string[] = [];
      const allFiles: string[] = [];

      for (const [mode, files] of Object.entries(filesByMode)) {
        parts.push(`${mode}: ${files.join(', ')}`);
        allFiles.push(...files);
      }

      return {
        tool: 'str_replace_based_edit_tool',
        files: allFiles,
        mode: Object.keys(filesByMode).join(', '),
        description: parts.join('; '),
      };
    }

    // Single file operation (args.command covers str_replace_based_edit_tool)
    const path = args.path || args.target_file;
    const mode = (args.mode as string) || (args.command as string) || 'edit';
    const fileName = this.getFileName(path);

    if (fileName) {
      return {
        tool: 'str_replace_based_edit_tool',
        files: [fileName],
        mode,
        description: `${mode}: ${fileName}`,
      };
    }

    return null;
  }

  private static extractReadFileOperation(args: Record<string, unknown>): OperationLogEntry | null {
    const path = args.target_file || args.file_path || args.path;
    const fileName = this.getFileName(path);

    if (fileName) {
      return {
        tool: 'readFile',
        files: [fileName],
        description: `Read ${fileName}`,
      };
    }

    return null;
  }

  private static extractTerminalOperation(args: Record<string, unknown>): OperationLogEntry | null {
    const cmd = args.command || args.cmd;
    if (!cmd) return null;

    const cmdStr = String(cmd);
    const truncated = cmdStr.length > 60 ? cmdStr.substring(0, 60) + '...' : cmdStr;

    // Try to identify the type of command
    const firstWord = cmdStr.trim().split(/\s+/)[0] || '';

    return {
      tool: 'terminalCommand',
      description: `${firstWord}: ${truncated}`,
    };
  }

  private static extractGitOperation(args: Record<string, unknown>): OperationLogEntry | null {
    const command = args.command || args.subcommand;
    if (!command) return null;

    return {
      tool: 'git',
      description: `git ${command}`,
    };
  }

  /**
   * Get file name from a path using Node.js path.basename()
   * This provides cross-platform compatibility (handles Windows backslashes)
   */
  private static getFileName(path: unknown): string | null {
    if (!path || typeof path !== 'string') return null;
    return basename(path);
  }

  /**
   * Format operation log entries as a string for injection into prompts
   *
   * @param entries - Operation log entries to format
   * @returns Formatted string
   */
  static format(entries: OperationLogEntry[]): string {
    if (entries.length === 0) return '';

    // Group by tool for readability
    const byTool: Record<string, OperationLogEntry[]> = {};

    for (const entry of entries) {
      if (!byTool[entry.tool]) byTool[entry.tool] = [];
      byTool[entry.tool]!.push(entry);
    }

    const sections: string[] = [];

    // File operations first (most important)
    if (byTool.str_replace_based_edit_tool) {
      const allFiles = new Set<string>();
      for (const op of byTool.str_replace_based_edit_tool) {
        if (op.files) op.files.forEach(f => allFiles.add(f));
      }
      sections.push(`Files modified: ${Array.from(allFiles).join(', ')}`);
    }

    if (byTool.readFile) {
      const files = byTool.readFile
        .filter(op => op.files)
        .flatMap(op => op.files!)
        .filter((f, i, arr) => arr.indexOf(f) === i); // unique
      if (files.length > 0) {
        sections.push(`Files read: ${files.join(', ')}`);
      }
    }

    if (byTool.terminalCommand) {
      const cmds = byTool.terminalCommand.map(op => op.description);
      sections.push(`Commands run: ${cmds.join('; ')}`);
    }

    if (byTool.git) {
      const gitOps = byTool.git.map(op => op.description);
      sections.push(`Git operations: ${gitOps.join('; ')}`);
    }

    return sections.join('\n');
  }

  /**
   * Deserialize operation log from storage into structured entries
   *
   * Supports:
   * - Versioned JSON envelope: { version: 1, entries: [...] }
   * - Legacy formatted text (best-effort parse)
   *
   * @param operationLog - Stored operation log string
   * @returns Array of operation log entries
   */
  static deserialize(operationLog: string | null | undefined): OperationLogEntry[] {
    if (!operationLog || operationLog.trim() === '') {
      return [];
    }

    const normalized = operationLog.replace(/^\uFEFF/, '').trimStart();

    if (normalized.startsWith('{') || normalized.startsWith('[')) {
      try {
        const parsed = JSON.parse(normalized) as unknown;
        const entries = this.extractEntriesFromParsedLog(parsed);
        if (entries) {
          return entries;
        }
      } catch {
        // Fall through to legacy parsing
      }
    }

    return this.parseLegacyText(operationLog);
  }

  /**
   * Serialize operation log entries for storage
   *
   * @param entries - Operation log entries to serialize
   * @returns Versioned JSON string
   */
  static serialize(entries: OperationLogEntry[]): string {
    return JSON.stringify({ version: this.logVersion, entries });
  }

  /**
   * Extract and prune operation log entries to prevent unbounded growth
   *
   * This is a convenience method that combines extract() and pruning logic.
   * Use this when extracting operation logs for summarization to ensure
   * the log doesn't grow indefinitely in long conversations.
   *
   * @param messages - Messages to extract operations from
   * @param maxOperations - Maximum operations to keep (default: 500)
   * @returns Pruned operation log entries
   */
  static extractAndPrune(
    messages: LLMMessage[],
    maxOperations: number = 500
  ): OperationLogEntry[] {
    const entries = this.extract(messages);

    if (entries.length <= maxOperations) {
      return entries;
    }

    return OperationLogPruner.prune(entries, maxOperations);
  }

  private static extractEntriesFromParsedLog(parsed: unknown): OperationLogEntry[] | null {
    if (parsed && typeof parsed === 'object') {
      const envelope = parsed as { entries?: unknown };
      if (Array.isArray(envelope.entries)) {
        return this.normalizeEntries(envelope.entries);
      }
    }

    return null;
  }

  private static normalizeEntries(entries: unknown[]): OperationLogEntry[] {
    return entries.filter(this.isOperationLogEntry);
  }

  private static isOperationLogEntry(entry: unknown): entry is OperationLogEntry {
    if (!entry || typeof entry !== 'object') {
      return false;
    }

    const candidate = entry as Partial<OperationLogEntry>;
    return typeof candidate.tool === 'string' && typeof candidate.description === 'string';
  }

  private static parseLegacyText(formattedLog: string): OperationLogEntry[] {
    if (!formattedLog || formattedLog.trim() === '') {
      return [];
    }

    const entries: OperationLogEntry[] = [];
    const lines = formattedLog.split('\n').filter(line => line.trim());

    for (const line of lines) {
      // Parse "Files modified: file1, file2, file3"
      if (line.startsWith('Files modified:')) {
        const filesStr = line.substring('Files modified:'.length).trim();
        const files = filesStr.split(',').map(f => f.trim()).filter(f => f);
        for (const file of files) {
          entries.push({
            tool: 'str_replace_based_edit_tool',
            files: [file],
            mode: 'edit',
            description: `edit: ${file}`,
          });
        }
      }
      // Parse "Files read: file4, file5"
      else if (line.startsWith('Files read:')) {
        const filesStr = line.substring('Files read:'.length).trim();
        const files = filesStr.split(',').map(f => f.trim()).filter(f => f);
        for (const file of files) {
          entries.push({
            tool: 'readFile',
            files: [file],
            description: `Read ${file}`,
          });
        }
      }
      // Parse "Commands run: npm: npm install; git: git commit"
      else if (line.startsWith('Commands run:')) {
        const cmdsStr = line.substring('Commands run:'.length).trim();
        const cmds = cmdsStr.split(';').map(c => c.trim()).filter(c => c);
        for (const cmd of cmds) {
          entries.push({
            tool: 'terminalCommand',
            description: cmd,
          });
        }
      }
      // Parse "Git operations: git commit; git push"
      else if (line.startsWith('Git operations:')) {
        const opsStr = line.substring('Git operations:'.length).trim();
        const ops = opsStr.split(';').map(o => o.trim()).filter(o => o);
        for (const op of ops) {
          entries.push({
            tool: 'git',
            description: op,
          });
        }
      }
    }

    return entries;
  }

  /**
   * Merge existing operation log entries with new entries and prune to max size
   *
   * This method deduplicates entries by description to avoid redundant operations
   * in the log, then prunes to the maximum size if needed.
   *
   * @param existingEntries - Existing operation log entries
   * @param newEntries - New entries to merge in
   * @param maxOperations - Maximum operations to keep (default: 500)
   * @returns Merged and pruned operation log entries
   */
  static mergeAndPrune(
    existingEntries: OperationLogEntry[],
    newEntries: OperationLogEntry[],
    maxOperations: number = 500
  ): OperationLogEntry[] {
    // Combine entries, with new entries at the end (preserving chronological order)
    const combined = [...existingEntries, ...newEntries];

    // Deduplicate by description (keep most recent occurrence)
    const seen = new Map<string, OperationLogEntry>();
    for (const entry of combined) {
      const key = `${entry.tool}:${entry.description}`;
      // Delete before re-setting to move key to end (preserves chronological order)
      if (seen.has(key)) {
        seen.delete(key);
      }
      seen.set(key, entry);
    }

    const deduplicated = Array.from(seen.values());

    // Prune if over limit
    if (deduplicated.length <= maxOperations) {
      return deduplicated;
    }

    return OperationLogPruner.prune(deduplicated, maxOperations);
  }
}
