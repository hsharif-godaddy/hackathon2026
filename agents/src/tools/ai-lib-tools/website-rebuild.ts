import { createTool, type Tool, type HandoffStateManager } from '@airo/ai-lib'
import { z } from 'zod'

import { AppRepository } from '../../database/repositories/AppRepository.js'
import { Logger } from '../../logging/index.js'
import { RebuildOrchestrationService } from '../../services/RebuildOrchestrationService.js'
import {
  resolveDesignDirection,
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
  userMessage?: unknown,
): Promise<void> {
  if (completedState.stylePreferences) {
    if (completedState.status === 'style_questions') {
      await service.submitStylePreferences(appId, completedState.stylePreferences)
    }
    return
  }
  // No intake (flag off) — seed defaults from modal choice, prompt keywords, or modernize default.
  await service.submitStylePreferences(appId, stylePreferencesForDirection(designDirection, userMessage))
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

**WORKFLOW:**
1. Detect "rebuild" intent with URL in user message
2. Call this tool with the URL
3. Tool shows progress widget while scraping
4. Tool automatically generates homepage build prompt and pases it to the develop agent
`,
  z.object({
    url: z.url().describe('The URL of the website to rebuild')
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string
    const socketId = (context as any)?.socketId as string | undefined
    const stateManager = context?.metadata?.stateManager as HandoffStateManager | undefined

    if (!appId) {
      throw new Error('App ID is required for website rebuild')
    }

    const app = await appRepo.findById(appId)
    if (!app) {
      throw new Error(`App not found: ${appId}`)
    }

    const rebuildIntakeFormEnabled =
      context?.metadata?.rebuildIntakeFormEnabled === true && !app.initialBuildComplete

    // Homepage modal choice, threaded from the client message context. Prompt keywords
    // fill the gap when users type free-text (e.g. "rebuild and modernize") without the modal.
    const rebuildDesignDirection = context?.metadata?.rebuildDesignDirection
    const userMessage = context?.metadata?._userMessage
    const resolvedDesignDirection = resolveDesignDirection(rebuildDesignDirection, userMessage)

    logger.info('websiteRebuild.start', {
      appId,
      url: input.url,
      hasStateManager: !!stateManager,
      hasSocketId: !!socketId,
      rebuildIntakeFormEnabled,
      rebuildDesignDirection: rebuildDesignDirection ?? null,
      resolvedDesignDirection,
      initialBuildComplete: !!app.initialBuildComplete,
    })

    const useAtlasCrawler = context?.metadata?.useAtlasCrawler === true
    const service = new RebuildOrchestrationService(app.path, { useAtlasCrawler })

    const initialState = rebuildIntakeFormEnabled
      ? await service.beginRebuild(appId, input.url)
      : await service.startRebuild(appId, input.url)

    let intakeTimedOut = false

    try {
      if (rebuildIntakeFormEnabled) {
        const intakeResult = await waitForIntake(service, appId, { designDirection: resolvedDesignDirection })
        intakeTimedOut = intakeResult.intakeTimedOut
      }

      const completedState = await waitForCompletion(service, appId)

      logger.info('websiteRebuild.scraping-complete', {
        appId,
        pagesScraped: completedState.scrapingProgress.completed,
        rebuildScope: completedState.rebuildScope,
      })

      await ensureStylePreferencesReady(service, appId, completedState, rebuildDesignDirection, userMessage)

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
