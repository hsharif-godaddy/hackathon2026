import { readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, basename, extname } from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { rename, unlink } from 'node:fs/promises';

import { BINARY_FILE_REGEX, DOCUMENT_FILE_EXTENSIONS, IMAGE_FILE_EXTENSIONS, OTHER_BINARY_EXTENSIONS, TEXT_FILE_REGEX, isBinaryFile } from '../utils/file-types.js';

/**
 * Success message prefixes returned by edit commands.
 * Shared with ToolResultCompressionStrategy to detect successful edit results
 * without false positives from error messages containing embedded file content.
 */
export const EDIT_SUCCESS_PREFIXES = [
  'successfully replaced text',
  'successfully created',
  'successfully inserted text',
] as const;

/**
 * Text Editor Command Handlers
 *
 * Implements the four commands for Anthropic's schema-less text editor tool:
 * - view: Read files or list directories
 * - str_replace: Replace exact text match
 * - create: Create new file
 * - insert: Insert text at line number
 *
 * These handlers follow Anthropic's text editor specifications and use
 * efficient streaming operations for large files.
 */

/**
 * Handle 'view' command - read files or list directories
 * Returns content with line numbers in Anthropic's expected format
 * EFFICIENT: Uses line-by-line streaming for large files with view_range
 */
export async function handleView(
  fullPath: string,
  viewRange?: [number, number]
): Promise<string> {
  if (!existsSync(fullPath)) {
    throw new Error('File does not exist');
  }

  // Check if directory before binary detection — a directory named e.g. "assets.png/" should list contents
  const stats = await stat(fullPath);
  if (stats.isDirectory()) {
    const files = await readdir(fullPath);
    return `Contents:\n${files.join('\n')}`;
  }

  // Binary files produce garbled output when read as UTF-8, wasting massive tokens.
  // SVG is excluded — it's XML text despite being in BINARY_FILE_REGEX (which is used for copy logic).
  const ext = extname(fullPath).slice(1).toLowerCase();
  if ((BINARY_FILE_REGEX.test(fullPath) && ext !== 'svg') || (OTHER_BINARY_EXTENSIONS as readonly string[]).includes(ext)) {
    const name = basename(fullPath);

    if ((IMAGE_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
      return `Cannot read ${name} — image file. Reference by path in code. Ask the user to describe visual content if needed.`;
    }
    if ((DOCUMENT_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
      return `Cannot read ${name} — ${ext.toUpperCase()} not supported. Ask the user to paste relevant content into chat.`;
    }
    return `Cannot read ${name} — binary file. Reference by path in code.`;
  }

  // Fallback: sniff first 8KB for null bytes — only for files with unknown extensions
  if (!BINARY_FILE_REGEX.test(fullPath) && !TEXT_FILE_REGEX.test(fullPath) && !(OTHER_BINARY_EXTENSIONS as readonly string[]).includes(ext)) {
    if (await isBinaryFile(fullPath)) {
      return `Cannot read ${basename(fullPath)} — binary file detected. Reference by path in code.`;
    }
  }

  // For view_range on large files, use streaming to avoid buffering
  if (viewRange) {
    const [start, end] = viewRange;

    // Only stream if file is large AND view_range is small subset
    if (stats.size > 1024 * 1024 && (end === -1 || (end - start) < 1000)) {
      let currentLine = 0;
      const result: string[] = [];
      const endLine = end === -1 ? Infinity : end;

      const rl = createInterface({
        input: createReadStream(fullPath),
        crlfDelay: Infinity
      });

      for await (const line of rl) {
        currentLine++;

        if (currentLine >= start && currentLine <= endLine) {
          result.push(`${currentLine}: ${line}`);
        }

        // Stop reading once we've passed the end
        if (currentLine > endLine) {
          rl.close();
          break;
        }
      }

      return result.join('\n');
    }
  }

  // For small files or full reads, use simple approach
  const content = await readFile(fullPath, 'utf-8');
  const lines = content.split('\n');

  // Apply view range if specified
  let selectedLines = lines;
  let startLine = 1;

  if (viewRange) {
    const [start, end] = viewRange;
    startLine = start;
    const endIndex = end === -1 ? lines.length : end;
    selectedLines = lines.slice(start - 1, endIndex);
  }

  // Format with line numbers (Anthropic format: "1: content")
  const formatted = selectedLines
    .map((line, i) => `${startLine + i}: ${line}`)
    .join('\n');

  return formatted;
}

/** Hard cap on snippet size — keeps error messages lean to reduce token waste on retries */
const MAX_SNIPPET_CHARS = 5_000;

/** Lines of context above/below each match in multi-match errors */
const MULTI_MATCH_CONTEXT_LINES = 2;

function countNewlines(text: string, from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }
  return n;
}

/** Max match-location blocks in multi-match errors (avoids huge output for repeated short old_str) */
const MULTI_MATCH_SNIPPETS_CAP = 5;

/** Max start-line numbers listed in the error header (rest summarized) */
const MULTI_MATCH_HEADER_LINES_CAP = 20;

function formatMatchStartLinesHeader(lines: number[]): string {
  if (lines.length <= MULTI_MATCH_HEADER_LINES_CAP) {
    return lines.join(', ');
  }
  const head = lines.slice(0, MULTI_MATCH_HEADER_LINES_CAP).join(', ');
  const rest = lines.length - MULTI_MATCH_HEADER_LINES_CAP;
  return `${head}, … (${rest} more)`;
}

/**
 * Build a file content snippet for error messages.
 * Uses the same line number format as handleView so the LLM can construct correct replacements.
 */
function buildErrorSnippet(lines: string[], searchText: string): string {
  /**
   * Format lines with a character budget. Returns the formatted string and chars consumed.
   */
  const formatLines = (selected: string[], startLine: number, charBudget: number): { text: string; chars: number } => {
    let result = '';
    let totalChars = 0;
    for (let i = 0; i < selected.length; i++) {
      // Use readFile format (padded line number + pipe) so the LLM recognises this as file content
      const fullLine = `${String(startLine + i).padStart(6)}|${selected[i]!}`;
      if (totalChars + fullLine.length + 1 > charBudget) {
        // If we haven't emitted any content yet, include a truncated prefix of this line
        // so the LLM gets at least some context (handles minified single-line files)
        if (totalChars === 0) {
          const truncLen = Math.max(0, charBudget - 50); // leave room for truncation marker
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

  // Small files: show everything (subject to char cap)
  if (lines.length <= 40) {
    return formatLines(lines, 1, MAX_SNIPPET_CHARS).text;
  }

  // Try to find the best partial match location using the first line of the search text
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

  // No partial match: up to first 50 + last 50 lines without overlap; omit middle only when needed
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

/**
 * Handle 'str_replace' command - replace exact text match
 * Must match exactly once (Anthropic requirement)
 * EFFICIENT: Uses simple read/write for most cases
 */
export async function handleStrReplace(
  fullPath: string,
  oldStr: string,
  newStr: string
): Promise<string> {
  if (!existsSync(fullPath)) {
    throw new Error('File does not exist');
  }

  const content = await readFile(fullPath, 'utf-8');

  // Check for exact unique match (Anthropic requirement)
  const matches = content.split(oldStr).length - 1;

  if (matches === 0) {
    const lines = content.split('\n');
    const snippet = buildErrorSnippet(lines, oldStr);
    throw new Error(
      `No match found for old_str in this file.\n\n` +
      `File content (${lines.length} lines):\n${snippet}`
    );
  }

  if (matches > 1) {
    const lines = content.split('\n');
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
          .map((line, j) => `${String(sliceStart + j + 1).padStart(6)}|${line}`)
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

    throw new Error(`${summary}\n\n${detail}${omittedNote}`);
  }

  // Perform single replacement
  const newContent = content.replace(oldStr, newStr);
  await writeFile(fullPath, newContent, 'utf-8');

  return 'Successfully replaced text.';
}

/**
 * Handle 'create' command - create new file
 */
export async function handleCreate(
  fullPath: string,
  fileText: string
): Promise<string> {
  // Create parent directories
  await mkdir(dirname(fullPath), { recursive: true });

  // Write file (overwrites if exists, matching native text_editor_20250728 behavior)
  await writeFile(fullPath, fileText, 'utf-8');

  return `Successfully created ${basename(fullPath)}`;
}

/**
 * Handle 'insert' command - insert text at line number
 * EFFICIENT: Uses streaming to avoid buffering entire file for large files
 */
export async function handleInsert(
  fullPath: string,
  insertLine: number,
  insertText: string
): Promise<string> {
  if (!existsSync(fullPath)) {
    throw new Error('File does not exist');
  }

  // For small files (<1MB), use simple approach
  const stats = await stat(fullPath);
  if (stats.size < 1024 * 1024) {
    const content = await readFile(fullPath, 'utf-8');
    const lines = content.split('\n');
    lines.splice(insertLine, 0, insertText);
    await writeFile(fullPath, lines.join('\n'), 'utf-8');
    return `Successfully inserted text at line ${insertLine}`;
  }

  // For large files, use streaming approach
  const tmpPath = `${fullPath}.tmp`;

  let currentLine = 0;
  const writeStream = createWriteStream(tmpPath);

  try {
    const rl = createInterface({
      input: createReadStream(fullPath),
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      // Insert text before this line if we're at insertLine
      if (currentLine === insertLine) {
        writeStream.write(insertText + '\n');
      }
      writeStream.write(line + '\n');
      currentLine++;
    }

    // If insertLine is beyond end of file, append
    if (insertLine >= currentLine) {
      writeStream.write(insertText + '\n');
    }

    writeStream.end();
    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', () => resolve());
      writeStream.on('error', reject);
    });

    // Replace original with temp file
    await rename(tmpPath, fullPath);
    return `Successfully inserted text at line ${insertLine}`;

  } catch (error) {
    // Clean up temp file on error
    if (existsSync(tmpPath)) {
      await unlink(tmpPath);
    }
    throw error;
  }
}
