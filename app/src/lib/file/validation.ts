import { getExtension } from './utils'

type MagicCheck = { bytes: number[]; offset?: number }

const IMAGE_SIGNATURES: Record<string, MagicCheck[]> = {
  '.png':  [{ bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] }],
  '.jpg':  [{ bytes: [0xFF, 0xD8, 0xFF] }],
  '.jpeg': [{ bytes: [0xFF, 0xD8, 0xFF] }],
  '.gif':  [{ bytes: [0x47, 0x49, 0x46, 0x38] }], // "GIF8" covers GIF87a and GIF89a
  '.webp': [{ bytes: [0x52, 0x49, 0x46, 0x46] }, { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 }],
}

function hasValidSignature(buffer: ArrayBuffer, extension: string): boolean {
  const checks = IMAGE_SIGNATURES[extension]
  if (!checks) {
    return true
  }

  const view = new Uint8Array(buffer)
  return checks.every(({ bytes, offset = 0 }) =>
    view.length >= offset + bytes.length && bytes.every((byte, index) => view[offset + index] === byte),
  )
}

function containsScriptThreats(document: Document): boolean {
  if (document.querySelectorAll('script').length > 0) {
    return true
  }

  for (const element of Array.from(document.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.toLowerCase().startsWith('on')) return true
      // eslint-disable-next-line no-script-url -- detecting the pattern, not using it
      if (attribute.value.toLowerCase().includes('javascript:')) return true
    }
  }

  return false
}

/** Returns false for malformed SVG — an unparseable file cannot execute scripts. */
function hasSvgThreats(content: string): boolean {
  const document = new DOMParser().parseFromString(content, 'image/svg+xml')
  if (document.querySelector('parseerror')) {
    return false
  }

  return containsScriptThreats(document)
}

function hasHtmlThreats(content: string): boolean {
  const document = new DOMParser().parseFromString(content, 'text/html')
  return containsScriptThreats(document)
}

/**
 * Client-side content check before the file reaches the server.
 * Images: validates magic bytes to catch executables disguised with an image extension.
 * Text formats (SVG, HTML): scans for XSS patterns a browser could execute.
 */
export function hasMaliciousContent(buffer: ArrayBuffer, fileName: string): boolean {
  const extension = getExtension(fileName)

  if (extension in IMAGE_SIGNATURES) {
    return !hasValidSignature(buffer, extension)
  }

  const content = new TextDecoder().decode(buffer)

  if (extension === '.svg' && hasSvgThreats(content)) {
    return true
  }

  if ((extension === '.html' || extension === '.htm') && hasHtmlThreats(content)) {
    return true
  }

  return false
}
