import type { SupportedFileType } from '@airo/ai-lib'

const DECLARED_MIME_TO_SUPPORTED: Record<string, SupportedFileType> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/gif': 'image/gif',
  'image/webp': 'image/webp'
}

/**
 * Parse a data-URL screenshot (or legacy bare base64) for attachment to the analyzer.
 * Returns null when the payload cannot be decoded to a non-empty buffer.
 */
export function parseScreenshotDataUrl(screenshotBase64: string): {
  buffer: Buffer
  mimeType: SupportedFileType
} | null {
  const trimmed = screenshotBase64.trim()
  const dataUrlMatch = trimmed.match(/^data:(image\/[^\s;]+);base64,(.*)$/i)

  if (dataUrlMatch) {
    const declaredMime = dataUrlMatch[1]
    const payload = dataUrlMatch[2]
    if (declaredMime === undefined || payload === undefined) {
      return null
    }
    const declared = declaredMime.toLowerCase()
    const mimeType = DECLARED_MIME_TO_SUPPORTED[declared]
    if (!mimeType) {
      return null
    }
    const b64 = payload.replace(/\s/g, '')
    try {
      const buffer = Buffer.from(b64, 'base64')
      if (buffer.length === 0) {
        return null
      }
      return { buffer, mimeType }
    } catch {
      return null
    }
  }

  if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.length >= 16) {
    try {
      const buffer = Buffer.from(trimmed.replace(/\s/g, ''), 'base64')
      if (buffer.length === 0) {
        return null
      }
      return { buffer, mimeType: 'image/png' }
    } catch {
      return null
    }
  }

  return null
}

export function screenshotFilenameForMime(mimeType: SupportedFileType): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'homepage.jpg'
    case 'image/webp':
      return 'homepage.webp'
    case 'image/gif':
      return 'homepage.gif'
    default:
      return 'homepage.png'
  }
}
