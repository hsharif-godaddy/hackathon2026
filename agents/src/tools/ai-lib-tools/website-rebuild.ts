import { createTool, type Tool, type HandoffStateManager } from '@airo/ai-lib'
import { z } from 'zod'

import { AppRepository } from '../../database/repositories/AppRepository.js'
import { Logger } from '../../logging/index.js'
import { RebuildOrchestrationService } from '../../services/RebuildOrchestrationService.js'
import {
  asRebuildError,
  type RebuildWorkflowState,
  type StylePreferences,
  WEBSITE_REBUILD_IMPORT_FAILED_USER_MESSAGE
} from '../../types/rebuild.js'

const logger = Logger.create({ component: 'website-rebuild-tool' })
const appRepo = new AppRepository()

/**
 * Default style preferences - all set to "Let Airo Decide"
 */
const DEFAULT_STYLE_PREFERENCES: StylePreferences = {
  designDirection: 'keep-similar',
  colorPreference: 'keep-original',
  typographyStyle: 'keep-original',
  layoutApproach: 'responsive'
}

/**
 * Poll for rebuild completion with timeout
 */
async function waitForCompletion(
  service: RebuildOrchestrationService,
  appId: string,
  maxWaitMs: number = 300000
): Promise<RebuildWorkflowState> {
  const startTime = Date.now()
  let pollIteration = 0

  while (Date.now() - startTime < maxWaitMs) {
    const state = await service.getStatus(appId)

    if (state.status === 'style_questions' || state.status === 'complete') {
      return state
    }

    if (state.status === 'error') {
      throw asRebuildError({
        message: state.error || 'Rebuild failed',
        code: state.errorCode,
        userMessage: state.userMessage
      })
    }

    const pollMs = pollIteration < 18 ? 400 : 1500
    pollIteration++
    await new Promise(resolve => setTimeout(resolve, pollMs))
  }

  throw new Error('Rebuild timed out waiting for completion')
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

    logger.info('websiteRebuild.start', {
      appId,
      url: input.url,
      hasStateManager: !!stateManager,
      hasSocketId: !!socketId
    })

    const app = await appRepo.findById(appId)
    if (!app) {
      throw new Error(`App not found: ${appId}`)
    }

    const service = new RebuildOrchestrationService(app.path)

    // Start the rebuild process
    const initialState = await service.startRebuild(appId, input.url)

    try {
      // Wait for scraping to complete
      const completedState = await waitForCompletion(service, appId)

      logger.info('websiteRebuild.scraping-complete', {
        appId,
        pagesScraped: completedState.scrapingProgress.completed
      })

      // Apply default style preferences (Let Airo Decide for everything)
      await service.submitStylePreferences(appId, DEFAULT_STYLE_PREFERENCES)

      // Generate homepage prompt
      const homepagePrompt = await service.buildPage(appId, 'homepage')

      // Get asset manifest for display
      const assetManifest = await service.getAssetManifest()

      logger.info('websiteRebuild.prompt-generated', {
        appId,
        promptLength: homepagePrompt.length,
        assetsFound: assetManifest?.totalAssets || 0
      })

      // Trigger handoff to develop agent with the generated prompt
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

      // Return success with the generated prompt for tool renderer display
      return {
        success: true,
        message: `Website analyzed successfully. Handing off to developer to build your homepage.`,
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
        handoffTriggered: !!(stateManager && socketId)
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
