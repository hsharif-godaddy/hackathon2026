import { Router, Request, Response } from 'express';
import { AppRepository } from '../../database/index.js';
import type { CreateAppRequest, UpdateAppRequest } from '../../database/index.js';

const router = Router();
const appRepo = new AppRepository();

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

export { router as appsRouter };
