/**
 * File Type Detection Utilities
 *
 * Shared constants for detecting file types by extension.
 * Used for security validation and content handling across the agents service.
 */

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
export const BINARY_FILE_EXTENSIONS = [
  // Images
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'svg',
  // Fonts
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  // Audio
  'mp3', 'wav',
  // Video
  'mp4', 'webm',
  // Documents
  'pdf'
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
