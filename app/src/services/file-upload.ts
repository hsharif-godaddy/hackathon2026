import { getFileMetadataAgent, getFileUploadAgent } from '@/lib/file-agent'
import { logger } from '@/lib/request-context'
import type { UploadError, UploadResult } from '../types/file-upload'

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/avif',
])

const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
])

const ALLOWED_TYPES = new Set([...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES])

const MAX_IMAGE_FILE_SIZE = 25 * 1024 * 1024 // 25 MB
const MAX_VIDEO_FILE_SIZE = 50 * 1024 * 1024 // 50 MB
const MAX_FILES = 5

export function validateImageFile(file: File): string | null {
  if (!ALLOWED_TYPES.has(file.type)) {
    return `File type ${file.type} not allowed. Supported: JPEG, PNG, GIF, WebP, SVG, AVIF, MP4, WebM, MOV`
  }

  const isVideo = file.type.startsWith('video/')
  const maxSize = isVideo ? MAX_VIDEO_FILE_SIZE : MAX_IMAGE_FILE_SIZE

  if (file.size > maxSize) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2)
    const limitMB = maxSize / (1024 * 1024)
    return `File size ${sizeMB}MB exceeds maximum of ${limitMB}MB`
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

  // Separate valid files from invalid — upload what we can, report what we can't
  const validFiles: File[] = []
  const skippedErrors: UploadError[] = []

  if (files.length === 0) {
    throw new Error('No files selected')
  }

  for (const file of files) {
    const error = validateImageFile(file)
    if (error) {
      skippedErrors.push({ file: file.name, error })
    } else {
      validFiles.push(file)
    }
  }

  if (validFiles.length === 0) {
    throw new Error(skippedErrors.map(e => `${e.file}: ${e.error}`).join('; '))
  }

  if (skippedErrors.length > 0) {
    logger.warn('file-upload.validation.partial', {
      message: 'Some files skipped due to validation errors',
      skipped: skippedErrors,
      validCount: validFiles.length,
    })
  }

  const formData = new FormData()
  formData.append('appId', appId)

  for (const file of validFiles) {
    formData.append('files', file)
  }

  try {
    // Get agent token and upload URL
    const { token, uploadUrl } = await getFileUploadAgent(appId)

    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
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
    // Get agent token and metadata URL
    const { token, metadataUrl } = await getFileMetadataAgent(appId, uploadId)

    const response = await fetch(metadataUrl, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })

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
    // Get agent token and metadata URL
    const { token, metadataUrl } = await getFileMetadataAgent(appId, uploadId)

    const response = await fetch(metadataUrl, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
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
