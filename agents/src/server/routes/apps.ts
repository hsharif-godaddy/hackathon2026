import { Router, Request, Response } from 'express';
import { AppRepository } from '../../database/index.js';
import type { CreateAppRequest, UpdateAppRequest } from '../../database/index.js';
import { DirectoryListingTool } from '../../tools/directory-listing.js';
import { ReadFileTool } from '../../tools/read-file.js';
import { FileEditTool } from '../../tools/file-edit.js';

const router = Router();
const appRepo = new AppRepository();
const directoryTool = new DirectoryListingTool();
const readFileTool = new ReadFileTool();
const fileEditTool = new FileEditTool();

/**
 * GET /apps - List all apps
 */
router.get('/', (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;

    const apps = appRepo.findAll(limit, offset);
    const total = appRepo.count();
    const totalPages = Math.ceil(total / limit);

    return res.json({
      apps,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error('Error listing apps:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /apps/servers - Get running development servers
 */
router.get('/servers', (req: Request, res: Response) => {
  try {
    const runningServers = appRepo.getRunningServers();
    return res.json({ servers: runningServers });
  } catch (error) {
    console.error('Error getting running servers:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /apps/:id - Get a specific app
 */
router.get('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }
    const app = appRepo.findById(id);

    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    return res.json({ app });
  } catch (error) {
    console.error('Error getting app:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /apps - Create a new app
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const data: CreateAppRequest = req.body;

    // Validate required fields
    if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required and must be a non-empty string' });
    }

    // Trim whitespace
    data.name = data.name.trim();

    const app = await appRepo.create(data);
    return res.status(201).json({ app });
  } catch (error) {
    console.error('Error creating app:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /apps/:id - Update an app
 */
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }
    const data: UpdateAppRequest = req.body;

    // Validate name if provided
    if (data.name !== undefined) {
      if (typeof data.name !== 'string' || data.name.trim().length === 0) {
        return res.status(400).json({ error: 'Name must be a non-empty string' });
      }
      data.name = data.name.trim();
    }

    const app = appRepo.update(id, data);

    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    return res.json({ app });
  } catch (error) {
    console.error('Error updating app:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /apps/:id - Delete an app
 */
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }
    const deleted = appRepo.delete(id);

    if (!deleted) {
      return res.status(404).json({ error: 'App not found' });
    }

    return res.status(204).send();
  } catch (error) {
    console.error('Error deleting app:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /apps/:id/stop - Stop development server for an app
 */
router.post('/:id/stop', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }
    
    const stopped = appRepo.stopServer(id);
    
    if (!stopped) {
      return res.status(404).json({ error: 'App not found or server not running' });
    }

    return res.json({ success: true, message: `Server stopped for app ${id}` });
  } catch (error) {
    console.error('Error stopping server:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /apps/stop-all - Stop all running development servers
 */
router.post('/stop-all', (req: Request, res: Response) => {
  try {
    const stoppedCount = appRepo.stopAllServers();
    return res.json({ 
      success: true, 
      message: `Stopped ${stoppedCount} server${stoppedCount !== 1 ? 's' : ''}`,
      stoppedCount 
    });
  } catch (error) {
    console.error('Error stopping all servers:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /apps/:id/restart - Restart development server for an app
 */
router.post('/:id/restart', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }
    
    const restarted = await appRepo.restartServer(id);
    
    if (!restarted) {
      return res.status(404).json({ error: 'App not found or failed to restart' });
    }

    return res.json({ success: true, message: `Server restarted for app ${id}` });
  } catch (error) {
    console.error('Error restarting server:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /apps/cleanup-orphans - Force cleanup of orphaned processes
 */
router.post('/cleanup-orphans', async (req: Request, res: Response) => {
  try {
    const cleaned = await appRepo.forceCleanupOrphans();
    return res.json({ 
      success: true, 
      message: `Cleaned up ${cleaned} orphaned process${cleaned !== 1 ? 'es' : ''}`,
      cleanedCount: cleaned
    });
  } catch (error) {
    console.error('Error cleaning up orphans:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /apps/:id/files - List files in app directory
 */
router.get('/:id/files', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { path, maxDepth } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const result = await directoryTool.listDirectory(app.path, {
      path: path as string,
      maxDepth: maxDepth ? parseInt(maxDepth as string) : 3,
      showHidden: false
    });

    return res.json(result);
  } catch (error) {
    console.error('Error listing files:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /apps/:id/files/read - Read file content
 */
router.get('/:id/files/read', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { path: filePath } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }

    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const result = await readFileTool.readFile({ path: filePath as string }, app.path);
    
    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }

    return res.json(result);
  } catch (error) {
    console.error('Error reading file:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /apps/:id/files/write - Write file content
 */
router.post('/:id/files/write', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { path: filePath, content, mode } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    if (!filePath || content === undefined) {
      return res.status(400).json({ error: 'File path and content are required' });
    }

    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const result = await fileEditTool.editFile(app.path, {
      path: filePath,
      content: content,
      mode: mode || 'rewrite',
      createDirs: true
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.json(result);
  } catch (error) {
    console.error('Error writing file:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /apps/:id/files/edit - Edit file with partial changes
 */
router.post('/:id/files/edit', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { path: filePath, edits } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    if (!filePath || !edits || !Array.isArray(edits)) {
      return res.status(400).json({ error: 'File path and edits array are required' });
    }

    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const result = await fileEditTool.editFile(app.path, {
      path: filePath,
      mode: 'edit',
      edits: edits
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.json(result);
  } catch (error) {
    console.error('Error editing file:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as appsRouter };
