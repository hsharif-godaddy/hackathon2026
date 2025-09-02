import { Router, Request, Response } from 'express';
import { AppRepository } from '../../database/repositories/AppRepository.js';

const router: any = Router();
const appRepo = new AppRepository();

/**
 * GET /apps/:id/container/status - Get Docker container status for an app
 */
router.get('/:id/container/status', async (req: Request, res: Response) => {
  try {
    const appId = req.params.id;
    
    if (!appId) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    // All apps now use Docker containers

    const containerStatus = await appRepo.getAppStatus(appId);
    
    // Always return a status, even if no container exists
    if (!containerStatus) {
      return res.json({ 
        containerStatus: { 
          status: 'not_found', 
          message: 'No container record found for this app' 
        } 
      });
    }

    return res.json({ containerStatus });
  } catch (error: any) {
    console.error('Error getting container status:', error);
    
    if (error.message?.includes('template')) {
      return res.status(400).json({ error: error.message });
    }
    
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /apps/:id/container/logs - Get Docker container logs for an app
 */
router.get('/:id/container/logs', async (req: Request, res: Response) => {
  try {
    const appId = req.params.id;
    // const lines = parseInt(req.query.lines as string) || 100;
    
    if (!appId) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    // All apps now use Docker containers

    const logs = await appRepo.getAppLogs(appId);
    
    return res.json({ logs });
  } catch (error: any) {
    console.error('Error getting container logs:', error);
    
    if (error.message?.includes('template')) {
      return res.status(400).json({ error: error.message });
    }
    
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * POST /apps/:id/container/restart - Restart Docker container for an app
 */
router.post('/:id/container/restart', async (req: Request, res: Response) => {
  try {
    const appId = req.params.id;
    
    if (!appId) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    // All apps now use Docker containers

    const restarted = await appRepo.restartServer(appId);
    
    if (!restarted) {
      return res.status(404).json({ error: 'Failed to restart container - container may not exist' });
    }

    return res.json({ 
      message: 'Container restarted successfully',
      appId,
      restarted: true
    });
  } catch (error: any) {
    console.error('Error restarting container:', error);
    
    if (error.message?.includes('template')) {
      return res.status(400).json({ error: error.message });
    }
    
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /apps/:id/container/stop - Stop Docker container for an app
 */
router.post('/:id/container/stop', async (req: Request, res: Response) => {
  try {
    const appId = req.params.id;
    
    if (!appId) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    // All apps now use Docker containers

    const stopped = await appRepo.stopServer(appId);
    
    if (!stopped) {
      return res.status(404).json({ error: 'Failed to stop container - container may not exist' });
    }

    return res.json({ 
      message: 'Container stopped successfully',
      appId,
      stopped: true
    });
  } catch (error: any) {
    console.error('Error stopping container:', error);
    
    if (error.message?.includes('template')) {
      return res.status(400).json({ error: error.message });
    }
    
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /apps/:id/container/rebuild - Rebuild Docker container from scratch using local files
 */
router.post('/:id/container/rebuild', async (req: Request, res: Response) => {
  try {
    const appId = req.params.id;
    
    if (!appId) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    console.log(`🔄 Rebuilding container for app ${appId} from local files...`);

    // All apps now use Docker containers
    const rebuilt = await appRepo.rebuildAppContainer(appId);
    
    if (!rebuilt) {
      return res.status(500).json({ error: 'Failed to rebuild container - check server logs for details' });
    }

    return res.json({ 
      message: 'Container rebuilt successfully from local files',
      appId,
      rebuilt: true
    });
  } catch (error: any) {
    console.error('Error rebuilding container:', error);
    
    // Handle specific Docker/filesystem errors
    if (error.message?.includes('App directory not found')) {
      return res.status(404).json({ error: 'App directory not found on server' });
    }
    
    if (error.message?.includes('Dockerfile.dev not found')) {
      return res.status(400).json({ error: 'Dockerfile.dev missing from app directory' });
    }
    
    return res.status(500).json({ 
      error: 'Failed to rebuild container', 
      details: error.message || 'Internal server error' 
    });
  }
});

export { router as dockerAppsRouter };
