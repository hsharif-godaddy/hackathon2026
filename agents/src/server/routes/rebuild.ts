import { Router, type Request, type Response, type IRouter } from 'express'

import { AppRepository } from '../../database/index.js'
import { Logger } from '../../logging/index.js'
import { validateAppOwnership } from '../middleware/app-ownership.js'
import { loadWorkflowState, loadSitemap, slugToTitle } from '../../tools/ai-lib-tools/rebuild-page-selector.js'

const logger = Logger.create({ component: 'rebuild-routes' })
const appRepo = new AppRepository()
const router: IRouter = Router()

router.use(
  '/:id([a-z0-9]{10})',
  validateAppOwnership
)

/**
 * GET /apps/:id/rebuild/pages
 *
 * Returns available rebuild pages for the given app.
 */
router.get('/:id/rebuild/pages', async (req: Request, res: Response) => {
  const id = req.params.id as string

  try {
    const app = appRepo.findById(id)
    if (!app) {
      return res.status(404).json({ error: 'App not found' })
    }

    const workflowState = await loadWorkflowState(app.path)
    if (!workflowState) {
      return res.status(404).json({ error: 'No rebuild workflow found' })
    }

    const sitemap = await loadSitemap(app.path)
    if (!sitemap) {
      return res.status(404).json({ error: 'No sitemap found' })
    }

    const availablePages = sitemap.pages
      .filter(p => p.scraped)
      .map(p => ({
        slug: p.slug,
        title: slugToTitle(p.slug),
        url: p.url,
        isBuilt: workflowState.pagesBuilt.includes(p.slug)
      }))

    return res.json({
      sourceUrl: workflowState.sourceUrl,
      availablePages,
      totalPages: availablePages.length,
      builtPages: workflowState.pagesBuilt.length
    })
  } catch (error) {
    logger.error('rebuild.pages.failed', { appId: id, error })
    return res.status(500).json({ error: 'Failed to load rebuild pages' })
  }
})

export default router
