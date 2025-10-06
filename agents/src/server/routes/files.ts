import { Router, Request, Response, IRouter } from 'express'
import multer from 'multer'
import { fileUploadService } from '../../services/FileUploadService.js'
import { logger } from '../../logging/index.js'

const router: IRouter = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 5
  }
})

router.post('/upload', upload.array('files', 5), async (req: Request, res: Response) => {
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

    const files = req.files as Express.Multer.File[]

    if (!files || files.length === 0) {
      logger.warn('file-upload.validation.no-files', {
        message: 'Upload request has no files',
        appId
      })
      return res.status(400).json({
        error: 'No files provided'
      })
    }

    logger.info('file-upload.request.received', {
      message: 'File upload request received',
      appId,
      fileCount: files.length,
      totalSize: files.reduce((sum, f) => sum + f.size, 0)
    })

    const result = await fileUploadService.processUpload(appId, files)

    logger.info('file-upload.request.success', {
      message: 'File upload completed successfully',
      appId,
      uploadId: result.uploadId,
      fileCount: result.files.length
    })

    return res.status(200).json(result)
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

router.get('/:appId/:uploadId', async (req: Request, res: Response) => {
  try {
    const { appId, uploadId } = req.params

    if (!appId || !uploadId) {
      return res.status(400).json({
        error: 'appId and uploadId are required'
      })
    }

    const upload = await fileUploadService.getUpload(appId, uploadId)

    if (!upload) {
      logger.warn('file-upload.get.not-found', {
        message: 'Upload not found',
        appId,
        uploadId
      })
      return res.status(404).json({
        error: 'Upload not found'
      })
    }

    logger.debug('file-upload.get.success', {
      message: 'Upload retrieved',
      appId,
      uploadId
    })

    return res.status(200).json(upload)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    logger.error('file-upload.get.failed', {
      message: 'Failed to retrieve upload',
      error: errorMessage
    })

    return res.status(500).json({
      error: 'Internal server error'
    })
  }
})

router.delete('/:appId/:uploadId', async (req: Request, res: Response) => {
  try {
    const { appId, uploadId } = req.params

    if (!appId || !uploadId) {
      return res.status(400).json({
        error: 'appId and uploadId are required'
      })
    }

    const deleted = await fileUploadService.deleteUpload(appId, uploadId)

    if (!deleted) {
      logger.warn('file-upload.delete.not-found', {
        message: 'Upload not found for deletion',
        appId,
        uploadId
      })
      return res.status(404).json({
        error: 'Upload not found'
      })
    }

    logger.info('file-upload.delete.success', {
      message: 'Upload deleted',
      appId,
      uploadId
    })

    return res.status(200).json({
      message: 'Upload deleted successfully',
      appId,
      uploadId
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    logger.error('file-upload.delete.failed', {
      message: 'Failed to delete upload',
      error: errorMessage
    })

    return res.status(500).json({
      error: 'Internal server error'
    })
  }
})

export { router as filesRouter }
