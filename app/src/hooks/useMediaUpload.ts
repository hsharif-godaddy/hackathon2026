import { useCallback, useRef, useState } from 'react'

import {
  ALL_MEDIA_FORMATS,
  getCategoryForMime,
  IMAGE_FORMATS,
  MAX_FILES_PER_UPLOAD,
  MAX_SIZE_BY_CATEGORY,
  MediaCategory,
  VIDEO_FORMATS,
} from '@/app/[market]/develop/components/preview/media-canvas/types'
import { logger } from '@/lib/request-context'
import { uploadImages } from '@/services/file-upload'
import { compressImageFiles } from '@/utils/image-compression'

const ACCEPT_STRING = ALL_MEDIA_FORMATS.join(',')

interface UseMediaUploadOptions {
  appId: string | null
  onSuccess?: () => void | Promise<void>
  /** Called with filenames of successfully uploaded files */
  onFilesUploaded?: (filenames: string[]) => void | Promise<void>
  logPrefix?: string
}

export function useMediaUpload({ appId, onSuccess, onFilesUploaded, logPrefix = 'media' }: UseMediaUploadOptions) {
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const triggerFileInput = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0 || !appId) return

    const fileList = Array.from(files)

    if (fileList.length > MAX_FILES_PER_UPLOAD) {
      setUploadError(`Maximum ${MAX_FILES_PER_UPLOAD} files allowed at a time`)
      e.target.value = ''
      return
    }

    // Filter out invalid files — upload what we can, show error for what we can't
    const validFiles: File[] = []
    const skippedNames: string[] = []

    for (const f of fileList) {
      const category = getCategoryForMime(f.type)
      if (!category) {
        skippedNames.push(f.name)
        continue
      }
      const maxSize = MAX_SIZE_BY_CATEGORY[category]
      if (f.size > maxSize) {
        skippedNames.push(f.name)
        continue
      }
      validFiles.push(f)
    }

    if (validFiles.length === 0) {
      setUploadError(`No valid files to upload. Skipped: ${skippedNames.join(', ')}`)
      e.target.value = ''
      return
    }

    if (skippedNames.length > 0) {
      setUploadError(`Skipped ${skippedNames.length} file(s): ${skippedNames.join(', ')}`)
    } else {
      setUploadError(null)
    }

    setIsUploading(true)

    try {
      const imageFiles = validFiles.filter((f) => f.type.startsWith('image/'))
      const videoFiles = validFiles.filter((f) => f.type.startsWith('video/'))
      const compressed = await compressImageFiles(imageFiles)
      const allFiles = [...compressed, ...videoFiles]

      for (let i = 0; i < allFiles.length; i += 5) {
        const chunk = allFiles.slice(i, i + 5)
        await uploadImages(appId, chunk)
      }

      logger.info(`${logPrefix}.upload.success`, { appId, fileCount: allFiles.length })
      await onSuccess?.()
      await onFilesUploaded?.(allFiles.map((f) => f.name))
    } catch (err) {
      logger.error(`${logPrefix}.upload.error`, {
        appId,
        error: err instanceof Error ? err.message : String(err),
      })
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploading(false)
      e.target.value = ''
    }
  }, [appId, onSuccess, onFilesUploaded, logPrefix])

  return {
    isUploading,
    uploadError,
    setUploadError,
    fileInputRef,
    triggerFileInput,
    handleFileSelect,
    acceptString: ACCEPT_STRING,
  }
}
