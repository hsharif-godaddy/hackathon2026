import { logger } from '@/lib/request-context'
import { buildDynamicApiUrl } from '../config/dynamic-api'
import type { UploadError,UploadResult } from '../types/file-upload'

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp'
])

const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_FILES = 5

export function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return `File type ${file.type} not allowed. Supported types: JPEG, PNG, GIF, WebP`
  }

  if (file.size > MAX_FILE_SIZE) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2)
    return `File size ${sizeMB}MB exceeds maximum of 10MB`
  }

  return null
}

export function validateImageFiles(files: File[]): UploadError[] {
  const errors: UploadError[] = []

  if (files.length === 0) {
    errors.push({ file: 'upload', error: 'No files selected' })
    return errors
  }

  if (files.length > MAX_FILES) {
    errors.push({ file: 'upload', error: `Maximum ${MAX_FILES} files allowed` })
    return errors
  }

  for (const file of files) {
    const error = validateImageFile(file)
    if (error) {
      errors.push({ file: file.name, error })
    }
  }

  return errors
}

export async function uploadImages(
  appId: string,
  files: File[]
): Promise<UploadResult> {
  logger.info('file-upload.request.start', {
    message: 'Starting image upload',
    appId,
    fileCount: files.length,
    totalSize: files.reduce((sum, f) => sum + f.size, 0)
  })

  const errors = validateImageFiles(files)
  if (errors.length > 0) {
    logger.warn('file-upload.validation.failed', {
      message: 'File validation failed',
      errors
    })
    throw new Error(errors.map(e => `${e.file}: ${e.error}`).join('; '))
  }

  const formData = new FormData()
  formData.append('appId', appId)

  for (const file of files) {
    formData.append('files', file)
  }

  try {
    const apiUrl = await buildDynamicApiUrl('/api/files/upload', appId)

    const response = await fetch(apiUrl, {
      method: 'POST',
      body: formData
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(errorData.error || `Upload failed with status ${response.status}`)
    }

    const result = await response.json() as UploadResult

    logger.info('file-upload.request.success', {
      message: 'Image upload completed',
      appId,
      uploadId: result.uploadId,
      fileCount: result.files.length
    })

    return result
  } catch (error) {
    logger.error('file-upload.request.failed', {
      message: 'Image upload failed',
      appId,
      error: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
}

export async function getUpload(
  appId: string,
  uploadId: string
): Promise<UploadResult | null> {
  try {
    const apiUrl = await buildDynamicApiUrl(`/api/files/${appId}/${uploadId}`, appId)

    const response = await fetch(apiUrl)

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      throw new Error(`Failed to get upload: ${response.status}`)
    }

    return await response.json() as UploadResult
  } catch (error) {
    logger.error('file-upload.get.failed', {
      message: 'Failed to retrieve upload',
      appId,
      uploadId,
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

export async function deleteUpload(
  appId: string,
  uploadId: string
): Promise<boolean> {
  try {
    const apiUrl = await buildDynamicApiUrl(`/api/files/${appId}/${uploadId}`, appId)

    const response = await fetch(apiUrl, {
      method: 'DELETE'
    })

    if (response.status === 404) {
      return false
    }

    if (!response.ok) {
      throw new Error(`Failed to delete upload: ${response.status}`)
    }

    logger.info('file-upload.delete.success', {
      message: 'Upload deleted',
      appId,
      uploadId
    })

    return true
  } catch (error) {
    logger.error('file-upload.delete.failed', {
      message: 'Failed to delete upload',
      appId,
      uploadId,
      error: error instanceof Error ? error.message : String(error)
    })
    return false
  }
}

export function createImagePreview(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Failed to read file as data URL'))
      }
    }
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'))
    }
    
    reader.readAsDataURL(file)
  })
}
