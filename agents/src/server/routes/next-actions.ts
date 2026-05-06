import { Router, type Request, type Response, type IRouter } from 'express'

import { Logger } from '../../logging/index.js'
import { validateAppOwnership } from '../middleware/app-ownership.js'
import { NextActionsService } from '../../services/next-actions.js'

const logger = Logger.create({ component: 'next-actions-routes' })
const router: IRouter = Router()
const nextActionsService = new NextActionsService()

router.use(
  '/:id([a-z0-9]{10})',
  validateAppOwnership
)

/**
 * POST /apps/:id/next-actions
 *
 * Generate contextual next-action suggestions using a lightweight LLM call.
 */
router.post('/:id/next-actions', async (req: Request, res: Response) => {
  const id = req.params.id as string

  try {
    const result = await nextActionsService.generateNextActions(id)
    return res.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith('App not found')) {
      return res.status(404).json({ error: message })
    }
    logger.error('next-actions.route.failed', { appId: id, error })
    return res.status(500).json({ error: 'Failed to generate next actions' })
  }
})

export default router
