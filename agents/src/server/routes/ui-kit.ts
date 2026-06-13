import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { dirname, join, normalize, resolve } from 'path'
import { nanoid } from 'nanoid'
import JSZip from 'jszip'
import { rm } from 'fs/promises'
import { APP_CONFIG_FILES, APP_DIRECTORIES } from '@airo/shared/app-structure'
import { AppRepository } from '../../database/repositories/AppRepository.js'
import { validateAppOwnership } from '../middleware/app-ownership.js'
import { logger } from '../../logging/index.js'
import { stampUploadedKitMetadata, findKitMetaFile } from './ui-kit-metadata.js'

const router: Router = Router()
const appRepo = new AppRepository()

const TEMP_DIR = process.env.IMPORT_TEMP_DIR || '/tmp/airo-imports'
if (!existsSync(TEMP_DIR)) {
  mkdirSync(TEMP_DIR, { recursive: true })
}

const ALLOWED_EXTENSIONS = ['.zip', '.md', '.txt', '.xml', '.html', '.htm', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']

const fileUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TEMP_DIR),
    filename: (_req, file, cb) => {
      const ext = file.originalname.substring(file.originalname.lastIndexOf('.')) || ''
      cb(null, `upload-${Date.now()}-${nanoid(8)}${ext}`)
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.substring(file.originalname.lastIndexOf('.')).toLowerCase()
    if (ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true)
    } else {
      cb(new Error(`File type not allowed. Accepted: ${ALLOWED_EXTENSIONS.join(', ')}`))
    }
  },
})

function isSafePath(filePath: string): boolean {
  return !filePath.includes('..') && !filePath.startsWith('/') && !filePath.includes('\0')
}

const ALLOWED_ZIP_PREFIXES = ['src/styles/', 'src/pages/', 'src/components/', 'docs/']
const ALLOWED_ZIP_EXACT = ['src/design.md']

const APP_IMPORT_PREFIXES = APP_DIRECTORIES.map(d => `${d}/`)
const APP_IMPORT_CONFIG_FILE_SET = new Set<string>(APP_CONFIG_FILES)

const APP_IMPORT_SKIP_PREFIXES = ['node_modules/', '.git/']
const APP_IMPORT_SKIP_FILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'])

const MAX_APP_IMPORT_FILES = 2000
const MAX_APP_IMPORT_UNCOMPRESSED_BYTES = 100 * 1024 * 1024 // 100MB

function isAllowedZipPath(filePath: string): boolean {
  if (ALLOWED_ZIP_EXACT.includes(filePath)) return true
  return ALLOWED_ZIP_PREFIXES.some(prefix => filePath.startsWith(prefix))
}

function isAllowedAppImportPath(filePath: string): boolean {
  if (APP_IMPORT_SKIP_PREFIXES.some(prefix => filePath.startsWith(prefix))) return false
  if (APP_IMPORT_SKIP_FILES.has(filePath)) return false
  if (APP_IMPORT_CONFIG_FILE_SET.has(filePath)) return true
  return APP_IMPORT_PREFIXES.some(prefix => filePath.startsWith(prefix))
}

function detectAppBuilderZip(zip: JSZip, commonPrefix: string): boolean {
  const hasFile = (name: string): boolean => !!zip.files[name] || !!zip.files[`${commonPrefix}${name}`]
  const hasDir = (name: string): boolean => {
    const prefixed = commonPrefix ? `${commonPrefix}${name}` : name
    return Object.keys(zip.files).some(p => p.startsWith(prefixed))
  }

  if (!hasFile('package.json')) return false
  if (!hasFile('index.html')) return false
  if (!hasDir('src/')) return false

  const hasViteConfig = hasFile('vite.config.ts') || hasFile('vite.config.js') || hasFile('vite.config.mjs')
  if (!hasViteConfig) return false

  return true
}

function detectCommonPrefix(paths: string[]): string {
  // Check if every entry starts with the same top-level folder
  const topDirs = new Set(paths.map(p => p.split('/')[0]).filter(Boolean))
  if (topDirs.size === 1) {
    const prefix = [...topDirs][0] + '/'
    // Only strip if the prefix isn't the only segment (i.e., files exist inside it)
    if (paths.some(p => p.startsWith(prefix) && p.length > prefix.length)) {
      return prefix
    }
  }
  return ''
}

router.use('/apps/:id([a-z0-9]{10})', validateAppOwnership)

router.post('/apps/:id/file-upload', (req: Request, res: Response) => {
  const appId = req.params.id!
  const app = appRepo.findById(appId)
  if (!app) {
    res.status(404).json({ error: 'App not found' })
    return
  }

  fileUpload.single('file')(req, res, async (err) => {
    let filePath: string | null = null
    try {
      if (err) {
        res.status(400).json({ error: err.message || 'Upload failed' })
        return
      }
      if (!req.file) {
        res.status(400).json({ error: 'File required' })
        return
      }

      filePath = req.file.path
      const fileName = req.file.originalname

      if (fileName.endsWith('.zip')) {
        const zipData = readFileSync(filePath)
        const zip = await JSZip.loadAsync(zipData)

        // Detect common prefix (macOS Finder wraps in a folder)
        const allPaths = Object.keys(zip.files).filter(p => !p.startsWith('__MACOSX/'))
        const commonPrefix = detectCommonPrefix(allPaths)

        // Check for kit-meta.json with and without the common prefix.
        // Shared predicate so detection and metadata id-resolution can't drift.
        const isUiKit = !!findKitMetaFile(zip, commonPrefix)
        const isAppImport = !isUiKit && detectAppBuilderZip(zip, commonPrefix)

        const targetDir = isUiKit
          ? join(app.path, 'docs', 'ui-kit')
          : app.path

        const entries = Object.entries(zip.files).filter(([, f]) => !f.dir)
        let written = 0
        let totalUncompressedBytes = 0

        for (const [entryPath, file] of entries) {
          // Skip macOS resource fork files
          if (entryPath.startsWith('__MACOSX/')) continue
          if (entryPath.endsWith('.DS_Store')) continue

          // Strip common prefix so nested ZIPs extract flat
          const stripped = commonPrefix && entryPath.startsWith(commonPrefix) ? entryPath.slice(commonPrefix.length) : entryPath
          if (!stripped) continue

          const normalized = stripped.replace(/\\/g, '/')
          if (!isSafePath(normalized)) continue

          if (isUiKit) {
            // UI kits: no path restriction (all safe paths allowed)
          } else if (isAppImport) {
            if (!isAllowedAppImportPath(normalized)) continue
          } else {
            if (!isAllowedZipPath(normalized)) continue
          }

          if (written >= MAX_APP_IMPORT_FILES) {
            logger.warn('route.file-upload.zip.file_count_exceeded', { appId, limit: MAX_APP_IMPORT_FILES })
            res.status(422).json({ error: `Zip exceeds maximum file count (${MAX_APP_IMPORT_FILES})` })
            return
          }

          const fullPath = resolve(join(targetDir, normalized))
          if (!normalize(fullPath).startsWith(resolve(targetDir))) continue

          mkdirSync(dirname(fullPath), { recursive: true })

          if (/\.(png|jpg|jpeg|gif|svg|ico|webp)$/i.test(normalized)) {
            const buf = await (file as JSZip.JSZipObject).async('nodebuffer')
            totalUncompressedBytes += buf.length
            if (totalUncompressedBytes > MAX_APP_IMPORT_UNCOMPRESSED_BYTES) {
              logger.warn('route.file-upload.zip.size_exceeded', { appId, limit: MAX_APP_IMPORT_UNCOMPRESSED_BYTES })
              res.status(422).json({ error: 'Zip exceeds maximum uncompressed size (100MB)' })
              return
            }
            writeFileSync(fullPath, buf)
          } else {
            const content = await (file as JSZip.JSZipObject).async('string')
            totalUncompressedBytes += Buffer.byteLength(content, 'utf-8')
            if (totalUncompressedBytes > MAX_APP_IMPORT_UNCOMPRESSED_BYTES) {
              logger.warn('route.file-upload.zip.size_exceeded', { appId, limit: MAX_APP_IMPORT_UNCOMPRESSED_BYTES })
              res.status(422).json({ error: 'Zip exceeds maximum uncompressed size (100MB)' })
              return
            }
            writeFileSync(fullPath, content, 'utf-8')
          }
          written++
        }

        await rm(filePath, { force: true })

        if (written === 0 && entries.length > 0) {
          logger.warn('route.file-upload.zip.no_files_written', { appId, entryCount: entries.length, isUiKit, isAppImport })
          res.status(422).json({ error: 'No recognizable files found in zip', written: 0, isUiKit, isAppImport })
          return
        }

        // Record design-kit provenance for UI-kit uploads (best-effort).
        if (isUiKit) {
          await stampUploadedKitMetadata(appId, zip, commonPrefix, fileName)
        }

        logger.info('route.file-upload.zip.success', { appId, written, isUiKit, isAppImport })
        res.json({ success: true, written, isUiKit, isAppImport })
      } else {
        const isImage = /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(fileName)
        const targetDir = isImage ? 'src/assets' : 'docs'
        const targetPath = join(app.path, targetDir, fileName)
        const resolvedTarget = resolve(targetPath)
        if (!normalize(resolvedTarget).startsWith(resolve(app.path))) {
          await rm(filePath, { force: true })
          res.status(400).json({ error: 'Invalid file path' })
          return
        }

        mkdirSync(dirname(targetPath), { recursive: true })
        if (isImage) {
          const buf = readFileSync(filePath)
          writeFileSync(targetPath, buf)
        } else {
          const content = readFileSync(filePath, 'utf-8')
          writeFileSync(targetPath, content, 'utf-8')
        }
        await rm(filePath, { force: true })

        const writtenPath = `${targetDir}/${fileName}`
        logger.info('route.file-upload.single.success', { appId, fileName, targetDir })
        res.json({ success: true, written: 1, path: writtenPath })
      }
    } catch (error) {
      if (filePath) await rm(filePath, { force: true }).catch(() => {})
      logger.error('route.file-upload.error', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      })
      res.status(500).json({ error: 'Failed to process file' })
    }
  })
})


export default router
