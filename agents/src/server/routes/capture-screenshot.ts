import { Router, Request, Response, IRouter } from 'express';

import { AppRepository, type App } from '../../database/index.js';
import { GitUtils } from '../../utils/git.js';
import { WebsiteScraperDriver } from '../../tools/ai-lib-tools/drivers/website-scraper-driver.js';
import { log } from '../../logging/index.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';
import { getScreenshotStore } from './screenshot-store.js';
import { isBlockedFetchHostname } from '../../utils/public-fetch-url.js';

const router: IRouter = Router();
const appRepo = new AppRepository();

const MAX_DIMENSION = 1920;
const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 300;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5_000;

/** Track per-app screenshot capture state for deduplication. */
interface CaptureRecord {
  url: string;
  commitHash: string;
  requestedAt: number;
  inFlight: boolean;
  lastSucceeded: boolean;
}

const DEDUP_WINDOW_MS = 15 * 60 * 1_000; // 15 minutes

const recentCaptures = new Map<string, CaptureRecord>();

function parseDimension(value: unknown, fallback: number): number | null {
  if (value === undefined || value === null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > MAX_DIMENSION) {
    return null;
  }
  return n;
}

// Apply ownership validation to all routes
router.use(
  '/:id([a-z0-9]{10}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
  validateAppOwnership
);

/**
 * POST /apps/:id/capture-screenshot
 *
 * Accepts a URL and kicks off a background screenshot capture via the
 * web-scraper service.  Returns 202 Accepted immediately so the caller
 * is never blocked by Cloudflare / proxy timeouts.
 *
 * The stored screenshot is then served via GET /apps/:id/screenshot.
 *
 * @param {string} req.body.url - HTTPS URL to screenshot (required, must be https://)
 * @param {number} [req.body.width=400] - Viewport width in px (1–1920)
 * @param {number} [req.body.height=300] - Viewport height in px (1–1920)
 */
router.post('/:id/capture-screenshot', async (req: Request, res: Response) => {
  const id = req.params.id!;
  const contextLogger = log.forApp(id);
  let url: string | undefined;

  try {
    const { product } = (req as AuthenticatedRequest).agentContext ?? {};
    if (product !== 'PaaSNodeJS') {
      return res.status(403).json({ error: 'capture-screenshot is only available for PaaS' });
    }

    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    if (typeof req.body?.url === 'string') {
      url = req.body.url.trim() || undefined;
    }

    if (!url) {
      return res.status(400).json({ error: 'url is required' });
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (urlParseError) {
      contextLogger.warn('route.apps.capture-screenshot.invalid-url', {
        appId: id,
        url,
        error: urlParseError instanceof Error ? urlParseError.message : String(urlParseError),
      });
      return res.status(422).json({ error: 'url is not a valid URL' });
    }

    if (parsed.protocol !== 'https:') {
      contextLogger.warn('route.apps.capture-screenshot.invalid-protocol', { appId: id, url });
      return res.status(422).json({ error: 'url must use https protocol' });
    }

    if (isBlockedFetchHostname(parsed.hostname)) {
      contextLogger.warn('route.apps.capture-screenshot.blocked-host', { appId: id, url, hostname: parsed.hostname });
      return res.status(422).json({ error: 'URL hostname is not allowed' });
    }

    if (!app.path) {
      log.error(contextLogger, 'route.apps.capture-screenshot.no-app-path', new Error('App has no filesystem path'), { appId: id });
      return res.status(500).json({ error: 'App has no filesystem path configured' });
    }

    const { width: rawWidth, height: rawHeight } = req.body;
    const width = parseDimension(rawWidth, DEFAULT_WIDTH);
    const height = parseDimension(rawHeight, DEFAULT_HEIGHT);
    if (width === null || height === null) {
      return res.status(400).json({
        error: `width and height must be integers between 1 and ${MAX_DIMENSION}`,
      });
    }

    // Respond immediately — capture runs in the background
    res.status(202).json({ status: 'capturing' });

    // Resolve current commit hash for dedup (best-effort)
    let commitHash = '';
    try {
      commitHash = await new GitUtils().getCurrentCommit(app.path);
    } catch (commitHashError) {
      contextLogger.warn('route.apps.capture-screenshot.commit-hash-unavailable', {
        appId: id,
        reason: commitHashError instanceof Error ? commitHashError.message : String(commitHashError),
      });
    }

    // Dedup: skip if same URL + same commit within the cooldown window,
    // or if a capture is already in flight for this app.
    // The map is keyed by app ID (one entry per app), so when a new commit
    // appears the old record is replaced by the .set() below — no unbounded growth.
    const existing = recentCaptures.get(id);
    if (existing) {
      if (existing.inFlight) {
        contextLogger.info('route.apps.capture-screenshot.deduplicated', { appId: id, url, reason: 'in-flight' });
        return;
      }
      if (existing.url === url && existing.commitHash === commitHash && existing.lastSucceeded) {
        const age = Date.now() - existing.requestedAt;
        if (age < DEDUP_WINDOW_MS) {
          // Slide the window forward so rapid repeated requests stay deduped
          existing.requestedAt = Date.now();
          contextLogger.info('route.apps.capture-screenshot.deduplicated', { appId: id, url, reason: 'recent', ageMs: age });
          return;
        }
      }
    }

    // Fire-and-forget: capture + save to disk
    recentCaptures.set(id, { url, commitHash, requestedAt: Date.now(), inFlight: true, lastSucceeded: false });
    const captureUrl = url;
    captureAndSave({ id, app, url: captureUrl, width, height, contextLogger })
      .catch(err => log.error(contextLogger, 'route.apps.capture-screenshot.unhandled-error',
        err instanceof Error ? err : new Error(String(err)), { appId: id, url: captureUrl }))
      .finally(() => {
        const record = recentCaptures.get(id);
        if (record) record.inFlight = false;
      });
    return;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error(contextLogger, 'route.apps.capture-screenshot.unexpected-error', err, { appId: id, url });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to capture screenshot' });
    }
    return;
  }
});

/**
 * Background worker that captures a screenshot and saves it to disk.
 * All errors are logged internally — the caller should `.catch()` to
 * suppress unhandled-rejection warnings.
 */
async function captureAndSave({
  id,
  app,
  url,
  width,
  height,
  contextLogger,
}: {
  id: string;
  app: App;
  url: string;
  width: number;
  height: number;
  contextLogger: ReturnType<typeof log.forApp>;
}): Promise<void> {
  const scraper = new WebsiteScraperDriver();
  let result: Awaited<ReturnType<typeof scraper.fetchScreenshotBuffer>> | undefined;

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      result = await scraper.fetchScreenshotBuffer(url, {
        width: String(width),
        height: String(height),
      });
      break; // success — exit retry loop
    } catch (scraperError) {
      const err = scraperError instanceof Error ? scraperError : new Error(String(scraperError));
      if (attempt < RETRY_ATTEMPTS) {
        contextLogger.warn('route.apps.capture-screenshot.scraper-retry', {
          appId: id,
          url,
          attempt,
          error: err.message,
        });
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      log.error(contextLogger, 'route.apps.capture-screenshot.scraper-error', err, { appId: id, url, width, height, attempts: attempt });
      return;
    }
  }

  // After the retry loop `result` is always assigned (the last-attempt catch
  // returns early on exhaustion), but TypeScript cannot prove it — assert here.
  if (!result) return;

  if (result.buffer.length === 0) {
    log.error(contextLogger, 'route.apps.capture-screenshot.empty', new Error('Scraper returned empty buffer'), { appId: id, url });
    return;
  }

  const contentType = ((result.contentType ?? '').split(';')[0] ?? 'image/png').trim();
  if (contentType !== 'image/png') {
    log.error(contextLogger, 'route.apps.capture-screenshot.unexpected-type', new Error(`Expected image/png but got ${contentType}`), {
      appId: id,
      url,
      contentType,
    });
    return;
  }

  const store = getScreenshotStore(app);
  try {
    await store.write(id, result.buffer);
  } catch (writeError) {
    const err = writeError instanceof Error ? writeError : new Error(String(writeError));
    log.error(contextLogger, 'route.apps.capture-screenshot.write-error', err, {
      appId: id,
      url,
      code: (writeError as NodeJS.ErrnoException).code,
    });
    return;
  }

  const record = recentCaptures.get(id);
  if (record) record.lastSucceeded = true;

  contextLogger.info('route.apps.capture-screenshot.success', {
    appId: id,
    url,
    sizeBytes: result.buffer.length,
  });
}

export { router as captureScreenshotRouter, recentCaptures };
