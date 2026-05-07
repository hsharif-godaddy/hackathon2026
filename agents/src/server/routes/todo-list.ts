import { Router, type IRouter, Request, Response, NextFunction } from 'express'
import { logger } from '../../logging/index.js'
import { getTodoListStore } from '../../planning/adapters/index.js';
import type { PlanningCreateItemInput } from '../../planning/interfaces/todo-list-store.js';
import { workspaceScopeFromAppId } from '../../memory/interfaces/scope.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';

const router: IRouter = Router()
const store = getTodoListStore();

/**
 * Custom validator that works with :appId parameter name
 * Temporarily maps appId to id for validateAppOwnership compatibility
 */
function validateAppIdParam(req: Request, res: Response, next: NextFunction): void {
  const originalAppId = req.params.appId;
  if (originalAppId) {
    req.params.id = originalAppId;
  }
  validateAppOwnership(req, res, () => {
    // Restore original param name
    if (originalAppId) {
      delete req.params.id;
    }
    next();
  });
}

/**
 * Extract error message from unknown error type
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * GET /agent/todo-lists/:appId - Get all todo lists for an app
 */
router.get('/todo-lists/:appId', validateAppIdParam, async (req, res) => {
  const { appId } = req.params

  try {
    const customerId = (req as AuthenticatedRequest).agentContext?.customerId;
    const lists = await store.getAllLists(workspaceScopeFromAppId(appId!, customerId))

    logger.info('todo-lists.get-all.success', {
      appId,
      listsFound: lists.length
    })

    return res.json({ lists })
  } catch (error) {
    logger.error('todo-lists.get-all.failure', {
      appId,
      error: getErrorMessage(error)
    })
    return res.status(500).json({ error: 'Failed to fetch todo lists' })
  }
})

/**
 * POST /agent/todo-lists/:appId - Create a todo list for an app
 *
 * Body: { name: string; description?: string; items?: PlanningCreateItemInput[] }
 */
router.post('/todo-lists/:appId', validateAppIdParam, async (req, res) => {
  const { appId } = req.params
  const { name, description, items }: { name: string; description?: string; items?: PlanningCreateItemInput[] }  = req.body

  // Basic validation
  if (!name) {
    return res.status(400).json({ error: 'name is required' })
  }
  if (items) {
    if(items.some(item => !item.title)) {
      return res.status(400).json({ error: 'items.title is required' })
    }
  }

  try {
    const customerId = (req as AuthenticatedRequest).agentContext?.customerId;
    const list = await store.createList(workspaceScopeFromAppId(appId!, customerId), name, description, items)

    logger.info('todo-lists.create-new.success', {
      appId,
      list
    })

    return res.json({ list })
  } catch (error) {
    logger.error('todo-lists.create-new.failure', {
      appId,
      error: getErrorMessage(error)
    })
    return res.status(500).json({ error: 'Failed to create todo list' })
  }
})

/**
 * GET /agent/todo-lists/:appId/current - Get the currently selected/active list
 *
 * Returns the most recently updated list for the app, or null if no lists exist.
 */
router.get('/todo-lists/:appId/current', validateAppIdParam, async (req, res) => {
  const { appId } = req.params

  try {
    const customerId = (req as AuthenticatedRequest).agentContext?.customerId;
    const lists = await store.getAllLists(workspaceScopeFromAppId(appId!, customerId))

    if (lists.length === 0) {
      logger.info('todo-lists.get-current.empty', { appId })
      return res.json({ list: null })
    }

    // Return the most recently updated list
    const currentList = lists[0]

    if (!currentList) {
      logger.warn('todo-lists.get-current.unexpected-empty', { appId })
      return res.json({ list: null })
    }

    logger.info('todo-lists.get-current.success', {
      appId,
      listId: currentList.id,
      listName: currentList.name
    })

    return res.json({ list: currentList })
  } catch (error) {
    logger.error('todo-lists.get-current.failure', {
      appId,
      error: getErrorMessage(error)
    })
    return res.status(500).json({ error: 'Failed to fetch current todo list' })
  }
})

/**
 * POST /agent/todo-lists/:appId/current - Set the current active list
 *
 * Body: { listId: string }
 *
 * This endpoint validates that the list exists and belongs to the app.
 * The "current" list is determined by the most recently updated list,
 * so we update the list's timestamp to make it current.
 */
router.post('/todo-lists/:appId/current', validateAppIdParam, async (req, res) => {
  const { appId } = req.params
  const { listId } = req.body

  if (!listId) {
    return res.status(400).json({ error: 'listId is required' })
  }

  try {
    const list = await store.getListById(listId)

    if (!list) {
      logger.warn('todo-lists.set-current.not-found', { appId, listId })
      return res.status(404).json({ error: 'Todo list not found' })
    }

    if (list.appId !== appId) {
      logger.warn('todo-lists.set-current.wrong-app', {
        appId,
        listId,
        listAppId: list.appId
      })
      return res.status(403).json({ error: 'Todo list does not belong to this app' })
    }

    await store.updateListTimestamp(listId)

    const updatedList = await store.getListById(listId)

    logger.info('todo-lists.set-current.success', {
      appId,
      listId,
      listName: list.name
    })

    return res.json({ list: updatedList })
  } catch (error) {
    logger.error('todo-lists.set-current.failure', {
      appId,
      listId,
      error: getErrorMessage(error)
    })
    return res.status(500).json({ error: 'Failed to set current todo list' })
  }
})

export default router;
