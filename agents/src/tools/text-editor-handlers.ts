import { readFile, writeFile, mkdir, stat, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, basename } from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { createInterface } from 'readline';
import { rename, unlink } from 'fs/promises';

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

  // Check if directory
  const stats = await stat(fullPath);
  if (stats.isDirectory()) {
    const files = await readdir(fullPath);
    return `Directory contents:\n${files.join('\n')}`;
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
    throw new Error('No match found for replacement. Please check your text and try again.');
  }

  if (matches > 1) {
    throw new Error(`Found ${matches} matches for replacement text. Please provide more context to make a unique match.`);
  }

  // Perform single replacement
  const newContent = content.replace(oldStr, newStr);
  await writeFile(fullPath, newContent, 'utf-8');

  return 'Successfully replaced text at exactly one location.';
}

/**
 * Handle 'create' command - create new file
 */
export async function handleCreate(
  fullPath: string,
  fileText: string
): Promise<string> {
  if (existsSync(fullPath)) {
    throw new Error('File already exists. Use str_replace to modify existing files.');
  }

  // Create parent directories
  await mkdir(dirname(fullPath), { recursive: true });

  // Write file
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
