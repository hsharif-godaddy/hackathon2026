import { scanFile, ScanResultStatus } from '@/lib/file/scanner'
import { getExtension, isImageFileName } from '@/lib/file/utils'
import { hasMaliciousContent } from '@/lib/file/validation'
import { FileReadError, FileTooLargeError, MaliciousContentError } from './errors'
import type { UploadedDesignFile } from '../types'

export enum ProcessFileErrorReason {
  MaliciousContent = 'malicious_content',
  TooLarge = 'too_large',
  ReadFailed = 'read_failed',
  MaxFiles = 'max_files',
  TotalSize = 'total_size',
  ProcessFailed = 'process_failed',
}

export type ProcessFileError = {
  fileName: string
  error: ProcessFileErrorReason
  message: {
    key: string
    params?: Record<string, string | number>
  }
}

const MEGABYTE = 1024 * 1024
const MAX_TEXT_SIZE = 1 * MEGABYTE   // 1 MB
const MAX_IMAGE_SIZE = 20 * MEGABYTE // 20 MB
const MAX_ZIP_SIZE = 10 * MEGABYTE   // 10 MB
const MAX_TOTAL_BYTES = 50 * MEGABYTE // 50 MB
const MAX_FILES = 5

function formatSizeLabel(bytes: number): string {
  return bytes >= MEGABYTE
    ? `${Math.round(bytes / (MEGABYTE))}MB`
    : `${Math.round(bytes / 1024)}KB`
}

/** Detects Airo's design.md format: YAML frontmatter that contains a top-level `colors:` key. */
function isDesignMdContent(content: string): boolean {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) return false
  const endIdx = trimmed.indexOf('---', 3)
  if (endIdx === -1) return false
  const frontmatter = trimmed.slice(3, endIdx)
  return /^colors:/m.test(frontmatter)
}

/**
 * Validates and reads a single design file.
 * Runs client-side checks (magic bytes / XSS) first, then a server-side ClamAV scan.
 * Throws typed errors ({@link FileTooLargeError}, {@link MaliciousContentError}, {@link FileReadError})
 * so callers can surface the right message without catching a generic Error.
 */
export async function processDesignFile(file: File, isServerScanEnabled: boolean): Promise<UploadedDesignFile> {
  const ext = getExtension(file.name)
  const isImage = isImageFileName(file.name)
  const isZipExt = ext === '.zip'

  if (isZipExt && file.size > MAX_ZIP_SIZE) {
    throw new FileTooLargeError(file.name, MAX_ZIP_SIZE)
  }

  if (isImage && file.size > MAX_IMAGE_SIZE) {
    throw new FileTooLargeError(file.name, MAX_IMAGE_SIZE)
  }

  if (!isZipExt && !isImage && file.size > MAX_TEXT_SIZE) {
    throw new FileTooLargeError(file.name, MAX_TEXT_SIZE)
  }

  let buffer: ArrayBuffer
  try {
    buffer = await file.arrayBuffer()
  } catch {
    throw new FileReadError(file.name)
  }

  if (hasMaliciousContent(buffer, file.name)) {
    throw new MaliciousContentError(file.name)
  }

  let warning: string | undefined
  if (isServerScanEnabled) {
    const serverScan = await scanFile(buffer, file.name)
    if (serverScan.status === ScanResultStatus.MALICIOUS) {
      throw new MaliciousContentError(file.name)
    }
    warning = serverScan.status === ScanResultStatus.UNAVAILABLE ? 'scanner_unavailable' : undefined
  }

  if (isZipExt) {
    const { detectUiKit, detectAppBuilderApp } = await import('@/lib/zip-extract')
    const isUiKit = await detectUiKit(buffer)
    const isAppImport = !isUiKit && await detectAppBuilderApp(buffer)
    return { name: file.name, content: '', isDesignMd: false, isZip: true, isUiKit, isAppImport, zipRaw: buffer, warning }
  }

  if (isImage) {
    return { name: file.name, content: '', isDesignMd: false, isImage: true, zipRaw: buffer, warning }
  }

  const content = new TextDecoder().decode(buffer)
  return { name: file.name, content, isDesignMd: isDesignMdContent(content), zipRaw: buffer, warning }
}

interface ProcessDesignFilesParams {
  maxFiles?: number;
  maxTotalBytes?: number;
  isServerScanEnabled?: boolean
}

/**
 * Processes a batch of files against the current upload state.
 * Uses `file.size` for the total-size pre-check to avoid reading the buffer before rejecting.
 * Collects per-file errors and continues — a bad file does not block the rest.
 */
export async function processDesignFiles(
  files: File[],
  currentFiles: UploadedDesignFile[],
  { maxFiles = MAX_FILES, maxTotalBytes = MAX_TOTAL_BYTES, isServerScanEnabled = false }: ProcessDesignFilesParams  = {},
): Promise<{ processed: UploadedDesignFile[]; errors: ProcessFileError[]; warnings: Array<{ fileName: string; reason: string }> }> {
  const processed: UploadedDesignFile[] = []
  const errors: ProcessFileError[] = []
  const warnings: Array<{ fileName: string; reason: string }> = []
  let currentBytes = currentFiles.reduce((sum, f) => sum + (f.zipRaw?.byteLength ?? 0), 0)

  for (const file of files) {
    if (currentFiles.length + processed.length >= maxFiles) {
      errors.push({ fileName: '', error: ProcessFileErrorReason.MaxFiles, message: { key: 'builder_design_file_upload_error_max_files', params: { max: maxFiles } } })
      break
    }
    if (currentBytes + file.size > maxTotalBytes) {
      errors.push({ fileName: '', error: ProcessFileErrorReason.TotalSize, message: { key: 'builder_design_file_upload_error_total_size', params: { limit: formatSizeLabel(maxTotalBytes) } } })
      continue
    }
    try {
      const result = await processDesignFile(file, isServerScanEnabled)
      if (result.warning) {
        warnings.push({ fileName: file.name, reason: result.warning })
      }
      processed.push(result)
      currentBytes += result.zipRaw?.byteLength ?? 0
    } catch (err) {
      if (err instanceof FileTooLargeError) {
        errors.push({ fileName: err.fileName, error: ProcessFileErrorReason.TooLarge, message: { key: 'builder_design_file_upload_error_exceeds_limit', params: { name: err.fileName, limit: formatSizeLabel(err.limit) } } })
      } else if (err instanceof FileReadError) {
        errors.push({ fileName: err.fileName, error: ProcessFileErrorReason.ReadFailed, message: { key: 'builder_design_file_upload_error_read_failed', params: { name: err.fileName } } })
      } else if (err instanceof MaliciousContentError) {
        errors.push({ fileName: err.fileName, error: ProcessFileErrorReason.MaliciousContent, message: { key: 'builder_design_file_upload_error_malicious_content', params: { name: err.fileName } } })
      } else {
        errors.push({ fileName: file.name, error: ProcessFileErrorReason.ProcessFailed, message: { key: 'builder_design_file_upload_error_process_failed', params: { name: file.name } } })
      }
    }
  }
  return { processed, errors, warnings }
}
