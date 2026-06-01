import { Router, Request, Response } from 'express';
import { log } from '../../logging/index.js';
import { requirePermission } from '../middleware/index.js';
import { createForWorkspace } from '../../workspace/index.js';
import { DevSupervisorError } from '../../services/DevSupervisorClient.js';

const router: Router = Router();

interface LiveStatus {
  hasGoneLive: boolean;
  wentLiveAt: string | null;
}

const DEFAULT_STATUS: LiveStatus = { hasGoneLive: false, wentLiveAt: null };
const LIVE_JSON_PATH = '.airo/live.json';

router.get('/apps/:id/go-live-status', async (req: Request, res: Response) => {
  const { id: appId } = req.params;
  if (!appId) {
    return res.status(400).json({ error: 'App ID is required' });
  }

  const contextLogger = log.forApp(appId);
  const workspace = createForWorkspace(appId, 'preview');
  if (!workspace) {
    return res.status(404).json({ error: 'App not found' });
  }

  try {
    const result = await workspace.files.view({ path: LIVE_JSON_PATH });
    const status: LiveStatus = JSON.parse(result.content);

    contextLogger.info('go-live.status.read', {
      appId,
      hasGoneLive: status.hasGoneLive,
      wentLiveAt: status.wentLiveAt,
    });

    return res.json(status);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (error instanceof DevSupervisorError && error.code === 'not_found') {
      contextLogger.debug('go-live.status.not-found', { appId });
      return res.json(DEFAULT_STATUS);
    }

    if (error instanceof SyntaxError) {
      contextLogger.warn('go-live.status.parse-error', { appId, error: message });
      return res.json(DEFAULT_STATUS);
    }

    contextLogger.error('go-live.status.read.failure', { appId, error: message });
    return res.status(500).json({
      error: 'Failed to read go-live status',
      details: message,
    });
  }
});

router.post('/apps/:id/mark-gone-live', requirePermission('canPublish'), async (req: Request, res: Response) => {
  const { id: appId } = req.params;
  if (!appId) {
    return res.status(400).json({ error: 'App ID is required' });
  }

  const contextLogger = log.forApp(appId);
  const workspace = createForWorkspace(appId, 'preview');
  if (!workspace) {
    return res.status(404).json({ error: 'App not found' });
  }

  try {
    const timestamp = new Date().toISOString();
    const liveStatus: LiveStatus = { hasGoneLive: true, wentLiveAt: timestamp };

    await workspace.files.write({
      path: LIVE_JSON_PATH,
      content: JSON.stringify(liveStatus, null, 2),
    });

    contextLogger.info('go-live.mark.success', { appId, wentLiveAt: timestamp });
    return res.json({ success: true, ...liveStatus });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    contextLogger.error('go-live.mark.failure', { appId, error: message });
    return res.status(500).json({
      error: 'Failed to mark app as gone live',
      details: message,
    });
  }
});

export default router;
