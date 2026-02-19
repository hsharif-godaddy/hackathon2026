import { Router, Request, Response, NextFunction, IRouter } from 'express'
import rateLimit from 'express-rate-limit'
import multer from 'multer'
import { fileUploadService } from '../../services/FileUploadService.js'
import { logger, log } from '../../logging/index.js'
import { validateAppOwnershipFromBody } from '../middleware/app-ownership.js'
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js'
import { signFileUrl, verifyFileSignature } from '../../utils/file-url-signer.js'

const router: IRouter = Router()

// Public router for file serving with signed URLs (no JWT required)
const publicRouter: IRouter = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 5
  }
})

// SECURITY: Rate limiting for file uploads to prevent abuse
// Limits: 20 uploads per 2 minutes per IP
const UPLOAD_RATE_LIMIT_WINDOW_MS = 2 * 60 * 1000 // 2 minutes
const uploadRateLimiter = rateLimit({
  windowMs: UPLOAD_RATE_LIMIT_WINDOW_MS,
  max: 20,                    // 20 requests per window
  message: 'Too many upload requests from this IP, please try again later',
  standardHeaders: true,      // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false,       // Disable `X-RateLimit-*` headers
  // Key generator: Use IP address for rate limiting
  keyGenerator: (req: Request) => {
    return req.ip || req.socket.remoteAddress || 'unknown'
  },
  // Handler called when rate limit is exceeded
  handler: (req: Request, res: Response) => {
    logger.warn('file-upload.rate-limit-exceeded', {
      ip: req.ip,
      appId: req.body?.appId,
      message: 'File upload rate limit exceeded'
    }, { tags: ['security', 'rate-limiting', 'abuse-prevention'] })

    // Calculate retry-after in seconds (2 minute window)
    const retryAfter = Math.ceil(UPLOAD_RATE_LIMIT_WINDOW_MS / 1000)

    res.status(429).json({
      error: 'Too many upload requests from this IP, please try again later',
      retryAfter
    })
  }
})

// SECURITY: Middleware to validate appId from params for file routes
// Validates that params.appId matches authenticated siteId
const validateAppIdParam = (req: Request, res: Response, next: NextFunction): void => {
  const authReq = req as AuthenticatedRequest;
  const authenticatedSiteId = authReq.agentContext?.siteId;
  const requestedAppId = req.params.appId;

  if (!authenticatedSiteId) {
    res.status(401).json({ error: 'Authentication required', requiresAuth: true });
    return;
  }

  if (!requestedAppId) {
    res.status(400).json({ error: 'appId is required' });
    return;
  }

  if (authenticatedSiteId !== requestedAppId) {
    logger.error('route.files.ownership.denied', {
      message: 'SECURITY VIOLATION: Cross-tenant file access attempt',
      authenticatedSiteId,
      requestedAppId,
      path: req.path
    }, { tags: ['security', 'authorization-failure', 'cross-tenant-attempt'] });
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  next();
};

// SECURITY: Apply ownership validation AFTER multer parses multipart body
// Multer must run first to populate req.body from multipart/form-data
// Rate limiter applied first to prevent abuse before processing
router.post('/upload', uploadRateLimiter, upload.array('files', 5), validateAppOwnershipFromBody('appId'), async (req: Request, res: Response) => {
  try {
    const { appId } = req.body

    if (!appId || typeof appId !== 'string') {
      logger.warn('file-upload.validation.missing-app-id', {
        message: 'Upload request missing appId'
      })
      return res.status(400).json({
        error: 'appId is required in request body'
      })
    }

    const contextLogger = log.forApp(appId)
    const files = req.files as Express.Multer.File[]

    if (!files || files.length === 0) {
      contextLogger.warn('file-upload.validation.no-files', {
        message: 'Upload request has no files'
      })
      return res.status(400).json({
        error: 'No files provided'
      })
    }

    contextLogger.info('file-upload.request.received', {
      message: 'File upload request received',
      fileCount: files.length,
      totalSize: files.reduce((sum, f) => sum + f.size, 0)
    })

    const result = await fileUploadService.processUpload(appId, files)

    // Add signed URLs to response for browser access
    // Wrap in try-catch to handle missing encryption key gracefully
    const filesWithSignedUrls = result.files.map(file => {
      try {
        return {
          ...file,
          signedUrl: signFileUrl(appId, file.filename)
        }
      } catch (signError) {
        contextLogger.warn('file-upload.signing.failed', {
          message: 'Failed to generate signed URL for file',
          filename: file.filename,
          error: signError instanceof Error ? signError.message : String(signError)
        })
        // Return file without signedUrl - frontend will use fallback UI
        return file
      }
    })

    contextLogger.info('file-upload.request.success', {
      message: 'File upload completed successfully',
      uploadId: result.uploadId,
      fileCount: result.files.length
    })

    // Return full result with augmented files (preserves appId, expiresAt for backwards compatibility)
    return res.status(200).json({
      ...result,
      files: filesWithSignedUrls
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    logger.error('file-upload.request.failed', {
      message: 'File upload failed',
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined
    })

    if (errorMessage.includes('Invalid') || errorMessage.includes('Unsupported') || errorMessage.includes('Too many') || errorMessage.includes('exceeds maximum')) {
      return res.status(400).json({
        error: errorMessage
      })
    }

    return res.status(500).json({
      error: 'Internal server error'
    })
  }
})

// List all uploaded files for an app
// NOTE: Must be defined BEFORE /:appId/:uploadId to avoid route shadowing
router.get('/:appId/list', validateAppIdParam, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params

    if (!appId) {
      return res.status(400).json({
        error: 'appId is required'
      })
    }

    const contextLogger = log.forApp(appId)

    const files = await fileUploadService.listUploadedFiles(appId)

    // Add signed URLs to each file for browser access
    const filesWithSignedUrls = files.map(file => {
      try {
        return {
          ...file,
          signedUrl: signFileUrl(appId, file.filename)
        }
      } catch (signError) {
        contextLogger.warn('file-upload.list.signing.failed', {
          message: 'Failed to generate signed URL for file',
          filename: file.filename,
          error: signError instanceof Error ? signError.message : String(signError)
        })
        // Return file without signedUrl - frontend will use fallback UI
        return file
      }
    })

    contextLogger.debug('file-upload.list.success', {
      message: 'Listed uploaded files',
      fileCount: files.length
    })

    return res.status(200).json({ files: filesWithSignedUrls })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const contextLogger = req.params.appId ? log.forApp(req.params.appId) : logger

    contextLogger.error('file-upload.list.failed', {
      message: 'Failed to list uploads',
      error: errorMessage
    })

    return res.status(500).json({
      error: 'Internal server error'
    })
  }
})

// SECURITY: Apply ownership validation to get/delete routes (params.appId)
router.get('/:appId/:uploadId', validateAppIdParam, async (req: Request, res: Response) => {
  try {
    const { appId, uploadId } = req.params

    if (!appId || !uploadId) {
      return res.status(400).json({
        error: 'appId and uploadId are required'
      })
    }

    const contextLogger = log.forApp(appId)

    const upload = await fileUploadService.getUpload(appId, uploadId)

    if (!upload) {
      contextLogger.warn('file-upload.get.not-found', {
        message: 'Upload not found',
        uploadId
      })
      return res.status(404).json({
        error: 'Upload not found'
      })
    }

    contextLogger.debug('file-upload.get.success', {
      message: 'Upload retrieved',
      uploadId
    })

    return res.status(200).json(upload)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const contextLogger = req.params.appId ? log.forApp(req.params.appId) : logger

    contextLogger.error('file-upload.get.failed', {
      message: 'Failed to retrieve upload',
      error: errorMessage
    })

    return res.status(500).json({
      error: 'Internal server error'
    })
  }
})

router.delete('/:appId/:uploadId', validateAppIdParam, async (req: Request, res: Response) => {
  try {
    const { appId, uploadId } = req.params

    if (!appId || !uploadId) {
      return res.status(400).json({
        error: 'appId and uploadId are required'
      })
    }

    const contextLogger = log.forApp(appId)

    const deleted = await fileUploadService.deleteUpload(appId, uploadId)

    if (!deleted) {
      contextLogger.warn('file-upload.delete.not-found', {
        message: 'Upload not found for deletion',
        uploadId
      })
      return res.status(404).json({
        error: 'Upload not found'
      })
    }

    contextLogger.info('file-upload.delete.success', {
      message: 'Upload deleted',
      uploadId
    })

    return res.status(200).json({
      message: 'Upload deleted successfully',
      appId,
      uploadId
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const contextLogger = req.params.appId ? log.forApp(req.params.appId) : logger

    contextLogger.error('file-upload.delete.failed', {
      message: 'Failed to delete upload',
      error: errorMessage
    })

    return res.status(500).json({
      error: 'Internal server error'
    })
  }
})

// Serve uploaded files - on public router (supports signed URLs without JWT)
publicRouter.get('/uploads/:appId/:filename', async (req: Request, res: Response) => {
  // CORS: Set Cross-Origin-Resource-Policy early so error responses can be read by browser
  // Without this, browsers block access to error response bodies on cross-origin requests
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')

  try {
    const { appId, filename } = req.params
    const { sig, exp } = req.query

    if (!appId || !filename) {
      return res.status(400).json({ error: 'appId and filename are required' })
    }

    // Path 1: Signed URL authentication (no JWT needed)
    // Track if we're using signed URL auth for cache-control
    let signedUrlExpiry: number | null = null
    if (sig && exp) {
      // Validate query params are strings (not arrays)
      if (typeof sig !== 'string' || typeof exp !== 'string') {
        logger.warn('route.files.serve.signature-invalid', {
          appId,
          filename,
          reason: 'invalid-params'
        })
        return res.status(401).json({ error: 'Invalid signature parameters' })
      }
      const expNum = parseInt(exp, 10)
      const nowSeconds = Math.floor(Date.now() / 1000)
      if (isNaN(expNum)) {
        logger.warn('route.files.serve.signature-invalid', {
          appId,
          filename,
          exp,
          reason: 'invalid-exp-format'
        })
        return res.status(401).json({ error: 'Invalid or expired signature' })
      }
      if (expNum < nowSeconds) {
        logger.warn('route.files.serve.signature-invalid', {
          appId,
          filename,
          expNum,
          nowSeconds,
          reason: 'expired'
        })
        return res.status(401).json({ error: 'Invalid or expired signature' })
      }
      if (!verifyFileSignature(appId, filename, sig, expNum)) {
        logger.warn('route.files.serve.signature-invalid', {
          appId,
          filename,
          sigLength: sig.length,
          reason: 'signature-mismatch'
        })
        return res.status(401).json({ error: 'Invalid or expired signature' })
      }
      // Signature valid - proceed to serve file
      signedUrlExpiry = expNum
      logger.debug('route.files.serve.signature-valid', { appId, filename })
    }
    // Path 2: JWT authentication (existing behavior)
    else {
      const authReq = req as AuthenticatedRequest
      const authenticatedSiteId = authReq.agentContext?.siteId

      if (!authenticatedSiteId) {
        return res.status(401).json({ error: 'Authentication required', requiresAuth: true })
      }

      // Import BYPASS_SITE_IDS for development/testing
      const { BYPASS_SITE_IDS } = await import('../../services/features.js')
      const isBypassSite = BYPASS_SITE_IDS.includes(authenticatedSiteId)

      logger.debug('route.files.serve.auth-check', {
        authenticatedSiteId,
        requestedAppId: appId,
        isBypassSite,
        filename
      })

      if (!isBypassSite && authenticatedSiteId !== appId) {
        logger.error('route.files.serve.ownership-denied', {
          message: 'SECURITY VIOLATION: Cross-tenant file access attempt',
          authenticatedSiteId,
          requestedAppId: appId,
          filename
        }, { tags: ['security', 'authorization-failure', 'cross-tenant-attempt'] })
        return res.status(403).json({ error: 'Access denied' })
      }
    }

    // Find the file across all uploads for this app
    const uploadedFiles = await fileUploadService.listUploadedFiles(appId)
    const matchingFile = uploadedFiles.find(f => f.filename === filename)

    if (!matchingFile) {
      logger.warn('route.files.serve.not-found', { appId, filename })
      return res.status(404).json({ error: 'File not found' })
    }

    // Get the file path - need to find which uploadId directory it's in
    const appDir = fileUploadService.getAppUploadsDir(appId)
    const { readdirSync, existsSync } = await import('fs')
    const { readFile } = await import('fs/promises')

    let filePath: string | null = null
    if (existsSync(appDir)) {
      const uploadDirs = readdirSync(appDir)
      for (const uploadId of uploadDirs) {
        const candidatePath = fileUploadService.getFilePath(appId, uploadId, filename)
        if (existsSync(candidatePath)) {
          filePath = candidatePath
          break
        }
      }
    }

    if (!filePath) {
      logger.warn('route.files.serve.file-missing', { appId, filename })
      return res.status(404).json({ error: 'File not found on disk' })
    }

    // Read and serve the file
    const fileBuffer = await readFile(filePath)

    // Set appropriate content-type and security headers
    res.setHeader('Content-Type', matchingFile.mimeType || 'application/octet-stream')
    res.setHeader('Content-Length', fileBuffer.length)

    // Set Cache-Control based on auth method
    // Signed URLs: cache until expiry (private to avoid proxy caching after expiry)
    // JWT auth: cache for 1 year (public, revalidation handled by JWT)
    if (signedUrlExpiry !== null) {
      const nowSeconds = Math.floor(Date.now() / 1000)
      const remainingLifetimeSeconds = Math.max(signedUrlExpiry - nowSeconds, 0)
      res.setHeader('Cache-Control', `private, max-age=${remainingLifetimeSeconds}`)
    } else {
      res.setHeader('Cache-Control', 'public, max-age=31536000') // Cache for 1 year
    }
    // SECURITY: Prevent MIME-sniffing to avoid XSS if HTML content is uploaded
    res.setHeader('X-Content-Type-Options', 'nosniff')
    // Note: Cross-Origin-Resource-Policy is set at the start of the handler

    // SECURITY: Additional defense-in-depth for SVG files (sanitized at upload, restricted at serving)
    if (matchingFile.mimeType === 'image/svg+xml' || matchingFile.filename.endsWith('.svg')) {
      // Strict CSP: No scripts, no external resources, only inline styles for SVG rendering
      res.setHeader('Content-Security-Policy',
        "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'none'; object-src 'none'"
      )
      logger.debug('route.files.serve.svg-csp-applied', {
        appId,
        filename,
        message: 'Applied strict CSP to SVG file'
      }, { tags: ['security', 'svg', 'csp'] })
    }

    return res.send(fileBuffer)
  } catch (error) {
    logger.error('route.files.serve.error', {
      appId: req.params.appId,
      filename: req.params.filename,
      error: error instanceof Error ? error.message : String(error)
    })
    return res.status(500).json({ error: 'Failed to serve file' })
  }
})

export { router as filesRouter, publicRouter as filesPublicRouter }
