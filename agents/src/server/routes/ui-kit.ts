import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { dirname, join, normalize, resolve } from 'path'
import { nanoid } from 'nanoid'
import JSZip from 'jszip'
import { rm } from 'fs/promises'
import { AppRepository } from '../../database/repositories/AppRepository.js'
import { validateAppOwnership } from '../middleware/app-ownership.js'
import { logger } from '../../logging/index.js'

const router: Router = Router()
const appRepo = new AppRepository()

const TEMP_DIR = process.env.IMPORT_TEMP_DIR || '/tmp/airo-imports'
if (!existsSync(TEMP_DIR)) {
  mkdirSync(TEMP_DIR, { recursive: true })
}

const ALLOWED_EXTENSIONS = ['.zip', '.md', '.txt', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']

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

function isAllowedZipPath(filePath: string): boolean {
  if (ALLOWED_ZIP_EXACT.includes(filePath)) return true
  return ALLOWED_ZIP_PREFIXES.some(prefix => filePath.startsWith(prefix))
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

        // Check for kit-meta.json with and without the common prefix
        const isUiKit = !!zip.files['kit-meta.json'] || !!zip.files[`${commonPrefix}kit-meta.json`]

        const targetDir = isUiKit
          ? join(app.path, 'docs', 'ui-kit')
          : app.path

        const entries = Object.entries(zip.files).filter(([, f]) => !f.dir)
        let written = 0

        for (const [entryPath, file] of entries) {
          // Skip macOS resource fork files
          if (entryPath.startsWith('__MACOSX/')) continue
          if (entryPath.endsWith('.DS_Store')) continue

          // Strip common prefix so nested ZIPs extract flat
          const stripped = commonPrefix && entryPath.startsWith(commonPrefix) ? entryPath.slice(commonPrefix.length) : entryPath
          if (!stripped) continue

          const normalized = stripped.replace(/\\/g, '/')
          if (!isSafePath(normalized)) continue

          // Non-UI-kit ZIPs must pass path allowlist
          if (!isUiKit && !isAllowedZipPath(normalized)) continue

          const fullPath = resolve(join(targetDir, normalized))
          if (!normalize(fullPath).startsWith(resolve(targetDir))) continue

          mkdirSync(dirname(fullPath), { recursive: true })

          if (/\.(png|jpg|jpeg|gif|svg|ico|webp)$/i.test(normalized)) {
            const buf = await (file as JSZip.JSZipObject).async('nodebuffer')
            writeFileSync(fullPath, buf)
          } else {
            const content = await (file as JSZip.JSZipObject).async('string')
            writeFileSync(fullPath, content, 'utf-8')
          }
          written++
        }

        await rm(filePath, { force: true })
        logger.info('route.file-upload.zip.success', { appId, written, isUiKit })
        res.json({ success: true, written, isUiKit })
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
