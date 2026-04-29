/**
 * File Type Detection Utilities
 *
 * Shared constants for detecting file types by extension.
 * Used for security validation and content handling across the agents service.
 */

import type { FileSystemOperations } from '../filesystem/index.js'
import { defaultLocalFs } from '../filesystem/index.js'

/**
 * Source code file extensions that should not contain temporary upload URLs
 *
 * SECURITY CRITICAL: These extensions are used by validateNoApiPaths() in file-edit.ts
 * to prevent upload URLs (/files/uploads/) from being written to source code, since those are
 * temporary URLs that will break in production.
 */
export const SOURCE_FILE_EXTENSIONS = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'html',
  'htm',
  'css',
  'scss',
  'vue',
  'svelte'
] as const

/**
 * Binary file extensions that cannot be processed as text
 *
 * Includes images, fonts, audio, video, and documents.
 * Used by file-edit.ts to detect binary files during auto-resolution.
 */
export const IMAGE_FILE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'] as const
export const DOCUMENT_FILE_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'] as const
export const OTHER_BINARY_EXTENSIONS = ['zip', 'tar', 'gz', 'rar', '7z', 'db', 'sqlite', 'sqlite3', 'bin', 'exe', 'dll', 'so'] as const

export const BINARY_FILE_EXTENSIONS = [
  // Images (+ svg which is text but handled as binary for copy logic)
  ...IMAGE_FILE_EXTENSIONS, 'svg',
  // Fonts
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  // Audio
  'mp3', 'wav', 'ogg', 'm4a', 'aac',
  // Video
  'mp4', 'webm', 'mov',
  // Documents
  ...DOCUMENT_FILE_EXTENSIONS,
] as const

/**
 * Pre-compiled regex for detecting binary files
 *
 * Used by file-edit.ts to check if auto-resolved files should be
 * processed as binary rather than text.
 */
export const BINARY_FILE_REGEX = new RegExp(`\\.(${BINARY_FILE_EXTENSIONS.join('|')})$`, 'i')

/**
 * Pre-compiled regex for detecting source code files
 *
 * SECURITY: Used to validate that /api/files/ URLs are not written to source files
 */
export const SOURCE_FILE_REGEX = new RegExp(`\\.(${SOURCE_FILE_EXTENSIONS.join('|')})$`, 'i')

/**
 * Common text file extensions beyond source code.
 * Combined with SOURCE_FILE_EXTENSIONS to skip binary sniffing for known text formats.
 */
const TEXT_FILE_EXTENSIONS = [
  ...SOURCE_FILE_EXTENSIONS,
  'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'md', 'mdx', 'txt', 'csv', 'tsv', 'rst',
  'xml', 'xsl', 'xslt', 'rss', 'atom', 'plist',
  'sql', 'graphql', 'gql', 'prisma',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'env', 'gitignore', 'gitattributes', 'editorconfig', 'eslintrc', 'prettierrc',
  'dockerignore', 'hbs', 'ejs', 'njk', 'pug', 'jade', 'mustache',
  'less', 'sass', 'styl', 'pcss',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'cpp', 'h', 'hpp', 'cs',
  'php', 'pl', 'pm', 'r', 'lua', 'ex', 'exs', 'erl', 'hs', 'ml',
  'tf', 'hcl', 'lock', 'log', 'map', 'snap',
  'mjs', 'cjs', 'mts', 'cts', 'd.ts',
] as const

export const TEXT_FILE_REGEX = new RegExp(`\\.(${TEXT_FILE_EXTENSIONS.join('|')})$`, 'i')

/**
 * Check if a file path is a source code file
 *
 * @param filePath - File path or name to check
 * @returns True if the file is a source code file that should not contain temporary API URLs
 *
 * @example
 * isSourceFile('src/App.tsx') // true
 * isSourceFile('config.json') // false
 * isSourceFile('styles.css') // true
 */
export function isSourceFile(filePath: string): boolean {
  return SOURCE_FILE_REGEX.test(filePath)
}

/**
 * Get the file extension from a path
 *
 * @param filePath - File path or name
 * @returns The extension (without dot) or empty string if no extension
 *
 * @example
 * getFileExtension('App.tsx') // 'tsx'
 * getFileExtension('README') // ''
 */
export function getFileExtension(filePath: string): string {
  const match = filePath.match(/\.([^.]+)$/i)
  return match?.[1]?.toLowerCase() ?? ''
}

const SNIFF_SIZE = 8192

/**
 * Detect binary content by checking for null bytes in the first 8KB.
 * This is the same heuristic Git uses — text files virtually never
 * contain 0x00, while binary files almost always do.
 */
export async function isBinaryFile(filePath: string, fs: FileSystemOperations = defaultLocalFs): Promise<boolean> {
  let fh
  try {
    fh = await fs.open(filePath, 'r')
    const buf = Buffer.alloc(SNIFF_SIZE)
    const { bytesRead } = await fh.read(buf, 0, SNIFF_SIZE, 0)
    return buf.subarray(0, bytesRead).includes(0x00)
  } catch (err) {
    // Missing file isn't binary — let the subsequent read produce the real error.
    // Permission/IO errors should propagate so callers see the real cause.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  } finally {
    await fh?.close()
  }
}
