import { Router, IRouter, Request, Response } from 'express';
import v8 from 'node:v8';
import { logger } from '../../logging/index.js';
import { gdAuthService } from '../../services/gd-auth-service.js';

const router: IRouter = Router();

/**
 * Authentication middleware for diagnostics endpoints
 * Validates JOMAX tokens via gd-auth service
 */
async function authenticateJomaxToken(
  req: Request,
  res: Response
): Promise<{ valid: false } | { valid: true; shopperId: string; cid: string }> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    logger.warn('diagnostics.auth.missing_bearer', {
      path: req.path,
      method: req.method,
    });
    res.status(401).json({
      error: 'JOMAX token required',
      hint: 'Include Authorization: Bearer <jomax-token> header',
    });
    return { valid: false };
  }

  const token = authHeader.substring(7);

  // Validate JOMAX token via gd-auth
  let jomaxResult;
  try {
    jomaxResult = await gdAuthService.instance.authenticate(token);
  } catch (error) {
    // Service initialization failed (likely SSO_HOST not configured)
    logger.error('diagnostics.auth.service_error', {
      path: req.path,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(503).json({
      error: 'Authentication service unavailable',
    });
    return { valid: false };
  }

  if (!jomaxResult.valid) {
    logger.warn('diagnostics.auth.invalid_token', {
      path: req.path,
      reason: jomaxResult.reason,
    });
    res.status(403).json({
      error: 'Invalid JOMAX token',
      reason: jomaxResult.reason,
    });
    return { valid: false };
  }

  return {
    valid: true,
    shopperId: jomaxResult.payload?.shopperId || 'unknown',
    cid: jomaxResult.payload?.cid || 'unknown',
  };
}

/**
 * GET /memory - Memory diagnostics (mounted at /diagnostics/memory)
 * Accepts only JOMAX tokens from debug-console
 */
router.get('/memory', async (req: Request, res: Response): Promise<void> => {
  const authResult = await authenticateJomaxToken(req, res);
  if (!authResult.valid) {
    return;
  }

  // Collect V8 heap statistics
  const heapStats = v8.getHeapStatistics();
  const heapSpaces = v8.getHeapSpaceStatistics();

  logger.info('diagnostics.memory.accessed', {
    shopperId: authResult.shopperId,
    cid: authResult.cid,
  });

  res.json({
    timestamp: new Date().toISOString(),
    heapStats: {
      totalHeapSize: heapStats.total_heap_size,
      totalHeapSizeExecutable: heapStats.total_heap_size_executable,
      totalPhysicalSize: heapStats.total_physical_size,
      totalAvailableSize: heapStats.total_available_size,
      usedHeapSize: heapStats.used_heap_size,
      heapSizeLimit: heapStats.heap_size_limit,
      mallocedMemory: heapStats.malloced_memory,
      externalMemory: heapStats.external_memory,
      peakMallocedMemory: heapStats.peak_malloced_memory,
    },
    heapSpaces: heapSpaces.map((space) => ({
      name: space.space_name,
      size: space.space_size,
      used: space.space_used_size,
      available: space.space_available_size,
      physicalSize: space.physical_space_size,
    })),
    memory: process.memoryUsage(),
    uptime: process.uptime(),
  });
});

/**
 * Process-level rate limiter for snapshot generation
 * Only allows one snapshot at a time to prevent memory/disk pressure
 */
let isSnapshotInProgress = false;

/**
 * GET /snapshot - Generate and download heap snapshot (mounted at /diagnostics/snapshot)
 * Accepts only JOMAX tokens from debug-console
 * Returns binary .heapsnapshot file for analysis in Chrome DevTools
 *
 * Query parameters:
 * - name: Optional label to include in filename (e.g., ?name=before-deploy)
 *
 * Rate limit: 1 concurrent snapshot for entire process (v8.writeHeapSnapshot() is expensive)
 */
router.get('/snapshot', async (req: Request, res: Response): Promise<void> => {
  const authResult = await authenticateJomaxToken(req, res);
  if (!authResult.valid) {
    return;
  }

  // Rate limiting: only allow one snapshot at a time
  if (isSnapshotInProgress) {
    logger.warn('diagnostics.snapshot.rate_limited', {
      shopperId: authResult.shopperId,
      cid: authResult.cid,
      reason: 'Snapshot already in progress',
    });
    res.status(429).json({
      error: 'Snapshot generation already in progress',
      hint: 'Please wait for the current snapshot to complete',
    });
    return;
  }

  isSnapshotInProgress = true;

  const customName = typeof req.query.name === 'string' ? req.query.name : undefined;

  logger.info('diagnostics.snapshot.begin', {
    shopperId: authResult.shopperId,
    cid: authResult.cid,
    customName,
  });

  let snapshotPath: string | undefined;
  let stream: ReturnType<typeof import('node:fs').createReadStream> | undefined;

  try {
    // Generate heap snapshot to temp file (blocks event loop briefly)
    snapshotPath = v8.writeHeapSnapshot();

    logger.info('diagnostics.snapshot.generated', {
      shopperId: authResult.shopperId,
      cid: authResult.cid,
      path: snapshotPath,
    });

    // Generate filename with timestamp and optional custom name
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const namePart = customName ? `-${customName.replace(/[^a-z0-9-]/gi, '_')}` : '';
    const filename = `heap-snapshot-${timestamp}${namePart}.heapsnapshot`;

    // Set headers for binary file download
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Stream the file and delete after sending
    const fs = await import('node:fs');
    stream = fs.createReadStream(snapshotPath);

    // Handle client disconnection - destroy stream to prevent file descriptor leak
    res.on('close', () => {
      if (stream && !stream.destroyed) {
        logger.info('diagnostics.snapshot.client_disconnected', {
          path: snapshotPath,
        });
        stream.destroy();
      }
    });

    // Clean up temp file after stream is fully closed (not just ended)
    // Using 'close' instead of 'end' avoids race condition with file deletion
    stream.on('close', () => {
      if (snapshotPath) {
        fs.unlink(snapshotPath, (err) => {
          if (err) {
            logger.warn('diagnostics.snapshot.cleanup_failed', {
              path: snapshotPath,
              error: err.message,
            });
          } else {
            logger.info('diagnostics.snapshot.cleanup_success', {
              path: snapshotPath,
            });
          }
        });
      }
      // Release rate limiter after cleanup
      isSnapshotInProgress = false;
    });

    stream.on('error', (error) => {
      logger.error('diagnostics.snapshot.stream_error', {
        path: snapshotPath,
        error: error.message,
      });
      // Release rate limiter on error
      isSnapshotInProgress = false;
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream snapshot' });
      }
    });

    stream.pipe(res);
  } catch (error) {
    logger.error('diagnostics.snapshot.failed', {
      shopperId: authResult.shopperId,
      cid: authResult.cid,
      error: error instanceof Error ? error.message : String(error),
    });
    // Release rate limiter on error
    isSnapshotInProgress = false;
    res.status(500).json({
      error: 'Failed to generate heap snapshot',
    });
  }
});

export const diagnosticsRouter = router;
