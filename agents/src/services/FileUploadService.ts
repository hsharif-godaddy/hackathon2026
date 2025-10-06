import { existsSync, readdirSync, statSync } from 'fs'
import { mkdir, writeFile, readFile, unlink, rm } from 'fs/promises'
import { extname } from 'path'
import { nanoid } from 'nanoid'
import { logger } from '../logging/index.js'
import { createSafePathBuilder } from '../utils/safe-path.js'
import { getAgentConfig } from './features.js'
import { fileUploadEvents } from '../logging/events/index.js'

export interface UploadedFile {
  id: string
  originalName: string
  filename: string
  size: number
  mimeType: string | null
  uploadedAt: string
}

export interface UploadResult {
  uploadId: string
  appId: string
  files: UploadedFile[]
  expiresAt: string
}

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp'
])

const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_FILES_PER_UPLOAD = 5
const UPLOAD_EXPIRY_HOURS = 24

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
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      throw new Error(`Unsupported file type: ${file.mimetype}. Allowed types: ${Array.from(ALLOWED_IMAGE_TYPES).join(', ')}`)
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`File size ${file.size} bytes exceeds maximum allowed size of ${MAX_FILE_SIZE} bytes`)
    }
  }

  validateUpload(files: Express.Multer.File[]): void {
    if (files.length === 0) {
      throw new Error('No files provided')
    }

    if (files.length > MAX_FILES_PER_UPLOAD) {
      throw new Error(`Too many files. Maximum ${MAX_FILES_PER_UPLOAD} files allowed per upload`)
    }

    for (const file of files) {
      this.validateFile(file)
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

    for (const file of files) {
      const fileId = `file_${nanoid(10)}`
      const ext = extname(file.originalname) || '.bin'
      const filename = `${appId}_${Date.now()}_${fileId}${ext}`
      const filepath = this.pathBuilder.join(appId, uploadId, filename)

      await writeFile(filepath, file.buffer)

      uploadedFiles.push({
        id: fileId,
        originalName: file.originalname,
        filename,
        size: file.size,
        mimeType: file.mimetype,
        uploadedAt
      })

      fileUploadEvents.fileSaved(logger, {
        appId,
        uploadId,
        originalName: file.originalname,
        size: file.size,
        mimeType: file.mimetype,
        fileCount: 1,
        totalSize: file.size
      })
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

    fileUploadEvents.processSuccess(logger, {
      appId,
      uploadId,
      fileCount: uploadedFiles.length,
      totalSize: uploadedFiles.reduce((sum, f) => sum + f.size, 0)
    })

    return {
      uploadId,
      appId,
      files: uploadedFiles,
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
      const metadata = JSON.parse(metadataContent)
      
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
    }
  }

  getFilePath(appId: string, uploadId: string, filename: string): string {
    return this.pathBuilder.join(appId, uploadId, filename)
  }
}

export const fileUploadService = new FileUploadService()
