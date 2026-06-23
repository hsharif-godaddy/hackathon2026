import { createTool, type Tool, type HandoffStateManager } from '@airo/ai-lib'
import {
  type BringOverStylePreferences,
  bringOverToStylePreferences,
  isRebuildBringOverChoice,
} from '@airo/shared'
import { z } from 'zod'

import { AppRepository } from '../../database/repositories/AppRepository.js'
import { Logger } from '../../logging/index.js'
import { RebuildOrchestrationService } from '../../services/RebuildOrchestrationService.js'
import {
  resolveDesignDirection,
  resolveDesignIntent,
  stylePreferencesForDirection,
} from '../../services/rebuild/intake-defaults.js'
import {
  asRebuildError,
  type RebuildWorkflowState,
  WEBSITE_REBUILD_IMPORT_FAILED_USER_MESSAGE
} from '../../types/rebuild.js'
import { waitForIntake } from './wait-for-intake.js'
import { waitForScrapeCompletion } from './wait-for-scrape-completion.js'

const logger = Logger.create({ component: 'website-rebuild-tool' })
const appRepo = new AppRepository()

/**
 * Poll for rebuild completion with timeout
 */
async function waitForCompletion(
  service: RebuildOrchestrationService,
  appId: string,
  maxWaitMs: number = 300000
): Promise<RebuildWorkflowState> {
  return waitForScrapeCompletion(service, appId, maxWaitMs)
}

async function ensureStylePreferencesReady(
  service: RebuildOrchestrationService,
  appId: string,
  completedState: RebuildWorkflowState,
  designDirection?: unknown,
  toolDirection?: unknown,
  clientIntent?: unknown,
  toolIntent?: unknown,
  bringOver?: BringOverStylePreferences,
): Promise<void> {
  if (completedState.stylePreferences) {
    if (completedState.status === 'style_questions') {
      await service.submitStylePreferences(appId, completedState.stylePreferences)
    }
    return
  }
  const directionPrefs = stylePreferencesForDirection(designDirection, toolDirection, clientIntent, toolIntent)
  await service.submitStylePreferences(
    appId,
    bringOver ? { ...directionPrefs, ...bringOver } : directionPrefs,
  )
}

export const websiteRebuildAITool: Tool = createTool(
  `Scrape and analyze a website for rebuilding.

This tool starts the website rebuild process:
1. Scrapes the source website (homepage and about page if available)
2. Downloads and catalogs images and assets
3. Analyzes the site structure, content, colors, and typography
4. Generates a detailed prompt for building the homepage

**WHEN TO USE:**
- User says "rebuild my site" or "rebuild website" with a URL
- User wants to recreate their existing website
- User provides a URL and mentions rebuilding, recreating, or redesigning

**DESIGN DIRECTION (pass designDirection when user intent is clear):**
- keep-similar — faithful clone; same look, copy layout, keep as-is, mirror existing site
- modernize — updated look; less dated, current/fresh design, 2026-style, reimagine, redesign
- simplify — cleaner, simpler, less cluttered layout
- bold — striking, bold, dramatic visual style
- Omit designDirection only when the user gives no design signal (defaults to modernize).
- Homepage modal / intake form choices override designDirection when the customer already picked one.

**DESIGN INTENT (pass designIntent whenever the user describes what they want in their own words):**
- The four directions above can't capture nuance like "ignore the existing structure" or "reimagine from first principles." When the user gives any free-text design instruction, copy it into designIntent close to verbatim — their words, not a summary.
- This is additive to designDirection: pass both when the user gives a free-text instruction (the instruction also implies a direction). Omit designIntent only when the user gives no free-text design description (e.g. a bare "rebuild my site").

**WORKFLOW:**
1. Detect rebuild intent with URL in user message
2. Infer designDirection from user intent (including paraphrases and non-English phrasing)
3. Capture the user's free-text design instruction into designIntent (close to verbatim) when they give one
4. Call this tool with url, designDirection, and designIntent when applicable
5. Tool shows progress widget while scraping
6. Tool automatically generates homepage build prompt and passes it to the develop agent
`,
  z.object({
    url: z.url().describe('The URL of the website to rebuild'),
    designDirection: z
      .enum(['keep-similar', 'modernize', 'simplify', 'bold'])
      .optional()
      .describe(
        'Design direction inferred from user intent. keep-similar = faithful clone; modernize = updated look; simplify = cleaner; bold = striking. Omit when user gives no design signal.',
      ),
    designIntent: z
      .string()
      .optional()
      .describe(
        "The user's free-text design instruction, copied close to verbatim (their words, not a summary). Carries nuance the four directions can't — e.g. \"ignore the current layout and reimagine from scratch.\" Omit when the user gives no free-text design description.",
      ),
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string
    const socketId = (context as any)?.socketId as string | undefined
    const stateManager = context?.metadata?.stateManager as HandoffStateManager | undefined

    if (!appId) {
      throw new Error('App ID is required for website rebuild')
    }

    if (context?.metadata && typeof context.metadata === 'object') {
      (context.metadata as Record<string, unknown>).isRebuildFlow = true
    }

    const app = await appRepo.findById(appId)
    if (!app) {
      throw new Error(`App not found: ${appId}`)
    }

    const rebuildIntakeFormEnabled =
      context?.metadata?.rebuildIntakeFormEnabled === true && !app.initialBuildComplete

    // Homepage modal choice, threaded from the client message context. Agent tool arg
    // supplies design direction when users type free-text without the modal.
    const rebuildDesignDirection = context?.metadata?.rebuildDesignDirection
    const resolvedDesignDirection = resolveDesignDirection(
      rebuildDesignDirection,
      input.designDirection,
    )
    // Free-text design intent. rebuildDesignIntent is the future intake-form
    // source (mirrors rebuildDesignDirection, unset today); the agent tool arg is
    // the live source for typed/NL rebuilds. Client source wins (resolveDesignIntent).
    const rebuildDesignIntent = context?.metadata?.rebuildDesignIntent

    // Full bring-over choice from the homepage modal (four toggles). Validated here
    // because it arrives via untrusted message metadata.
    const bringOverRaw = context?.metadata?.rebuildBringOverChoice
    const bringOver = isRebuildBringOverChoice(bringOverRaw)
      ? bringOverToStylePreferences(bringOverRaw)
      : undefined

    logger.info('websiteRebuild.start', {
      appId,
      url: input.url,
      hasStateManager: !!stateManager,
      hasSocketId: !!socketId,
      rebuildIntakeFormEnabled,
      rebuildDesignDirection: rebuildDesignDirection ?? null,
      toolDesignDirection: input.designDirection ?? null,
      resolvedDesignDirection,
      hasDesignIntent: !!(rebuildDesignIntent ?? input.designIntent),
      initialBuildComplete: !!app.initialBuildComplete,
      hasBringOverChoice: !!bringOver,
    })

    const useAtlasCrawler = context?.metadata?.useAtlasCrawler === true
    const crawledImagesEnabled = context?.metadata?.rebuildSourceImagesEnabled === true
    const service = new RebuildOrchestrationService(app.path, { useAtlasCrawler, crawledImagesEnabled })

    const initialState = rebuildIntakeFormEnabled
      ? await service.beginRebuild(appId, input.url)
      : await service.startRebuild(appId, input.url)

    let intakeTimedOut = false

    try {
      if (rebuildIntakeFormEnabled) {
        const intakeResult = await waitForIntake(service, appId, {
          designDirection: resolvedDesignDirection,
          designIntent: resolveDesignIntent(rebuildDesignIntent, input.designIntent),
        })
        intakeTimedOut = intakeResult.intakeTimedOut
      }

      const completedState = await waitForCompletion(service, appId)

      logger.info('websiteRebuild.scraping-complete', {
        appId,
        pagesScraped: completedState.scrapingProgress.completed,
        rebuildScope: completedState.rebuildScope,
      })

      await ensureStylePreferencesReady(
        service,
        appId,
        completedState,
        rebuildDesignDirection,
        input.designDirection,
        rebuildDesignIntent,
        input.designIntent,
        bringOver,
      )

      const { slugs, homepagePrompt } = await service.buildUpfrontPagePrompts(appId)
      const upfrontBuildSlugs = slugs.slice(1)

      const assetManifest = await service.getAssetManifest()

      logger.info('websiteRebuild.prompt-generated', {
        appId,
        promptLength: homepagePrompt.length,
        assetsFound: assetManifest?.totalAssets || 0,
        upfrontBuildCount: slugs.length,
        additionalPageSlugs: upfrontBuildSlugs,
      })

      if (stateManager && socketId) {
        logger.info('websiteRebuild.triggering-handoff', {
          appId,
          socketId,
          promptLength: homepagePrompt.length
        })

        const handoffSuccess = await stateManager.switchAgent(socketId, 'develop', homepagePrompt)

        logger.info('websiteRebuild.handoff-result', {
          appId,
          socketId,
          handoffSuccess
        })

        if (!handoffSuccess) {
          logger.warn('websiteRebuild.handoff-failed', { appId, socketId })
        }
      } else {
        logger.warn('websiteRebuild.no-handoff-context', {
          appId,
          hasStateManager: !!stateManager,
          hasSocketId: !!socketId
        })
      }

      return {
        success: true,
        message: slugs.length > 1
          ? `Website analyzed successfully. Handing off to developer to build ${slugs.length} pages.`
          : `Website analyzed successfully. Handing off to developer to build your homepage.`,
        sourceUrl: input.url,
        pagesFound: completedState.scrapingProgress.total,
        pagesScraped: completedState.scrapingProgress.completed,
        assetsFound: assetManifest?.totalAssets || 0,
        assetsByType: assetManifest?.byType || { image: 0, font: 0, icon: 0, other: 0 },
        assets: assetManifest?.assets?.slice(0, 50).map(a => ({
          url: a.url,
          type: a.type,
          localPath: a.localPath,
          description: a.description,
          dimensions: a.dimensions
        })) || [],
        homepagePrompt,
        upfrontPlanSlugs: slugs,
        upfrontBuildSlugs,
        upfrontBuildCount: slugs.length,
        handoffTriggered: !!(stateManager && socketId),
        intakeTimedOut,
      }
    } catch (error) {
      const rebuildError = asRebuildError(error)
      const userMessage =
        rebuildError.userMessage ||
        (rebuildError.code === 'import_failed'
          ? WEBSITE_REBUILD_IMPORT_FAILED_USER_MESSAGE
          : 'Something went wrong. Please try again.')

      logger.error('websiteRebuild.error', {
        appId,
        url: input.url,
        error: rebuildError.message,
        errorCode: rebuildError.code
      })

      return {
        success: false,
        error: rebuildError.message,
        errorCode: rebuildError.code,
        isUserFacingError: rebuildError.isUserFacingError,
        userMessage,
        sourceUrl: input.url,
        status: 'error',
        pagesFound: initialState.scrapingProgress.total,
        pagesScraped: initialState.scrapingProgress.completed,
        message: userMessage
      }
    }
  }
)
