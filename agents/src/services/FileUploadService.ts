import { existsSync, readdirSync, statSync } from 'fs'
import { mkdir, writeFile, readFile, unlink, rm } from 'fs/promises'
import { extname } from 'path'
import { nanoid } from 'nanoid'
import { z } from 'zod'

import { logger } from '../logging/index.js'
import { fileUploadEvents } from '../logging/events/index.js'
import { FileValidationError, SVGSanitizationError } from './errors/file-upload-errors.js'
import { getAgentConfig } from './features.js'
import { createSafePathBuilder } from '../utils/safe-path.js'
import { sanitizeSVG, isSVGFile } from '../utils/svg-sanitizer.js'
import { clearExtensionResolved } from '../utils/upload-resolution-tracking.js'

export interface UploadedFile {
  id: string
  originalName: string
  filename: string
  size: number
  mimeType: string | null
  uploadedAt: string
}

export interface FailedFile {
  originalName: string
  error: string
}

export interface UploadResult {
  uploadId: string
  appId: string
  files: UploadedFile[]
  failedFiles: FailedFile[]
  expiresAt: string
}

const BLOCKED_EXTENSIONS = new Set([
  // Server-side executables
  '.exe', '.dll', '.so', '.dylib',
  // Server-side scripts
  '.php', '.jsp', '.asp', '.aspx',
  // Shell scripts
  '.sh', '.bat', '.cmd', '.ps1',
  // Database files
  '.sql', '.db',
  // Archives
  '.zip', '.tar', '.gz', '.rar', '.7z',
  // HTML/XML that can execute scripts (SVG is allowed but sanitized)
  '.html', '.htm', '.xhtml',
  '.xml', '.xsl', '.xslt',
  // Other executable formats
  '.swf', '.jar'
])

const BLOCKED_MIME_TYPES = new Set([
  'application/x-executable',
  'application/x-msdownload',
  'application/x-sh',
  'application/x-php',
  'application/zip',
  'application/x-tar',
  'application/gzip',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  // HTML/XML MIME types
  'text/html',
  'application/xhtml+xml',
  'application/xml',
  'text/xml',
  // Other executable formats
  'application/x-shockwave-flash',
  'application/java-archive'
])

const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_FILES_PER_UPLOAD = 5
const UPLOAD_EXPIRY_HOURS = 24

// SECURITY: Zod schemas for metadata validation
// Prevents type confusion, prototype pollution, and validates structure
const UploadedFileSchema = z.object({
  id: z.string(),
  originalName: z.string().max(1000),  // Prevent extremely long filenames
  filename: z.string(),
  size: z.number().int().nonnegative(),
  mimeType: z.string().nullable(),
  uploadedAt: z.string()
})

const MetadataSchema = z.object({
  uploadId: z.string(),
  appId: z.string(),
  uploadedAt: z.string(),
  expiresAt: z.string(),
  fileCount: z.number().int().nonnegative(),
  files: z.array(UploadedFileSchema)
})

/**
 * Check for prototype pollution attempts in parsed JSON
 * Detects dangerous keys that could modify Object.prototype
 */
function hasPrototypePollution(obj: unknown): boolean {
  if (obj === null || typeof obj !== 'object') {
    return false
  }

  const dangerous = ['__proto__', 'constructor', 'prototype']

  // Check own properties
  for (const key of dangerous) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      return true
    }
  }

  // Recursively check nested objects
  for (const value of Object.values(obj)) {
    if (typeof value === 'object' && value !== null) {
      if (hasPrototypePollution(value)) {
        return true
      }
    }
  }

  return false
}

export class FileUploadService {
  private uploadsDir: string
  private pathBuilder: ReturnType<typeof createSafePathBuilder>

  constructor(baseDir?: string) {
    const uploadDir = baseDir || getAgentConfig.uploadDir()
    this.uploadsDir = uploadDir.startsWith('/') ? uploadDir : `${process.cwd()}/${uploadDir}`
    this.pathBuilder = createSafePathBuilder(this.uploadsDir)
    this.ensureUploadsDirectory()
  }

  private ensureUploadsDirectory(): void {
    if (!existsSync(this.uploadsDir)) {
      mkdir(this.uploadsDir, { recursive: true }).then(() => {
        fileUploadEvents.directoryCreated(logger, {
          appId: 'system',
          path: this.uploadsDir,
          operation: 'create'
        })
      }).catch((error) => {
        fileUploadEvents.directoryFailure(logger, error instanceof Error ? error : new Error(String(error)), {
          appId: 'system',
          path: this.uploadsDir
        })
      })
    }
  }

  private async ensureAppDirectory(appId: string): Promise<string> {
    const appDir = this.pathBuilder.join(appId)
    if (!existsSync(appDir)) {
      await mkdir(appDir, { recursive: true })
      fileUploadEvents.appDirectoryCreated(logger, {
        appId,
        path: appDir,
        operation: 'create'
      })
    }
    return appDir
  }

  private async ensureUploadDirectory(appId: string, uploadId: string): Promise<string> {
    const appDir = await this.ensureAppDirectory(appId)
    const uploadDir = this.pathBuilder.join(appId, uploadId)
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true })
      fileUploadEvents.uploadDirectoryCreated(logger, {
        appId,
        uploadId,
        path: uploadDir,
        operation: 'create'
      })
    }
    return uploadDir
  }

  validateFile(file: Express.Multer.File): void {
    const ext = extname(file.originalname).toLowerCase()
    if (BLOCKED_EXTENSIONS.has(ext)) {
      throw new FileValidationError(
        `File type '${ext}' is not allowed for security reasons. Please upload a different file type.`
      )
    }

    if (BLOCKED_MIME_TYPES.has(file.mimetype)) {
      throw new FileValidationError(
        `File type '${file.mimetype}' is not allowed for security reasons. Please upload a different file type.`
      )
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new FileValidationError(
        `File size ${file.size} bytes exceeds maximum allowed size of ${MAX_FILE_SIZE} bytes`
      )
    }
  }

  validateUpload(files: Express.Multer.File[]): void {
    if (files.length === 0) {
      throw new FileValidationError('No files provided')
    }

    if (files.length > MAX_FILES_PER_UPLOAD) {
      throw new FileValidationError(`Too many files. Maximum ${MAX_FILES_PER_UPLOAD} files allowed per upload`)
    }

    for (const file of files) {
      this.validateFile(file)
    }
  }

  /**
   * Sanitize an SVG file and return the cleaned buffer.
   * Throws SVGSanitizationError on failure so the caller can skip the file
   * in a batch without aborting the entire upload.
   */
  private sanitizeAndBufferSvg(
    file: Express.Multer.File,
    appId: string,
    uploadId: string
  ): { buffer: Buffer; size: number } {
    try {
      const result = sanitizeSVG(file.buffer.toString('utf-8'))

      if (result.hadDangerousContent) {
        logger.warn('file-upload.svg.sanitized', {
          appId,
          uploadId,
          originalName: file.originalname,
          detectedThreats: result.detectedThreats,
          message: `SVG contained dangerous content that was removed: ${result.detectedThreats.join(', ')}`
        }, { tags: ['security', 'svg-sanitization', 'xss-prevention'] })
      }

      if (!result.sanitized || !/<svg[\s>]/i.test(result.sanitized)) {
        throw new Error('File does not contain valid SVG content')
      }

      const buffer = Buffer.from(result.sanitized, 'utf-8')

      logger.info('file-upload.svg.processed', {
        appId,
        uploadId,
        originalName: file.originalname,
        originalSize: file.size,
        sanitizedSize: buffer.length,
        hadThreats: result.hadDangerousContent,
        threats: result.detectedThreats
      })

      return { buffer, size: buffer.length }
    } catch (error) {
      logger.error('file-upload.svg.sanitization-failed', {
        appId,
        uploadId,
        originalName: file.originalname,
        error: error instanceof Error ? error.message : String(error)
      })
      throw new SVGSanitizationError(file.originalname, error instanceof Error ? error.message : undefined)
    }
  }

  async processUpload(appId: string, files: Express.Multer.File[]): Promise<UploadResult> {
    fileUploadEvents.processStart(logger, {
      appId,
      fileCount: files.length
    })

    this.validateUpload(files)

    const uploadId = `upload_${nanoid(12)}`
    const uploadDir = await this.ensureUploadDirectory(appId, uploadId)
    const uploadedFiles: UploadedFile[] = []
    const uploadedAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + UPLOAD_EXPIRY_HOURS * 60 * 60 * 1000).toISOString()

    const failedFiles: Array<{ originalName: string; error: string }> = []
    let hasServerError = false

    for (const file of files) {
      try {
        const fileId = `file_${nanoid(10)}`
        const ext = extname(file.originalname) || '.bin'
        const filename = `${appId}_${Date.now()}_${fileId}${ext}`
        const filepath = this.pathBuilder.join(appId, uploadId, filename)

        let fileBuffer = file.buffer
        let actualSize = file.size

        if (isSVGFile(file.originalname, file.mimetype)) {
          const sanitized = this.sanitizeAndBufferSvg(file, appId, uploadId)
          fileBuffer = sanitized.buffer
          actualSize = sanitized.size
        }

        await writeFile(filepath, fileBuffer)

        uploadedFiles.push({
          id: fileId,
          originalName: file.originalname,
          filename,
          size: actualSize,
          mimeType: file.mimetype,
          uploadedAt
        })

        fileUploadEvents.fileSaved(logger, {
          appId,
          uploadId,
          originalName: file.originalname,
          size: actualSize,
          mimeType: file.mimetype,
          fileCount: 1,
          totalSize: actualSize
        })
      } catch (fileError) {
        if (fileError instanceof SVGSanitizationError) {
          failedFiles.push({ originalName: file.originalname, error: fileError.message })
          continue
        }
        hasServerError = true
        logger.error('file-upload.file-processing-failed', {
          appId,
          uploadId,
          originalName: file.originalname,
          error: fileError instanceof Error ? fileError.message : String(fileError)
        })
        failedFiles.push({ originalName: file.originalname, error: fileError instanceof Error ? fileError.message : String(fileError) })
      }
    }

    if (uploadedFiles.length === 0) {
      if (hasServerError) {
        throw new Error('All files failed to upload')
      }
      throw new FileValidationError(
        `All files failed to upload: ${failedFiles.map(f => f.error).join('; ')}`
      )
    }

    const metadata = {
      uploadId,
      appId,
      uploadedAt,
      expiresAt,
      fileCount: uploadedFiles.length,
      files: uploadedFiles
    }

    await writeFile(
      this.pathBuilder.join(appId, uploadId, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    )

    if (failedFiles.length > 0) {
      logger.warn('file-upload.partial-failure', {
        appId,
        uploadId,
        successCount: uploadedFiles.length,
        failedCount: failedFiles.length,
        failedFiles: failedFiles.map(f => f.originalName)
      })
    }

    fileUploadEvents.processSuccess(logger, {
      appId,
      uploadId,
      fileCount: uploadedFiles.length,
      totalSize: uploadedFiles.reduce((sum, f) => sum + f.size, 0)
    })

    // Reset extension-based resolution tracking so new uploads get a fresh start
    clearExtensionResolved(appId)

    return {
      uploadId,
      appId,
      files: uploadedFiles,
      failedFiles,
      expiresAt
    }
  }

  async getUpload(appId: string, uploadId: string): Promise<UploadResult | null> {
    const uploadDir = this.pathBuilder.join(appId, uploadId)
    
    if (!existsSync(uploadDir)) {
      return null
    }

    const metadataPath = this.pathBuilder.join(appId, uploadId, 'metadata.json')
    
    if (!existsSync(metadataPath)) {
      fileUploadEvents.retrieveNotFound(logger, {
        appId,
        uploadId
      })
      return null
    }

    try {
      const metadataContent = await readFile(metadataPath, 'utf-8')
      const rawMetadata = JSON.parse(metadataContent)

      // SECURITY: Check for prototype pollution attempts
      if (hasPrototypePollution(rawMetadata)) {
        fileUploadEvents.retrieveFailure(
          logger,
          new Error('Prototype pollution detected in metadata'),
          { appId, uploadId }
        )
        logger.error('file-upload.metadata.prototype-pollution', {
          appId,
          uploadId,
          message: 'SECURITY: Prototype pollution attempt detected in metadata.json'
        }, { tags: ['security', 'prototype-pollution', 'metadata-validation'] })
        return null
      }

      // SECURITY: Validate metadata structure with Zod schema
      let metadata: z.infer<typeof MetadataSchema>
      try {
        metadata = MetadataSchema.parse(rawMetadata)
      } catch (validationError) {
        fileUploadEvents.retrieveFailure(
          logger,
          validationError instanceof Error ? validationError : new Error(String(validationError)),
          { appId, uploadId }
        )
        logger.error('file-upload.metadata.validation-failed', {
          appId,
          uploadId,
          error: validationError instanceof Error ? validationError.message : String(validationError)
        }, { tags: ['security', 'metadata-validation', 'schema-validation'] })
        return null
      }

      if (!metadata.files) {
        const files: UploadedFile[] = []
        const dirFiles = readdirSync(uploadDir)
        for (const file of dirFiles) {
          if (file === 'metadata.json') continue
          const filePath = this.pathBuilder.join(appId, uploadId, file)
          const stats = existsSync(filePath) ? statSync(filePath) : null
          
          files.push({
            id: `file_${nanoid(10)}`,
            originalName: file,
            filename: file,
            size: stats ? stats.size : 0,
            mimeType: null,
            uploadedAt: stats ? stats.mtime.toISOString() : new Date().toISOString()
          })
        }
        metadata.files = files
      }
      
      return {
        uploadId: metadata.uploadId,
        appId: metadata.appId,
        files: metadata.files,
        failedFiles: [],
        expiresAt: metadata.expiresAt
      } as UploadResult
    } catch (error) {
      fileUploadEvents.retrieveFailure(logger, error instanceof Error ? error : new Error(String(error)), {
        appId,
        uploadId
      })
      return null
    }
  }

  /**
   * Get the uploads directory path for an app
   */
  getAppUploadsDir(appId: string): string {
    return this.pathBuilder.join(appId)
  }

  async listUploadedFiles(appId: string): Promise<UploadedFile[]> {
    const appDir = this.pathBuilder.join(appId)

    if (!existsSync(appDir)) {
      return []
    }

    const allFiles: UploadedFile[] = []

    try {
      const uploadDirs = readdirSync(appDir)

      for (const uploadId of uploadDirs) {
        const metadataPath = this.pathBuilder.join(appId, uploadId, 'metadata.json')

        if (!existsSync(metadataPath)) {
          continue
        }

        try {
          const metadataContent = await readFile(metadataPath, 'utf-8')
          const rawMetadata = JSON.parse(metadataContent)

          // SECURITY: Check for prototype pollution attempts
          if (hasPrototypePollution(rawMetadata)) {
            logger.error('file-upload.metadata.prototype-pollution', {
              appId,
              uploadId,
              message: 'SECURITY: Prototype pollution attempt detected in metadata.json'
            }, { tags: ['security', 'prototype-pollution', 'metadata-validation'] })
            continue  // Skip this metadata file
          }

          // SECURITY: Validate metadata structure with Zod schema
          let metadata: z.infer<typeof MetadataSchema>
          try {
            metadata = MetadataSchema.parse(rawMetadata)
          } catch (validationError) {
            logger.error('file-upload.metadata.validation-failed', {
              appId,
              uploadId,
              error: validationError instanceof Error ? validationError.message : String(validationError)
            }, { tags: ['security', 'metadata-validation', 'schema-validation'] })
            continue  // Skip invalid metadata
          }

          if (metadata.files && Array.isArray(metadata.files)) {
            allFiles.push(...metadata.files)
          }
        } catch (error) {
          fileUploadEvents.retrieveFailure(
            logger,
            error instanceof Error ? error : new Error(String(error)),
            { appId, uploadId }
          )
        }
      }

      return allFiles
    } catch (error) {
      fileUploadEvents.retrieveFailure(
        logger,
        error instanceof Error ? error : new Error(String(error)),
        { appId, uploadId: 'list-all' }
      )
      return []
    }
  }

  async deleteUpload(appId: string, uploadId: string): Promise<boolean> {
    const uploadDir = this.pathBuilder.join(appId, uploadId)
    
    if (!existsSync(uploadDir)) {
      return false
    }

    try {
      await rm(uploadDir, { recursive: true, force: true })

      fileUploadEvents.cleanupDeleted(logger, {
        appId,
        uploadId,
        operation: 'delete',
        deletedCount: 1
      })

      return true
    } catch (error) {
      fileUploadEvents.cleanupFailure(logger, error instanceof Error ? error : new Error(String(error)), {
        appId,
        uploadId,
        operation: 'delete'
      })
      return false
    }
  }

  async deleteExpiredUploads(): Promise<number> {
    const now = Date.now()
    let deletedCount = 0

    try {
      if (!existsSync(this.uploadsDir)) {
        return 0
      }

      const appDirs = readdirSync(this.uploadsDir)

      for (const appId of appDirs) {
        const appDir = this.pathBuilder.join(appId)
        const uploadDirs = readdirSync(appDir)

        for (const uploadId of uploadDirs) {
          const metadataPath = this.pathBuilder.join(appId, uploadId, 'metadata.json')
          
          if (!existsSync(metadataPath)) {
            continue
          }

          try {
            const metadataContent = await readFile(metadataPath, 'utf-8')
            const metadata = JSON.parse(metadataContent)
            const expiresAt = new Date(metadata.expiresAt).getTime()

            if (expiresAt < now) {
              const deleted = await this.deleteUpload(appId, uploadId)
              if (deleted) {
                deletedCount++
                fileUploadEvents.cleanupExpired(logger, {
                  appId,
                  uploadId,
                  operation: 'expired',
                  expiredCount: 1
                })
              }
            }
          } catch (error) {
            fileUploadEvents.cleanupFailure(logger, error instanceof Error ? error : new Error(String(error)), {
              appId,
              uploadId,
              operation: 'expired'
            })
          }
        }
      }

      if (deletedCount > 0) {
        fileUploadEvents.cleanupComplete(logger, {
          appId: 'system',
          operation: 'expired',
          deletedCount,
          expiredCount: deletedCount
        })
      }

      return deletedCount
    } catch (error) {
      fileUploadEvents.cleanupFailure(logger, error instanceof Error ? error : new Error(String(error)), {
        appId: 'system',
        operation: 'expired'
      })
      return deletedCount
    }
  }

  async cleanupAppUploads(appId: string): Promise<number> {
    const appDir = this.pathBuilder.join(appId)
    let deletedCount = 0

    if (!existsSync(appDir)) {
      return 0
    }

    try {
      const uploadDirs = readdirSync(appDir)

      for (const uploadId of uploadDirs) {
        const deleted = await this.deleteUpload(appId, uploadId)
        if (deleted) {
          deletedCount++
        }
      }

      await rm(appDir, { recursive: true, force: true })

      fileUploadEvents.cleanupAppComplete(logger, {
        appId,
        operation: 'app-cleanup',
        deletedCount
      })

      return deletedCount
    } catch (error) {
      fileUploadEvents.cleanupFailure(logger, error instanceof Error ? error : new Error(String(error)), {
        appId,
        operation: 'app-cleanup'
      })
      return deletedCount
    } finally {
      clearExtensionResolved(appId)
    }
  }

  getFilePath(appId: string, uploadId: string, filename: string): string {
    return this.pathBuilder.join(appId, uploadId, filename)
  }
}

export const fileUploadService = new FileUploadService()
