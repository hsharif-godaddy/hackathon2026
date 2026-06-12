export const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

export function isImageFileName(name: string): boolean {
  return getExtension(name) in MIME_MAP
}

export function getExtension(fileName: string): string {
  return fileName.substring(fileName.lastIndexOf('.')).toLowerCase()
}
