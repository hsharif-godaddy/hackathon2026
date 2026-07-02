import { Router, type IRouter, type Request, type Response } from 'express'
import { logger } from '../../logging/index.js'
import { readWorkflowState } from '../../workflow/workflow-store.js'
import { validateAppOwnership } from '../middleware/app-ownership.js'

const router: IRouter = Router()

router.use('/:id([a-z0-9]{10})', validateAppOwnership)

router.get('/:id([a-z0-9]{10})/workflow', async (req: Request, res: Response) => {
  const appId: string = req.params.id!

  try {
    const state = await readWorkflowState(appId)

    if (!state) {
      return res.status(404).json({ error: 'No workflow found' })
    }

    return res.json(state)
  } catch (error: unknown) {
    const message: string = error instanceof Error ? error.message : String(error)
    logger.error('workflow-state.get.failure', { appId, error: message })
    return res.status(500).json({ error: 'Failed to read workflow state' })
  }
})

export default router
