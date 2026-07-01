import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'fs'
import { mkdir, writeFile, readFile, readdir, unlink, rm, copyFile, stat } from 'fs/promises'
import { basename, extname } from 'path'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { isSafeUploadFilename } from '@airo/shared/media'

import { logger } from '../logging/index.js'
import { fileUploadEvents } from '../logging/events/index.js'
import { FileValidationError, SVGSanitizationError } from './errors/file-upload-errors.js'
import { getAgentConfig } from './features.js'
import { createSafePathBuilder } from '../utils/safe-path.js'
import { sanitizeSVG, isSVGFile } from '../utils/svg-sanitizer.js'
import { IMAGE_FILE_REGEX } from '../utils/file-types.js'

export interface UploadedFile {
  id: string
  originalName: string
  filename: string
  size: number
  mimeType: string | null
  uploadedAt: string
  /** sha256 of the raw file bytes. Set on new uploads; absent on records written
   *  before this field was added. Used for content-identity dedup so re-uploading
   *  the same image returns the original stored file. */
  contentHash?: string
  /** Origin marker. Absent for normal user uploads; 'crawled' for source-site images imported during a rebuild. */
  source?: 'crawled'
}

/** A pre-existing on-disk file to register as an upload (no multipart/Multer involved). */
export interface LocalFileToRegister {
  /** Absolute path to the source file on disk (trusted, internal). */
  absoluteSourcePath: string
  /** Human-friendly display name (e.g. derived from the source URL). */
  originalName: string
  /** MIME type; if null we derive it from the file extension. */
  mimeType: string | null
  /** Optional pre-known size in bytes; otherwise read via fs.stat. */
  size?: number
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
  expiresAt?: string
}

export interface DeleteUploadedFileResult {
  deleted: boolean
  uploadId?: string
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
  // Other executable formats
  'application/x-shockwave-flash',
  'application/java-archive'
])

const MAX_IMAGE_FILE_SIZE = 25 * 1024 * 1024 // 25MB for images and data files
const MAX_VIDEO_FILE_SIZE = 50 * 1024 * 1024 // 50MB for videos
const MAX_FILES_PER_UPLOAD = 5

const EXTENSION_TO_MIME_TYPE: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff'
}

function mimeTypeFromExtension(filename: string): string | null {
  return EXTENSION_TO_MIME_TYPE[extname(filename).toLowerCase()] ?? null
}

// SECURITY: Zod schemas for metadata validation
// Prevents type confusion, prototype pollution, and validates structure
const UploadedFileSchema = z.object({
  id: z.string(),
  originalName: z.string().max(1000),  // Prevent extremely long filenames
  filename: z.string(),
  size: z.number().int().nonnegative(),
  mimeType: z.string().nullable(),
  uploadedAt: z.string(),
  contentHash: z.string().optional(),
  source: z.enum(['crawled']).optional()
})

const MetadataSchema = z.object({
  uploadId: z.string(),
  appId: z.string(),
  uploadedAt: z.string(),
  expiresAt: z.string().optional(),
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

// Per-app upload mutex. processUpload does a read-modify-write (list existing
// hashes → dedup → write file → write metadata); without serialization two
// concurrent uploads of identical bytes could both miss the dedup and each
// write a file. Simple promise-chain mutex, same pattern as MediaManifestService.
const uploadLocks = new Map<string, Promise<void>>()

async function acquireUploadLock(appId: string): Promise<() => void> {
  while (uploadLocks.has(appId)) {
    await uploadLocks.get(appId)
  }
  let release!: () => void
  uploadLocks.set(appId, new Promise<void>((resolve) => { release = resolve }))
  return () => {
    uploadLocks.delete(appId)
    release()
  }
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
      // Fire-and-forget bootstrap from the constructor. The trailing catch is a
      // safety net: this promise is never awaited, so any throw (including a
      // logging-event emission failing — e.g. when logging is mocked in tests)
      // would otherwise surface as an unhandled rejection and fail the whole
      // run. Real directory-creation errors are already logged via directoryFailure.
      void mkdir(this.uploadsDir, { recursive: true }).then(() => {
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
      }).catch(() => {
        // Never let directory-bootstrap (or its logging) become an unhandled rejection.
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

  /**
   * Core security/size checks for a candidate file, independent of how the bytes
   * arrive (multipart upload vs. an on-disk file being registered). Throws
   * FileValidationError on a blocked extension/mime type or oversize file.
   */
  private assertAllowedFile(params: { originalName: string; mimeType: string | null; size: number }): void {
    if (params.size === 0) {
      throw new FileValidationError('File is empty. Please upload a file with content.')
    }

    const ext = extname(params.originalName).toLowerCase()
    if (BLOCKED_EXTENSIONS.has(ext)) {
      throw new FileValidationError(
        `File type '${ext}' is not allowed for security reasons. Please upload a different file type.`
      )
    }

    if (params.mimeType && BLOCKED_MIME_TYPES.has(params.mimeType)) {
      throw new FileValidationError(
        `File type '${params.mimeType}' is not allowed for security reasons. Please upload a different file type.`
      )
    }

    const isVideo = params.mimeType?.startsWith('video/') ?? false
    const maxSize = isVideo ? MAX_VIDEO_FILE_SIZE : MAX_IMAGE_FILE_SIZE
    if (params.size > maxSize) {
      const limitMB = maxSize / (1024 * 1024)
      throw new FileValidationError(
        `File size ${params.size} bytes exceeds maximum allowed size of ${limitMB}MB for ${isVideo ? 'videos' : 'images/data files'}`
      )
    }
  }

  validateFile(file: Express.Multer.File): void {
    this.assertAllowedFile({
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size
    })
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
    return this.sanitizeSvgContent(file.buffer.toString('utf-8'), file.originalname, file.size, appId, uploadId)
  }

  /**
   * Sanitize raw SVG content and return the cleaned buffer. Shared by the
   * multipart upload path and the local-file registration path.
   * Throws SVGSanitizationError on failure so callers can skip the file.
   */
  private sanitizeSvgContent(
    svgContent: string,
    originalName: string,
    originalSize: number,
    appId: string,
    uploadId: string
  ): { buffer: Buffer; size: number } {
    try {
      const result = sanitizeSVG(svgContent)

      if (result.hadDangerousContent) {
        logger.warn('file-upload.svg.sanitized', {
          appId,
          uploadId,
          originalName,
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
        originalName,
        originalSize,
        sanitizedSize: buffer.length,
        hadThreats: result.hadDangerousContent,
        threats: result.detectedThreats
      })

      return { buffer, size: buffer.length }
    } catch (error) {
      logger.error('file-upload.svg.sanitization-failed', {
        appId,
        uploadId,
        originalName,
        error: error instanceof Error ? error.message : String(error)
      })
      throw new SVGSanitizationError(originalName, error instanceof Error ? error.message : undefined)
    }
  }

  /**
   * Register pre-existing on-disk files as a synthetic upload batch so they
   * surface in the Media tab and behave like uploaded media (listed, served via
   * signed URLs, reusable into slots). Used by the rebuild flow to import
   * crawled source-site images.
   *
   * Unlike processUpload (multipart/Multer, capped at MAX_FILES_PER_UPLOAD),
   * this writes directly from disk and is uncapped. The batch is idempotent for
   * a given uploadId: the upload dir is rebuilt from scratch on each call, and
   * callers should pass stable (content-hash) filenames so URLs stay stable.
   *
   * Per-file failures (missing source, blocked type, oversize, bad SVG) are
   * skipped and logged. Batch-level filesystem errors (the upfront rm /
   * directory creation, or the final metadata.json write) still propagate.
   */
  async registerLocalFilesAsUpload(
    appId: string,
    files: LocalFileToRegister[],
    opts: { uploadId: string; source?: 'crawled' }
  ): Promise<UploadResult> {
    const { uploadId, source } = opts
    const uploadDir = this.pathBuilder.join(appId, uploadId)

    // Rebuild the batch from scratch so a re-run reflects the current crawl.
    if (existsSync(uploadDir)) {
      await rm(uploadDir, { recursive: true, force: true })
    }
    await this.ensureUploadDirectory(appId, uploadId)

    const uploadedFiles: UploadedFile[] = []
    const failedFiles: FailedFile[] = []
    const uploadedAt = new Date().toISOString()
    const seenFilenames = new Set<string>()

    for (const file of files) {
      const filename = basename(file.absoluteSourcePath)
      try {
        if (!isSafeUploadFilename(filename)) {
          throw new FileValidationError(`Unsafe filename: ${filename}`)
        }
        if (seenFilenames.has(filename)) {
          continue // already registered this content-hashed file in this batch
        }

        const mimeType = file.mimeType ?? mimeTypeFromExtension(filename)
        if (!mimeType) {
          // No resolvable content type (unrecognized/missing extension). The media UI
          // lists only image/* | video/*, so this file could never render — skip it
          // instead of writing bytes that are invisible to every consumer.
          throw new FileValidationError(`Unrecognized file type: ${filename}`)
        }
        const size = file.size ?? (await stat(file.absoluteSourcePath)).size
        this.assertAllowedFile({ originalName: filename, mimeType, size })

        const destPath = this.pathBuilder.join(appId, uploadId, filename)

        if (isSVGFile(filename, mimeType ?? undefined)) {
          const svgContent = await readFile(file.absoluteSourcePath, 'utf-8')
          const sanitized = this.sanitizeSvgContent(svgContent, filename, size, appId, uploadId)
          await writeFile(destPath, sanitized.buffer)
          uploadedFiles.push({
            id: `crawled_${filename}`,
            originalName: file.originalName,
            filename,
            size: sanitized.size,
            mimeType,
            uploadedAt,
            ...(source && { source })
          })
        } else {
          await copyFile(file.absoluteSourcePath, destPath)
          uploadedFiles.push({
            id: `crawled_${filename}`,
            originalName: file.originalName,
            filename,
            size,
            mimeType,
            uploadedAt,
            ...(source && { source })
          })
        }

        seenFilenames.add(filename)
      } catch (fileError) {
        failedFiles.push({
          originalName: file.originalName,
          error: fileError instanceof Error ? fileError.message : String(fileError)
        })
        logger.warn('file-upload.register-local.file-skipped', {
          appId,
          uploadId,
          originalName: file.originalName,
          sourcePath: file.absoluteSourcePath,
          error: fileError instanceof Error ? fileError.message : String(fileError)
        })
      }
    }

    // Nothing usable — don't leave an empty batch dir behind.
    if (uploadedFiles.length === 0) {
      await rm(uploadDir, { recursive: true, force: true })
      logger.info('file-upload.register-local.empty', {
        appId,
        uploadId,
        candidateCount: files.length,
        failedCount: failedFiles.length
      })
      return { uploadId, appId, files: [], failedFiles }
    }

    const metadata = {
      uploadId,
      appId,
      uploadedAt,
      fileCount: uploadedFiles.length,
      files: uploadedFiles
    }

    await writeFile(
      this.pathBuilder.join(appId, uploadId, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    )

    logger.info('file-upload.register-local.success', {
      appId,
      uploadId,
      source,
      fileCount: uploadedFiles.length,
      failedCount: failedFiles.length,
      totalSize: uploadedFiles.reduce((sum, f) => sum + f.size, 0)
    })

    return { uploadId, appId, files: uploadedFiles, failedFiles }
  }

  async processUpload(appId: string, files: Express.Multer.File[]): Promise<UploadResult> {
    fileUploadEvents.processStart(logger, {
      appId,
      fileCount: files.length,
      mimeTypes: [...new Set(files.map(f => f.mimetype))],
      imageCount: files.filter(f => f.mimetype.startsWith('image/')).length
    })

    this.validateUpload(files)

    // Serialize per-app so the dedup read-modify-write below is race-free.
    const releaseLock = await acquireUploadLock(appId)
    try {
      return await this.processUploadLocked(appId, files)
    } finally {
      releaseLock()
    }
  }

  private async processUploadLocked(appId: string, files: Express.Multer.File[]): Promise<UploadResult> {
    const uploadId = `upload_${nanoid(12)}`
    // Dir creation is deferred until the first real write (below) so a batch
    // where every file deduped to an existing upload leaves no empty upload_<id>/
    // directory for listUploadedFiles to scan on every later call.
    let uploadDirEnsured = false
    // Returned to the caller (includes dedup reuses so the client gets the
    // filename mapping). `newlyStored` is the subset physically written this
    // call — only those are recorded in metadata, so a deduped re-upload does
    // NOT create a second listing entry for the same file.
    const uploadedFiles: UploadedFile[] = []
    const newlyStored: UploadedFile[] = []
    const uploadedAt = new Date().toISOString()

    const failedFiles: Array<{ originalName: string; error: string }> = []
    let hasServerError = false

    // Read existing content hashes once (not per-file). Track hashes written in
    // THIS batch too — metadata.json isn't persisted until after the loop, so
    // two identical files in one batch would otherwise both be written.
    const existingFiles = await this.listUploadedFiles(appId)
    const hashToRecord = new Map<string, UploadedFile>()
    for (const f of existingFiles) {
      if (f.contentHash && !hashToRecord.has(f.contentHash)) hashToRecord.set(f.contentHash, f)
    }

    for (const file of files) {
      try {
        let fileBuffer = file.buffer
        let actualSize = file.size

        if (isSVGFile(file.originalname, file.mimetype)) {
          const sanitized = this.sanitizeAndBufferSvg(file, appId, uploadId)
          fileBuffer = sanitized.buffer
          actualSize = sanitized.size
        }

        // Content-identity dedup: if this app already has a stored file with
        // the same bytes (from a prior upload OR earlier in this batch), reuse
        // that record without writing a duplicate. The stored filename embeds
        // timestamp+nanoId, so dedup is purely at the file-storage layer.
        const contentHash = createHash('sha256').update(fileBuffer).digest('hex')
        const existingRecord = hashToRecord.get(contentHash)
        if (existingRecord) {
          logger.info('file-upload.content-dedup', {
            appId,
            originalName: file.originalname,
            existingFilename: existingRecord.filename,
          })
          uploadedFiles.push({
            ...existingRecord,
            originalName: file.originalname,
          })
          continue
        }

        const fileId = `file_${nanoid(10)}`
        const ext = extname(file.originalname) || '.bin'
        const filename = `${appId}_${Date.now()}_${fileId}${ext}`
        const filepath = this.pathBuilder.join(appId, uploadId, filename)

        if (!uploadDirEnsured) {
          await this.ensureUploadDirectory(appId, uploadId)
          uploadDirEnsured = true
        }
        await writeFile(filepath, fileBuffer)

        const record: UploadedFile = {
          id: fileId,
          originalName: file.originalname,
          filename,
          size: actualSize,
          mimeType: file.mimetype,
          uploadedAt,
          contentHash,
        }
        uploadedFiles.push(record)
        newlyStored.push(record)
        hashToRecord.set(contentHash, record)

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

    // Record only the files physically written this call. When every file was
    // deduped to an existing upload, there's nothing new to record — skip the
    // metadata write so listUploadedFiles doesn't surface a duplicate entry.
    if (newlyStored.length > 0) {
      const metadata = {
        uploadId,
        appId,
        uploadedAt,
        fileCount: newlyStored.length,
        files: newlyStored
      }

      await writeFile(
        this.pathBuilder.join(appId, uploadId, 'metadata.json'),
        JSON.stringify(metadata, null, 2)
      )
    }

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
      totalSize: uploadedFiles.reduce((sum, f) => sum + f.size, 0),
      mimeTypes: [...new Set(uploadedFiles.map(f => f.mimeType).filter((t): t is string => t !== null && t !== ''))],
      imageCount: uploadedFiles.filter(f => f.mimeType?.startsWith('image/')).length
    })

    return {
      uploadId,
      appId,
      files: uploadedFiles,
      failedFiles
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

      const result: UploadResult = {
        uploadId: metadata.uploadId,
        appId: metadata.appId,
        files: metadata.files,
        failedFiles: []
      }

      // Include expiresAt from old metadata files for backward compatibility
      if (metadata.expiresAt) {
        result.expiresAt = metadata.expiresAt
      }

      return result
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

  // Path traversal safe: getFilePath delegates to pathBuilder.join (createSafePathBuilder)
  async findUploadedFilePath(appId: string, storedFilename: string): Promise<string | null> {
    const appUploadsDir = this.pathBuilder.join(appId)
    if (!existsSync(appUploadsDir)) {
      return null
    }
    const uploadDirs = await readdir(appUploadsDir)
    for (const uploadId of uploadDirs) {
      const candidatePath = this.getFilePath(appId, uploadId, storedFilename)
      if (existsSync(candidatePath)) {
        return candidatePath
      }
    }
    return null
  }

  async findMatchingUpload(appId: string, targetFilename: string): Promise<{ file: UploadedFile; sourcePath: string } | null> {
    const uploadedFiles = await this.listUploadedFiles(appId)
    if (uploadedFiles.length === 0) return null

    const match = uploadedFiles
      .filter(f => f.originalName === targetFilename || f.filename === targetFilename)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
      [0] ?? null

    if (!match) return null

    const sourcePath = await this.findUploadedFilePath(appId, match.filename)
    if (!sourcePath) return null

    return { file: match, sourcePath }
  }

  /**
   * The most-recently-uploaded RASTER image for this app. Rename-tolerant
   * fallback for the empty-file auto-resolve path: agents frequently create the
   * upload under a tidied name (e.g. `logo.png`) that no longer matches the
   * original upload filename, so an exact-name lookup misses and the file is
   * left empty → a broken `<img>`. When the created file is a raster image,
   * resolving to the latest image upload restores the intended "fill this from
   * the image I just uploaded" behaviour.
   *
   * Two safety rails so a rescue never produces the WRONG image:
   *  - SVG uploads are excluded — they are XML, not raster bytes, and would
   *    corrupt a `.png`/`.jpg` target written as binary.
   *  - If 2+ images share the newest `uploadedAt` (they were uploaded in the
   *    same batch — `uploadedAt` is per-batch), "latest" is ambiguous, so we
   *    refuse rather than guess. A visibly-empty file is safer than a silently
   *    wrong one; the agent should use the exact uploaded filename instead.
   */
  async findLatestImageUpload(appId: string): Promise<{ file: UploadedFile; sourcePath: string } | null> {
    const uploadedFiles = await this.listUploadedFiles(appId)
    const images = uploadedFiles
      .filter(f => {
        // IMAGE_FILE_REGEX already excludes svg by extension; the explicit svg
        // mimeType guard is only load-bearing for files whose mime is image/svg+xml
        // but whose extension doesn't end in .svg (rare but possible).
        if (f.mimeType === 'image/svg+xml') return false
        return Boolean(f.mimeType?.startsWith('image/')) || IMAGE_FILE_REGEX.test(f.originalName) || IMAGE_FILE_REGEX.test(f.filename)
      })
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))

    const newest = images[0]
    if (!newest) {
      logger.debug('file-upload.latest-image.none', { appId, imageCount: images.length })
      return null
    }
    // Ambiguous batch (tie on the newest timestamp) → don't risk the wrong image.
    if (images[1] && images[1].uploadedAt === newest.uploadedAt) {
      logger.debug('file-upload.latest-image.ambiguous', { appId, uploadedAt: newest.uploadedAt })
      return null
    }

    const sourcePath = await this.findUploadedFilePath(appId, newest.filename)
    if (!sourcePath) {
      logger.debug('file-upload.latest-image.path-missing', { appId, filename: newest.filename })
      return null
    }

    return { file: newest, sourcePath }
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

          allFiles.push(...metadata.files)
        } catch (error) {
          fileUploadEvents.retrieveFailure(
            logger,
            error instanceof Error ? error : new Error(String(error)),
            { appId, uploadId }
          )
        }
      }

      // Collapse duplicate listings of the same physical file (same stored
      // filename) — these arise from content-dedup re-uploads recorded under
      // more than one uploadId by older code. Keep the first occurrence so the
      // UI and lookups see each upload once.
      const seen = new Set<string>()
      const deduped: UploadedFile[] = []
      for (const f of allFiles) {
        if (seen.has(f.filename)) continue
        seen.add(f.filename)
        deduped.push(f)
      }
      return deduped
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

  async deleteUploadedFile(appId: string, storedFilename: string): Promise<DeleteUploadedFileResult> {
    if (!isSafeUploadFilename(storedFilename)) {
      return { deleted: false }
    }

    const appDir = this.pathBuilder.join(appId)
    if (!existsSync(appDir)) {
      return { deleted: false }
    }

    try {
      const uploadDirs = readdirSync(appDir)

      for (const uploadId of uploadDirs) {
        const metadataPath = this.pathBuilder.join(appId, uploadId, 'metadata.json')
        if (!existsSync(metadataPath)) {
          continue
        }

        let metadata: z.infer<typeof MetadataSchema>
        try {
          const metadataContent = await readFile(metadataPath, 'utf-8')
          const rawMetadata = JSON.parse(metadataContent)
          if (hasPrototypePollution(rawMetadata)) {
            logger.error('file-upload.metadata.prototype-pollution', {
              appId,
              uploadId,
              message: 'SECURITY: Prototype pollution attempt detected in metadata.json'
            }, { tags: ['security', 'prototype-pollution', 'metadata-validation'] })
            continue
          }
          metadata = MetadataSchema.parse(rawMetadata)
        } catch (error) {
          fileUploadEvents.retrieveFailure(
            logger,
            error instanceof Error ? error : new Error(String(error)),
            { appId, uploadId }
          )
          continue
        }

        const fileIndex = metadata.files.findIndex((file) => file.filename === storedFilename)
        if (fileIndex === -1) {
          continue
        }

        const filePath = this.getFilePath(appId, uploadId, storedFilename)
        try {
          await unlink(filePath)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error
          }
        }

        metadata.files.splice(fileIndex, 1)
        metadata.fileCount = metadata.files.length

        const uploadDir = this.pathBuilder.join(appId, uploadId)
        if (metadata.files.length === 0) {
          await rm(uploadDir, { recursive: true, force: true })
        } else {
          await writeFile(metadataPath, JSON.stringify(metadata, null, 2))
        }

        fileUploadEvents.cleanupDeleted(logger, {
          appId,
          uploadId,
          operation: 'delete',
          deletedCount: 1
        })

        return { deleted: true, uploadId }
      }
    } catch (error) {
      fileUploadEvents.cleanupFailure(logger, error instanceof Error ? error : new Error(String(error)), {
        appId,
        operation: 'delete'
      })
      return { deleted: false }
    }

    return { deleted: false }
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
