import JSZip from 'jszip'

const MAX_FILES = 100
const MAX_TOTAL_SIZE = 2 * 1024 * 1024 // 2MB uncompressed
const ALLOWED_PREFIXES = ['src/styles/', 'src/pages/', 'src/components/', 'docs/']
const ALLOWED_EXACT_PATHS = ['src/design.md']
const ALLOWED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.css', '.scss', '.md', '.json']

export interface ExtractedFile {
  path: string
  content: string
}

export interface ZipExtractionResult {
  files: ExtractedFile[]
  skippedFiles: string[]
  errors: string[]
  isUiKit: boolean
}

function isAllowedPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  if (normalized.includes('..') || normalized.startsWith('/') || normalized.includes('\0')) {
    return false
  }
  if (ALLOWED_EXACT_PATHS.includes(normalized)) return true
  return ALLOWED_PREFIXES.some(prefix => normalized.startsWith(prefix))
}

function hasAllowedExtension(filePath: string): boolean {
  const lower = filePath.toLowerCase()
  return ALLOWED_EXTENSIONS.some(ext => lower.endsWith(ext))
}

function isSafePath(filePath: string): boolean {
  return !filePath.includes('..') && !filePath.startsWith('/') && !filePath.includes('\0')
}

const UI_KIT_ALLOWED_EXTENSIONS = ['.md', '.json', '.html', '.css', '.png', '.jpg', '.svg']

function hasKitMeta(zip: JSZip): boolean {
  if (zip.files['kit-meta.json']) return true
  // macOS Finder wraps in a top-level folder — check one level deep
  return Object.keys(zip.files).some(p => p.endsWith('/kit-meta.json') && p.split('/').length === 2)
}

export async function detectUiKit(data: ArrayBuffer): Promise<boolean> {
  try {
    const zip = await JSZip.loadAsync(data)
    return hasKitMeta(zip)
  } catch {
    return false
  }
}

export async function extractZip(data: ArrayBuffer): Promise<ZipExtractionResult> {
  const result: ZipExtractionResult = { files: [], skippedFiles: [], errors: [], isUiKit: false }

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(data)
  } catch {
    result.errors.push('Failed to read ZIP file. The file may be corrupted.')
    return result
  }

  const entries = Object.entries(zip.files).filter(([, file]) => !file.dir)
  result.isUiKit = hasKitMeta(zip)

  if (entries.length > MAX_FILES) {
    result.errors.push(`ZIP contains ${entries.length} files, exceeding the limit of ${MAX_FILES}.`)
    return result
  }

  let totalSize = 0

  for (const [path, file] of entries) {
    const normalized = path.replace(/\\/g, '/')

    if (!isSafePath(normalized)) {
      result.skippedFiles.push(normalized)
      continue
    }

    if (result.isUiKit) {
      if (!UI_KIT_ALLOWED_EXTENSIONS.some(ext => normalized.toLowerCase().endsWith(ext))) {
        result.skippedFiles.push(normalized)
        continue
      }
    } else {
      if (!isAllowedPath(normalized)) {
        result.skippedFiles.push(normalized)
        continue
      }
      if (!hasAllowedExtension(normalized)) {
        result.skippedFiles.push(normalized)
        continue
      }
    }

    // Skip binary files for text extraction
    if (/\.(png|jpg|jpeg|gif|svg|ico|webp)$/i.test(normalized)) {
      result.files.push({ path: normalized, content: '' })
      continue
    }

    let content: string
    try {
      content = await file.async('string')
    } catch {
      result.skippedFiles.push(normalized)
      continue
    }

    totalSize += new TextEncoder().encode(content).length
    if (totalSize > MAX_TOTAL_SIZE) {
      result.errors.push(`Extracted content exceeds the ${MAX_TOTAL_SIZE / 1024 / 1024}MB size limit.`)
      return result
    }

    result.files.push({ path: normalized, content })
  }

  return result
}
