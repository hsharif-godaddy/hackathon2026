import { Router, type Request, type Response, type IRouter } from 'express'

import { Logger } from '../../logging/index.js'
import { validateAppOwnership } from '../middleware/app-ownership.js'
import { loadWorkflowState, loadSitemap, slugToTitle } from '../../tools/ai-lib-tools/rebuild-page-selector.js'
import { createForWorkspace } from '../../workspace/index.js'

const logger = Logger.create({ component: 'rebuild-routes' })
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
    const workspace = createForWorkspace(id, 'preview')
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not available' })
    }

    const [workflowState, sitemap] = await Promise.all([
      loadWorkflowState(workspace.files),
      loadSitemap(workspace.files)
    ])
    if (!workflowState) {
      return res.status(404).json({ error: 'No rebuild workflow found' })
    }
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
