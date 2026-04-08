import type { UploadedFile } from '@/app/develop/components/chat/FileUploadButton'
import { getFileUploadAgent } from '@/lib/file-agent'
import { logger } from '@/lib/request-context'
import {
  MAX_FILES_PER_UPLOAD,
  UPLOAD_TIMEOUT_MS,
  UPLOAD_TIMEOUT_SECONDS,
  validate,
} from '@/utils/file-upload-validation'
import { compressImageFiles } from '@/utils/image-compression'
import { logImpressionEvent } from '@/utils/instrumentation'

interface TranslateFn {
  (key: string, values?: Record<string, unknown>): string
}

export interface UploadChatFilesResult {
  files: UploadedFile[]
  failedFiles?: Array<{ originalName: string }>
  /**
   * Set when a batch fails after earlier batches succeeded. `files` holds uploads from
   * completed batches only — callers should promote them and not re-upload on retry.
   */
  batchLevelError?: string
}

/**
 * Upload one batch (≤ MAX_FILES_PER_UPLOAD) to the agent.
 * Staging can hold up to MAX_TOTAL_ASSETS files across multiple adds; each HTTP upload stays within API limits.
 */
async function uploadChatFilesBatch(
  appId: string,
  files: File[],
  t: TranslateFn
): Promise<UploadChatFilesResult> {
  const validationError = validate(files, t)
  if (validationError) {
    throw new Error(validationError)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS)

  try {
    logger.debug('file-upload.chat.start', {
      appId,
      fileCount: files.length,
      totalSize: files.reduce((sum, f) => sum + f.size, 0)
    })

    const [compressed, { token, uploadUrl }] = await Promise.all([
      compressImageFiles(files),
      getFileUploadAgent(appId)
    ])

    logger.debug('file-upload.chat.compressed', {
      appId,
      originalSize: files.reduce((sum, f) => sum + f.size, 0),
      compressedSize: compressed.reduce((sum, f) => sum + f.size, 0)
    })

    const formData = new FormData()
    formData.append('appId', appId)
    compressed.forEach(file => formData.append('files', file))

    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
      signal: controller.signal
    })

    if (!response.ok) {
      let errorMessage = `Upload failed (${response.status})`
      try {
        const body = await response.json()
        if (body.error) {
          errorMessage = typeof body.error === 'string' ? body.error : body.error.message || errorMessage
        }
      } catch { /* response body not JSON */ }
      throw new Error(errorMessage)
    }

    const result = await response.json()

    logger.info('file-upload.chat.success', {
      appId,
      uploadId: result.uploadId,
      fileCount: result.files.length,
      failedCount: result.failedFiles?.length ?? 0
    })

    logImpressionEvent('uploads.image.success')()

    return {
      files: result.files as UploadedFile[],
      failedFiles: result.failedFiles
    }
  } catch (error) {
    const isTimeout =
      (error instanceof DOMException && error.name === 'AbortError') ||
      (error instanceof Error && error.name === 'AbortError')
    const message = isTimeout
      ? t('builder_chatfiles_error_timeout_duration', { seconds: UPLOAD_TIMEOUT_SECONDS })
      : error instanceof Error ? error.message : t('builder_chatfiles_error_upload_failed')

    logger.error('file-upload.chat.failed', {
      appId,
      error: message
    })

    logImpressionEvent(isTimeout ? 'uploads.image.timeout' : 'uploads.image.failed')()

    throw new Error(message)
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Upload chat attachment files to the agent (validate → compress images → POST multipart).
 * Splits into multiple requests of at most MAX_FILES_PER_UPLOAD so staging many files across batches still succeeds on send.
 */
export async function uploadChatFiles(
  appId: string,
  files: File[],
  t: TranslateFn
): Promise<UploadChatFilesResult> {
  if (files.length === 0) {
    return { files: [] }
  }

  const merged: UploadedFile[] = []
  const mergedFailed: Array<{ originalName: string }> = []
  let batchLevelError: string | undefined

  for (let i = 0; i < files.length; i += MAX_FILES_PER_UPLOAD) {
    const chunk = files.slice(i, i + MAX_FILES_PER_UPLOAD)
    try {
      const { files: uploaded, failedFiles } = await uploadChatFilesBatch(appId, chunk, t)
      merged.push(...uploaded)
      if (failedFiles?.length) {
        mergedFailed.push(...failedFiles)
      }
    } catch (error) {
      batchLevelError =
        error instanceof Error ? error.message : t('builder_chatfiles_error_upload_failed')
      break
    }
  }

  return {
    files: merged,
    failedFiles: mergedFailed.length > 0 ? mergedFailed : undefined,
    batchLevelError
  }
}
