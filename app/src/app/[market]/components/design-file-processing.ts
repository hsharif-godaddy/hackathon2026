import type { UploadedDesignFile } from './types'

export type TranslateFn = (key: string, values?: Record<string, string | number>) => string

const MAX_TEXT_SIZE = 1 * 1024 * 1024
const MAX_IMAGE_SIZE = 20 * 1024 * 1024
const MAX_ZIP_SIZE = 10 * 1024 * 1024
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024
export const MAX_FILES = 5
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']

function formatSizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${Math.round(bytes / (1024 * 1024))}MB`
    : `${Math.round(bytes / 1024)}KB`
}

export class FileTooLargeError extends Error {
  constructor(public readonly fileName: string, public readonly limit: number) {
    super(`${fileName} exceeds limit`)
    this.name = 'FileTooLargeError'
  }
}

export class FileReadError extends Error {
  constructor(public readonly fileName: string) {
    super(`Failed to read ${fileName}`)
    this.name = 'FileReadError'
  }
}

function isDesignMdContent(content: string): boolean {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) return false
  const endIdx = trimmed.indexOf('---', 3)
  if (endIdx === -1) return false
  const frontmatter = trimmed.slice(3, endIdx)
  return /^colors:/m.test(frontmatter)
}

function getExtension(fileName: string): string {
  return fileName.substring(fileName.lastIndexOf('.')).toLowerCase()
}

export async function processDesignFile(file: File): Promise<UploadedDesignFile> {
  const ext = getExtension(file.name)
  const isImage = IMAGE_EXTENSIONS.includes(ext)
  const isZipExt = ext === '.zip'

  if (isZipExt) {
    if (file.size > MAX_ZIP_SIZE) throw new FileTooLargeError(file.name, MAX_ZIP_SIZE)
  } else if (isImage) {
    if (file.size > MAX_IMAGE_SIZE) throw new FileTooLargeError(file.name, MAX_IMAGE_SIZE)
  } else {
    if (file.size > MAX_TEXT_SIZE) throw new FileTooLargeError(file.name, MAX_TEXT_SIZE)
  }

  let buffer: ArrayBuffer
  try {
    buffer = await file.arrayBuffer()
  } catch {
    throw new FileReadError(file.name)
  }

  if (isZipExt) {
    const { detectUiKit, detectAppBuilderApp } = await import('@/lib/zip-extract')
    const isUiKit = await detectUiKit(buffer)
    const isAppImport = !isUiKit && await detectAppBuilderApp(buffer)
    return { name: file.name, content: '', isDesignMd: false, isZip: true, isUiKit, isAppImport, zipRaw: buffer }
  }

  if (isImage) {
    return { name: file.name, content: '', isDesignMd: false, isImage: true, zipRaw: buffer }
  }

  const content = new TextDecoder().decode(buffer)
  return { name: file.name, content, isDesignMd: isDesignMdContent(content), zipRaw: buffer }
}

function computeCurrentBytes(files: UploadedDesignFile[]): number {
  return files.reduce((sum, f) => sum + (f.zipRaw?.byteLength ?? 0), 0)
}

export async function processDesignFiles(
  files: File[],
  currentFiles: UploadedDesignFile[],
  maxFiles: number,
  maxTotalBytes: number,
  t: TranslateFn,
): Promise<{ processed: UploadedDesignFile[]; errors: string[] }> {
  const processed: UploadedDesignFile[] = []
  const errors: string[] = []
  let currentBytes = computeCurrentBytes(currentFiles)

  for (const file of files) {
    if (currentFiles.length + processed.length >= maxFiles) {
      errors.push(t('builder_design_file_upload_error_max_files', { max: maxFiles }))
      break
    }
    if (currentBytes + file.size > maxTotalBytes) {
      errors.push(t('builder_design_file_upload_error_total_size', { limit: formatSizeLabel(maxTotalBytes) }))
      continue
    }
    try {
      const result = await processDesignFile(file)
      processed.push(result)
      currentBytes += result.zipRaw?.byteLength ?? 0
    } catch (err) {
      if (err instanceof FileTooLargeError) {
        errors.push(t('builder_design_file_upload_error_exceeds_limit', { name: err.fileName, limit: formatSizeLabel(err.limit) }))
      } else if (err instanceof FileReadError) {
        errors.push(t('builder_design_file_upload_error_read_failed', { name: err.fileName }))
      } else {
        errors.push(t('builder_design_file_upload_error_process_failed', { name: file.name }))
      }
    }
  }
  return { processed, errors }
}
