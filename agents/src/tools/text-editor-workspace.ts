import { basename, extname } from 'node:path';

import { DevSupervisorError } from '../services/DevSupervisorClient.js';
import type { WorkspaceFiles, TreeEntry } from '../workspace/files.js';
import {
  BINARY_FILE_REGEX,
  IMAGE_FILE_EXTENSIONS,
  DOCUMENT_FILE_EXTENSIONS,
  OTHER_BINARY_EXTENSIONS,
} from '../utils/file-types.js';

/**
 * Success message prefixes returned by edit commands.
 * Shared with ToolResultCompressionStrategy to detect successful edit results.
 */
export const EDIT_SUCCESS_PREFIXES = [
  'successfully replaced text',
  'successfully created',
  'successfully inserted text',
] as const;

/**
 * True when a text-editor tool result reports a successful write. The `create`
 * skip-branches (no matching upload, file left unchanged, transient copy error)
 * and read/error outputs return other strings, so this lets callers tell a real
 * write from a no-op/failed edit — e.g. artifact reporting must not count a
 * `create` that wrote nothing. Matches {@link EDIT_SUCCESS_PREFIXES}
 * case-insensitively (the same prefixes ToolResultCompressionStrategy gates on).
 */
export function isSuccessfulEditResult(output: unknown): boolean {
  if (typeof output !== 'string') return false;
  const lower: string = output.toLowerCase();
  return EDIT_SUCCESS_PREFIXES.some((prefix: string): boolean => lower.startsWith(prefix));
}

/** Hard cap on snippet size — keeps error messages lean to reduce token waste on retries */
const MAX_SNIPPET_CHARS = 5_000;

/** Lines of context above/below each match in multi-match errors */
const MULTI_MATCH_CONTEXT_LINES = 2;

/** Max match-location blocks in multi-match errors */
const MULTI_MATCH_SNIPPETS_CAP = 5;

/** Max start-line numbers listed in the error header */
const MULTI_MATCH_HEADER_LINES_CAP = 20;

function countNewlines(text: string, from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }
  return n;
}

function formatMatchStartLinesHeader(lines: number[]): string {
  if (lines.length <= MULTI_MATCH_HEADER_LINES_CAP) {
    return lines.join(', ');
  }
  const head = lines.slice(0, MULTI_MATCH_HEADER_LINES_CAP).join(', ');
  const rest = lines.length - MULTI_MATCH_HEADER_LINES_CAP;
  return `${head}, … (${rest} more)`;
}

function buildErrorSnippet(lines: string[], searchText: string): string {
  const formatLines = (selected: string[], startLine: number, charBudget: number): { text: string; chars: number } => {
    let result = '';
    let totalChars = 0;
    for (let i = 0; i < selected.length; i++) {
      const fullLine = `${String(startLine + i).padStart(6)}\t${selected[i]!}`;
      if (totalChars + fullLine.length + 1 > charBudget) {
        if (totalChars === 0) {
          const truncLen = Math.max(0, charBudget - 50);
          result = fullLine.slice(0, truncLen) + `\n... (truncated, ${fullLine.length} chars) ...`;
          totalChars = result.length;
        } else {
          result += `\n... (truncated at ${charBudget} chars) ...`;
        }
        break;
      }
      if (i > 0) result += '\n';
      result += fullLine;
      totalChars += fullLine.length + 1;
    }
    return { text: result, chars: totalChars };
  };

  if (lines.length <= 40) {
    return formatLines(lines, 1, MAX_SNIPPET_CHARS).text;
  }

  const firstSearchLine = searchText.split('\n')[0]?.trim();
  if (firstSearchLine && firstSearchLine.length > 10) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.includes(firstSearchLine)) {
        const start = Math.max(0, i - 50);
        const end = Math.min(lines.length, i + 51);
        return formatLines(lines.slice(start, end), start + 1, MAX_SNIPPET_CHARS).text;
      }
    }
  }

  const headMax = 50;
  const tailMax = 50;
  const headCount = Math.min(headMax, lines.length);
  const tailCount = Math.min(tailMax, lines.length - headCount);

  if (tailCount === 0 || headCount + tailCount === lines.length) {
    return formatLines(lines, 1, MAX_SNIPPET_CHARS).text;
  }

  const omitted = lines.length - headCount - tailCount;
  const head = formatLines(lines.slice(0, headCount), 1, MAX_SNIPPET_CHARS);
  const separator = `\n... (${omitted} line${omitted === 1 ? '' : 's'} omitted) ...\n`;
  const tailBudget = MAX_SNIPPET_CHARS - head.chars - separator.length;
  const tailStartLine = lines.length - tailCount + 1;
  const tail = tailBudget > 0
    ? formatLines(lines.slice(-tailCount), tailStartLine, tailBudget).text
    : '... (tail truncated) ...';
  return `${head.text}${separator}${tail}`;
}

function buildMultiMatchError(content: string, oldStr: string, lines: string[]): string {
  const matches = content.split(oldStr).length - 1;
  const oldLineCount = oldStr.split('\n').length;
  const ctx = MULTI_MATCH_CONTEXT_LINES;
  const matchSnippets: string[] = [];
  let searchFrom = 0;
  const lineCount = lines.length;
  const lastLineIdx = lineCount > 0 ? lineCount - 1 : 0;
  const maxShow = Math.min(matches, MULTI_MATCH_SNIPPETS_CAP);
  const oldStrNewlineCount = countNewlines(oldStr, 0, oldStr.length);
  let lineAtSearchFrom = 1;
  const matchStartLines: number[] = [];

  for (let i = 0; i < matches; i++) {
    const idx = content.indexOf(oldStr, searchFrom);
    if (idx === -1) break;
    const startLine = lineAtSearchFrom + countNewlines(content, searchFrom, idx);
    matchStartLines.push(startLine);

    if (i < maxShow) {
      const rawStartLine0 = startLine - 1;
      const rawEndLine0 = rawStartLine0 + oldLineCount - 1;
      const startLine0 = Math.min(Math.max(0, rawStartLine0), lastLineIdx);
      const endLine0 = Math.min(Math.max(startLine0, rawEndLine0), lastLineIdx);
      const sliceStart = Math.max(0, startLine0 - ctx);
      const sliceEndExclusive = Math.min(
        lineCount,
        Math.max(sliceStart + 1, endLine0 + ctx + 1),
      );
      const block = lines.slice(sliceStart, sliceEndExclusive)
        .map((line, j) => `${String(sliceStart + j + 1).padStart(6)}\t${line}`)
        .join('\n');
      matchSnippets.push(`Match ${i + 1} (starts line ${startLine}):\n${block}`);
    }

    lineAtSearchFrom = startLine + oldStrNewlineCount;
    searchFrom = idx + oldStr.length;
  }

  let detail = matchSnippets.join('\n\n');
  const truncationNote = `\n\n... (match detail truncated at ${MAX_SNIPPET_CHARS} characters)`;
  if (detail.length > MAX_SNIPPET_CHARS) {
    detail = `${detail.slice(0, MAX_SNIPPET_CHARS - truncationNote.length).trimEnd()}${truncationNote}`;
  }

  const linesHeader = formatMatchStartLinesHeader(matchStartLines);
  const summary =
    `Found ${matches} matches for old_str at lines: ${linesHeader}. Include more surrounding context to make it unique.`;

  const omittedBlocks = matches - matchSnippets.length;
  const omittedNote =
    omittedBlocks > 0
      ? `\n\n${omittedBlocks} more match location${omittedBlocks === 1 ? '' : 's'} not shown.`
      : '';

  return `${summary}\n\n${detail}${omittedNote}`;
}

function isDirectoryError(err: unknown): boolean {
  if (err instanceof DevSupervisorError) {
    return err.code === 'is_directory' || err.message.includes('is a directory');
  }
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('is a directory') || msg.includes('EISDIR');
}

function isBinaryFileError(err: unknown): boolean {
  return err instanceof DevSupervisorError && err.code === 'binary_file';
}

function isNoMatchError(err: unknown): boolean {
  return err instanceof DevSupervisorError && err.code === 'no_match';
}

function isAmbiguousMatchError(err: unknown): boolean {
  return err instanceof DevSupervisorError && err.code === 'ambiguous_match';
}

function formatTreeEntries(entries: TreeEntry[]): string {
  const formatted = entries.map((e: TreeEntry): string =>
    e.kind === 'directory' ? `${e.path}/` : e.path
  );
  return `Contents:\n${formatted.join('\n')}`;
}

export async function handleView(
  files: WorkspaceFiles,
  path: string,
  viewRange?: [number, number],
): Promise<string> {
  const ext = extname(path).slice(1).toLowerCase();

  if (BINARY_FILE_REGEX.test(path) || (OTHER_BINARY_EXTENSIONS as readonly string[]).includes(ext)) {
    const name = basename(path);
    if ((IMAGE_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
      return `Cannot read ${name} — image file. Reference by path in code. Ask the user to describe visual content if needed.`;
    }
    if ((DOCUMENT_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
      return `Cannot read ${name} — ${ext.toUpperCase()} not supported. Ask the user to paste relevant content into chat.`;
    }
    return `Cannot read ${name} — binary file. Reference by path in code.`;
  }

  try {
    const viewOptions: { path: string; offset?: number; limit?: number } = { path };
    if (viewRange) {
      viewOptions.offset = viewRange[0] - 1;
      if (viewRange[1] !== -1) {
        viewOptions.limit = viewRange[1] - viewRange[0] + 1;
      }
    }
    const result = await files.view(viewOptions);
    return result.content;
  } catch (err: unknown) {
    if (isDirectoryError(err)) {
      const treeResult = await files.tree({ path, recursive: false });
      return formatTreeEntries(treeResult.entries);
    }
    if (isBinaryFileError(err)) {
      return `Cannot read ${basename(path)} — binary file. Reference by path in code.`;
    }
    throw err;
  }
}

export async function handleStrReplace(
  files: WorkspaceFiles,
  path: string,
  oldStr: string,
  newStr: string,
): Promise<string> {
  try {
    await files.edit({ path, oldString: oldStr, newString: newStr });
    return 'Successfully replaced text.';
  } catch (err: unknown) {
    if (isNoMatchError(err)) {
      const content: string = await files.readText({ path });
      const lines = content.split('\n');
      const snippet = buildErrorSnippet(lines, oldStr);
      throw new Error(
        `No match found for old_str in this file.\n\n` +
        `File content (${lines.length} lines):\n${snippet}`,
      );
    }

    if (isAmbiguousMatchError(err)) {
      const content: string = await files.readText({ path });
      const lines = content.split('\n');
      throw new Error(buildMultiMatchError(content, oldStr, lines));
    }

    throw err;
  }
}

export async function handleCreate(
  files: WorkspaceFiles,
  path: string,
  fileText: string,
): Promise<string> {
  await files.write({ path, content: fileText });
  return `Successfully created ${basename(path)}`;
}

export async function handleInsert(
  files: WorkspaceFiles,
  path: string,
  insertLine: number,
  insertText: string,
): Promise<string> {
  // insertLine = "after line N" (Anthropic tool semantics, 0-based splice index)
  // workspace API line = "before line N" (1-based); so after-5 = before-6
  await files.insert({ path, line: insertLine + 1, content: insertText });
  return `Successfully inserted text at line ${insertLine}`;
}
