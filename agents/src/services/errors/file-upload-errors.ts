/**
 * Custom error classes for FileUploadService.
 * Used by routes/files.ts to distinguish 400 (client) from 500 (server) errors
 * without fragile string matching on error messages.
 */

export class FileValidationError extends Error {
  readonly errorType = 'FILE_VALIDATION'

  constructor(message: string) {
    super(message)
    this.name = 'FileValidationError'
  }
}

export class SVGSanitizationError extends Error {
  readonly errorType = 'SVG_SANITIZATION'
  readonly filename: string
  readonly detail: string | undefined

  constructor(filename: string, detail?: string) {
    super(`Failed to sanitize SVG file: ${filename}`)
    this.name = 'SVGSanitizationError'
    this.filename = filename
    this.detail = detail
  }
}

export function isClientError(error: unknown): boolean {
  return error instanceof FileValidationError
    || error instanceof SVGSanitizationError
}
