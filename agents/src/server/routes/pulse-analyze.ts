import { Router, type Request, type Response, type IRouter } from 'express'
import { generateTextWithTracking } from '@airo/ai-lib'
import { createForWorkspace } from '../../workspace/index.js'
import { WebsiteScraperDriver } from '../../tools/ai-lib-tools/drivers/website-scraper-driver.js'
import { getAgentModelWithName } from '../../utils/model-selection.js'
import { logger } from '../../logging/index.js'
import { parsePulseResponse } from './pulse-parse.js'

const router: IRouter = Router()

const CONFIDENCE_THRESHOLD = 0.5

const CLASSIFICATION_SYSTEM = `You are analyzing a small business website to find the single biggest reason visitors leave without contacting the owner.

Classify into EXACTLY ONE of these three types:

cta_buried: The primary call-to-action (Contact Us, Shop Now, Book Now, Get a Quote) is buried too far down the page. Visitors never scroll far enough to see it.

contact_hidden: The contact form or contact information has too much friction — too many required fields, hard to find, or frustrating to use.

no_social_proof: There are no testimonials, reviews, or star ratings anywhere on the site. Visitors don't trust the business because there's no evidence others have used it.

Return ONLY this JSON object (no markdown, no code blocks, no explanation):
{
  "problemType": "cta_buried" | "contact_hidden" | "no_social_proof",
  "headline": "plain language summary using visitor numbers e.g. '31 people visited, only 1 contacted you'",
  "description": "2-3 sentence plain English explanation of the problem for a non-technical business owner",
  "suggestedFix": "One sentence plain English description of what to change",
  "confidence": 0.0
}

confidence must be between 0.0 and 1.0. Use 0.8+ when you clearly see the problem in the code. Use 0.5-0.79 when inferring from analytics patterns. Use below 0.5 only if the site looks healthy.`

function buildAnalysisPrompt(
  analytics: Record<string, unknown>,
  fileContext: string,
  filesRead: string[],
): string {
  const analyticsText = JSON.stringify(analytics, null, 2)
  const filesSection = filesRead.length > 0
    ? `Files analyzed:\n${fileContext}`
    : 'No source files were available for analysis — base classification on analytics patterns only.'

  return `Visitor analytics for this week:
${analyticsText}

${filesSection}

Based on the analytics and any available source code, identify the single biggest conversion problem and return the JSON classification.`
}


function hashAppId(appId: string): number {
  let hash = 0
  for (let i = 0; i < appId.length; i++) {
    hash = ((hash << 5) - hash + appId.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

function getMockAnalytics(appId: string): Record<string, unknown> {
  const seed = hashAppId(appId)
  return {
    totalHostPageViews: 28 + (seed % 20),
    totalHostUniqueVisitors: 24 + (seed % 15),
    bounceRate: '72%',
    avgSessionDuration: '0m 48s',
    clicksByElementData: [
      { element: 'Contact Button', clicks: 3 },
      { element: 'Hero Image', clicks: 12 },
      { element: 'Learn More', clicks: 8 },
    ],
    topCTALabelsData: [
      { label: 'Learn More', clicks: 8 },
      { label: 'Contact Us', clicks: 3 },
    ],
    exitRateData: [
      { page: '/contact', exitRate: 0.87 },
      { page: '/', exitRate: 0.74 },
    ],
    sessionsByDeviceData: [
      { device: 'Mobile', sessions: 21 },
      { device: 'Desktop', sessions: 7 },
    ],
  }
}

const FILE_PATHS = [
  'src/pages/index.tsx',
  'src/components/Hero.tsx',
  'src/components/Contact.tsx',
  'src/layouts/RootLayout.tsx',
]

router.post('/apps/:id/pulse-analyze', async (req: Request, res: Response) => {
  const appId = req.params.id
  const { publishedUrl } = req.body as { publishedUrl?: string }

  if (!appId) {
    return res.status(400).json({ status: 'error', message: 'App ID is required' })
  }
  if (!publishedUrl) {
    return res.status(400).json({ status: 'error', message: 'publishedUrl is required' })
  }

  logger.info('pulse-analyze.start', { appId, publishedUrl })

  try {
    // Read workspace files (graceful — workspace may not be available in all envs)
    const filesRead: string[] = []
    const fileContents: Record<string, string> = {}

    const workspace = createForWorkspace(appId, 'preview')
    if (workspace) {
      await Promise.all(
        FILE_PATHS.map(async (filePath: string) => {
          try {
            const content: string = await workspace.files.readText({ path: filePath })
            fileContents[filePath] = content
            filesRead.push(filePath)
          } catch {
            // File not found is expected — site may not have all files
          }
        }),
      )
    }

    // Synthetic analytics seeded from appId
    const analytics = getMockAnalytics(appId)

    // Screenshot (non-blocking — card still shows without it)
    let screenshotBase64 = ''
    try {
      const scraper = new WebsiteScraperDriver()
      const scraperResult = await scraper.scrapeAndScreenshot({ url: publishedUrl })
      screenshotBase64 = scraperResult.screenshotBase64 ?? ''
    } catch (screenshotErr: unknown) {
      logger.warn('pulse-analyze.screenshot.failed', {
        appId,
        error: screenshotErr instanceof Error ? screenshotErr.message : String(screenshotErr),
      })
    }

    // Build file context for Claude
    const fileContext = Object.entries(fileContents)
      .map(([path, content]) => `=== ${path} ===\n${content.substring(0, 3000)}`)
      .join('\n\n')

    // Call Claude
    const { model, modelName } = await getAgentModelWithName('fast')

    const llmResult = await generateTextWithTracking({
      model,
      modelName,
      system: CLASSIFICATION_SYSTEM,
      prompt: buildAnalysisPrompt(analytics, fileContext, filesRead),
      temperature: 0.3,
      context: {
        appId,
        description: 'Pulse site analysis',
        toolName: 'pulseAnalyze',
      },
    })

    logger.info('pulse-analyze.llm.complete', { appId, filesRead: filesRead.length })

    // Parse + validate response
    const parsed = parsePulseResponse(llmResult.text)

    if (!parsed) {
      return res.json({ status: 'error', message: 'Failed to parse analysis result' })
    }

    // Confidence threshold
    if (parsed.confidence < CONFIDENCE_THRESHOLD) {
      return res.json({ status: 'healthy', message: 'Your site looks good this week.' })
    }

    return res.json({
      status: 'insight',
      insight: {
        problemType: parsed.problemType,
        headline: parsed.headline,
        description: parsed.description,
        suggestedFix: parsed.suggestedFix,
        confidence: parsed.confidence,
        screenshotBase64,
        filesRead,
      },
    })
  } catch (error: unknown) {
    logger.error('pulse-analyze.error', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    })
    return res.status(500).json({ status: 'error', message: 'Pulse analysis failed' })
  }
})

export default router
