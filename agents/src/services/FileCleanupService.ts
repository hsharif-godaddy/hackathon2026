import { fileUploadService } from './FileUploadService.js'
import { logger } from '../logging/index.js'

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000

export class FileCleanupService {
  private intervalId: NodeJS.Timeout | null = null
  private isRunning = false

  start(): void {
    if (this.isRunning) {
      logger.warn('file-cleanup.already-running', {
        message: 'File cleanup service is already running'
      })
      return
    }

    this.isRunning = true

    logger.info('file-cleanup.start', {
      message: 'Starting file cleanup service',
      intervalMs: CLEANUP_INTERVAL_MS
    })

    this.runCleanup()

    this.intervalId = setInterval(() => {
      this.runCleanup()
    }, CLEANUP_INTERVAL_MS)
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }

    this.isRunning = false

    logger.info('file-cleanup.stop', {
      message: 'File cleanup service stopped'
    })
  }

  private async runCleanup(): Promise<void> {
    try {
      logger.debug('file-cleanup.run.start', {
        message: 'Running file cleanup'
      })

      const deletedCount = await fileUploadService.deleteExpiredUploads()

      if (deletedCount > 0) {
        logger.info('file-cleanup.run.success', {
          message: 'File cleanup completed',
          deletedCount
        })
      } else {
        logger.debug('file-cleanup.run.no-expired', {
          message: 'No expired uploads found'
        })
      }
    } catch (error) {
      logger.error('file-cleanup.run.failed', {
        message: 'File cleanup failed',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      })
    }
  }

  async cleanupAppUploads(appId: string): Promise<number> {
    try {
      logger.info('file-cleanup.app.start', {
        message: 'Cleaning up uploads for app',
        appId
      })

      const deletedCount = await fileUploadService.cleanupAppUploads(appId)

      logger.info('file-cleanup.app.success', {
        message: 'App uploads cleaned up',
        appId,
        deletedCount
      })

      return deletedCount
    } catch (error) {
      logger.error('file-cleanup.app.failed', {
        message: 'Failed to cleanup app uploads',
        appId,
        error: error instanceof Error ? error.message : String(error)
      })
      return 0
    }
  }
}

export const fileCleanupService = new FileCleanupService()
