import { Router, type Response, type IRouter } from 'express'

import type { AuthenticatedRequest } from '../middleware/jwt-auth.js'
import { z } from 'zod'

import { AppRepository } from '../../database/repositories/AppRepository.js'
import { Logger } from '../../logging/index.js'
import { RebuildOrchestrationService } from '../../services/RebuildOrchestrationService.js'
import { REBUILD_SCOPE_ESTIMATES } from '../../services/rebuild/scope-estimates.js'
import { loadWorkflowState, loadSitemap, slugToTitle } from '../../tools/ai-lib-tools/rebuild-page-selector.js'
import type { RebuildScope, StylePreferences } from '../../types/rebuild.js'
import { validateAppOwnership } from '../middleware/app-ownership.js'
import { createForWorkspace } from '../../workspace/index.js'

const logger = Logger.create({ component: 'rebuild-routes' })
const appRepo = new AppRepository()

const stylePreferencesSchema = z.object({
  designDirection: z.enum(['keep-similar', 'modernize', 'simplify', 'bold']),
  colorPreference: z.enum(['keep-original', 'suggest-new', 'custom']).optional(),
  customColors: z
    .object({
      primary: z.string().optional(),
      secondary: z.string().optional(),
      accent: z.string().optional(),
    })
    .optional(),
  typographyStyle: z.enum(['keep-original', 'modern', 'classic', 'playful']).optional(),
  layoutApproach: z.enum(['responsive', 'mobile-first', 'desktop-first']).optional(),
  keepLogo: z.boolean().optional(),
  keepSourceImages: z.boolean().optional(),
})

const intakeBodySchema = z.object({
  scope: z.enum(['homepage_only', 'small', 'large']),
  stylePreferences: stylePreferencesSchema,
})

const router: IRouter = Router()

router.use(
  '/:id([a-z0-9]{10})',
  validateAppOwnership
)

async function serviceForApp(appId: string, req: AuthenticatedRequest): Promise<RebuildOrchestrationService | null> {
  const app = await appRepo.findById(appId)
  if (!app) return null
  return new RebuildOrchestrationService(app.path, {
    useAtlasCrawler: req.agentContext?.useAtlasCrawler === true,
  })
}

/**
 * GET /apps/:id/rebuild/scope-estimates
 *
 * Static scope tiers with time/token bands for the intake form.
 */
router.get('/:id/rebuild/scope-estimates', async (_req: AuthenticatedRequest, res: Response) => {
  return res.json({ estimates: REBUILD_SCOPE_ESTIMATES })
})

/**
 * GET /apps/:id/rebuild/status
 *
 * Current rebuild workflow state for intake polling.
 */
router.get('/:id/rebuild/status', async (req: AuthenticatedRequest, res: Response) => {
  const id = req.params.id as string

  try {
    const service = await serviceForApp(id, req)
    if (!service) {
      return res.status(404).json({ error: 'App not found' })
    }

    try {
      const state = await service.getStatus(id)
      return res.json({
        status: state.status,
        sourceUrl: state.sourceUrl,
        rebuildScope: state.rebuildScope,
        intakeCompleted: state.intakeCompleted ?? false,
        scrapingProgress: state.scrapingProgress,
        hasStylePreferences: !!state.stylePreferences,
      })
    } catch {
      return res.status(404).json({ error: 'No rebuild workflow found' })
    }
  } catch (error) {
    logger.error('rebuild.status.failed', { appId: id, error })
    return res.status(500).json({ error: 'Failed to load rebuild status' })
  }
})

/**
 * POST /apps/:id/rebuild/intake
 *
 * Submit scope + design direction and start scraping.
 */
router.post('/:id/rebuild/intake', async (req: AuthenticatedRequest, res: Response) => {
  const id = req.params.id as string
  const parsed = intakeBodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid intake payload', details: parsed.error.flatten() })
  }

  try {
    const service = await serviceForApp(id, req)
    if (!service) {
      return res.status(404).json({ error: 'App not found' })
    }

    const prefs: StylePreferences = {
      designDirection: parsed.data.stylePreferences.designDirection,
      colorPreference: parsed.data.stylePreferences.colorPreference ?? 'keep-original',
      typographyStyle: parsed.data.stylePreferences.typographyStyle ?? 'keep-original',
      layoutApproach: parsed.data.stylePreferences.layoutApproach ?? 'responsive',
      keepLogo: parsed.data.stylePreferences.keepLogo ?? true,
      keepSourceImages: parsed.data.stylePreferences.keepSourceImages ?? true,
      ...(parsed.data.stylePreferences.customColors && {
        customColors: parsed.data.stylePreferences.customColors,
      }),
    }

    const state = await service.submitIntake(id, {
      scope: parsed.data.scope as RebuildScope,
      stylePreferences: prefs,
    })

    return res.json({
      status: state.status,
      rebuildScope: state.rebuildScope,
      intakeCompleted: state.intakeCompleted,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('Workflow state not found')) {
      return res.status(404).json({ error: message })
    }
    if (message.includes('Cannot submit intake')) {
      return res.status(409).json({ error: message })
    }
    logger.error('rebuild.intake.failed', { appId: id, error })
    return res.status(500).json({ error: 'Failed to submit rebuild intake' })
  }
})

/**
 * GET /apps/:id/rebuild/pages
 *
 * Returns available rebuild pages for the given app.
 */
router.get('/:id/rebuild/pages', async (req: AuthenticatedRequest, res: Response) => {
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
