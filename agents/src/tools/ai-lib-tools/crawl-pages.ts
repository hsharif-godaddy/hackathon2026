import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'

import { getActionService } from '../../server/agent-runtime.js'
import { Logger } from '../../logging/index.js'

const logger = Logger.create({ component: 'crawl-pages-tool' })

export interface CrawlIssue {
  type: 'broken-image' | 'broken-link' | 'empty-section' | 'placeholder-text' | 'audit-error'
  detail: string
  src?: string
  href?: string
}

export interface CrawlResult {
  route: string
  issues: CrawlIssue[]
  screenshot?: string
  failed?: boolean
}

export const crawlPagesAITool: Tool = createTool(
  'Crawl pages in the preview app to check for broken images, broken links, empty sections, and placeholder text. Returns a structured report of issues found per page. Use after the build is complete to verify runtime quality.',
  z.object({
    routes: z.array(z.string()).describe('Routes to crawl (e.g. ["/", "/about", "/contact"]). Read src/routes.tsx to discover these.'),
    includeScreenshots: z.boolean().default(false).describe('Whether to capture a screenshot of each page (increases response size)'),
  }),
  async (input, context) => {
    const socketId: string | undefined =
      (context as Record<string, unknown> | undefined)?.socketId as string | undefined ??
      ((context?.metadata as Record<string, unknown> | undefined)?.sessionId as string | undefined)

    if (!socketId) {
      throw new Error('crawlPages requires a client connection (no sessionId in context)')
    }

    const clientActionService = getActionService(socketId)
    if (!clientActionService) {
      throw new Error('No client connection available for page crawling')
    }

    const { routes, includeScreenshots } = input
    const results: CrawlResult[] = []

    for (const route of routes) {
      logger.info('crawlPages.auditing', { route })

      try {
        const result = await clientActionService.executeAction({
          action: 'audit',
          params: { route, validRoutes: routes, includeScreenshot: includeScreenshots },
          timeoutMs: includeScreenshots ? 45000 : 30000,
        }) as { issues?: CrawlIssue[]; screenshot?: string }

        results.push({
          route,
          issues: result.issues ?? [],
          screenshot: includeScreenshots ? result.screenshot : undefined,
        })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn('crawlPages.route_failed', { route, error: message })
        results.push({
          route,
          issues: [{ type: 'audit-error', detail: `Audit failed for route: ${message}` }],
          failed: true,
        })
      }
    }

    const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0)
    logger.info('crawlPages.complete', { routeCount: routes.length, totalIssues })

    return {
      results,
      summary: {
        routesCrawled: results.length,
        totalIssues,
        brokenImages: results.flatMap(r => r.issues).filter(i => i.type === 'broken-image').length,
        brokenLinks: results.flatMap(r => r.issues).filter(i => i.type === 'broken-link').length,
        emptySections: results.flatMap(r => r.issues).filter(i => i.type === 'empty-section').length,
        placeholderText: results.flatMap(r => r.issues).filter(i => i.type === 'placeholder-text').length,
      },
    }
  }
)
