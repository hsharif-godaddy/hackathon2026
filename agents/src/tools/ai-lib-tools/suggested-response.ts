import { createTool } from '@airo/ai-lib'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

import { AppRepository } from '../../database/repositories/AppRepository.js'
import { Logger } from '../../logging/index.js'
import type { RebuildWorkflowState, SitemapData } from '../../types/rebuild.js'

const logger = Logger.create({ component: 'suggested-response-tool' })
const appRepo = new AppRepository()

/**
 * Suggestion schema
 */
const suggestionSchema = z.object({
  text: z.string().describe('The suggestion text to display on the button'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Optional metadata for the suggestion')
})

/**
 * Suggested response input schema
 */
const suggestedResponseInputSchema = z.object({
  question: z.string().describe('The question or prompt to ask the user'),
  suggestions: z.array(suggestionSchema).min(1).max(10).describe('Array of suggestions (minimum 1, maximum 10)')
})

/**
 * Load workflow state from disk
 */
async function loadWorkflowState(appPath: string): Promise<RebuildWorkflowState | null> {
  try {
    const statePath = path.join(appPath, '.source-site', 'workflow-state.json')
    const content = await readFile(statePath, 'utf-8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

/**
 * Load sitemap from disk
 */
async function loadSitemap(appPath: string): Promise<SitemapData | null> {
  try {
    const sitemapPath = path.join(appPath, '.source-site', 'sitemap.json')
    const content = await readFile(sitemapPath, 'utf-8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

/**
 * Check if there are unbuilt rebuild pages available
 */
export async function hasUnbuiltRebuildPages(appId: string): Promise<boolean> {
  try {
    const app = await appRepo.findById(appId)
    if (!app) {
      return false
    }

    const workflowState = await loadWorkflowState(app.path)
    if (!workflowState) {
      return false
    }

    const sitemap = await loadSitemap(app.path)
    if (!sitemap) {
      return false
    }

    // Check if there are any scraped pages that haven't been built yet
    const unbuiltCount = sitemap.pages
      .filter(p => p.scraped && !workflowState.pagesBuilt.includes(p.slug))
      .length

    return unbuiltCount > 0
  } catch {
    return false
  }
}

/**
 * Check for rebuild pages and return widget data if available
 */
async function getRebuildPageSelectorWidget(
  appId: string
): Promise<{ widget: any; unbuiltPages: any[] } | null> {
  try {
    const app = await appRepo.findById(appId)
    if (!app) {
      return null
    }

    const workflowState = await loadWorkflowState(app.path)
    if (!workflowState) {
      return null
    }

    const sitemap = await loadSitemap(app.path)
    if (!sitemap) {
      return null
    }

    // Get available pages (scraped but not built)
    const availablePages = sitemap.pages
      .filter(p => p.scraped)
      .map(p => ({
        slug: p.slug,
        title: p.slug === 'homepage' ? 'Homepage' : p.slug.charAt(0).toUpperCase() + p.slug.slice(1).replace(/-/g, ' '),
        url: p.url,
        isBuilt: workflowState.pagesBuilt.includes(p.slug)
      }))

    const unbuiltPages = availablePages.filter(p => !p.isBuilt)

    if (unbuiltPages.length === 0) {
      logger.debug('suggested-response.no-rebuild-pages', { appId })
      return null
    }

    logger.info('suggested-response.adding-rebuild-widget', {
      appId,
      unbuiltCount: unbuiltPages.length,
      totalPages: sitemap.pages.length
    })

    const widget = {
      widgetType: 'rebuild-page-selector',
      widgetData: {
        appId,
        sourceUrl: workflowState.sourceUrl,
        availablePages,
        totalPages: availablePages.length,
        builtPages: workflowState.pagesBuilt.length
      }
    }

    return { widget, unbuiltPages }
  } catch (error) {
    logger.warn('suggested-response.rebuild-check-failed', {
      appId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })
    return null
  }
}

/**
 * Suggested Response Tool for AI-Lib
 * 
 * Ends a conversation with a question and suggested responses.
 * Displays interactive buttons that users can click to quickly respond.
 * 
 * Automatically includes rebuild page options if available.
 */
export const suggestedResponseAITool = createTool(
  `End your response with a question and suggested answers.
Use this when you want to give the user quick options to respond with.
The suggestions will be displayed as clickable buttons below your question.

This tool automatically checks for available rebuild pages and includes them
as suggestions without requiring explicit prompting.

Guidelines for good suggestions:
- Only call this tool when you have genuinely useful next steps to offer.
- Keep suggestions tightly relevant to what the user just asked or the current
  state of the app — avoid generic or unrelated options.
- Prefer 2–3 short, specific, actionable suggestions. No minimum — skip this
  tool entirely if there are no good non-plan suggestions.
- Do not suggest actions that simply repeat the user's previous request.
- NEVER duplicate or rephrase uncompleted todo list items. The user already
  sees those in the plan panel. For example, do not suggest "Let's build the
  about page" if "About page" is an uncompleted plan item.
- Focus on the current task: design tweaks, feedback requests, refinements
  to what was just built, or cross-cutting concerns (fonts, colors, SEO).

Example use cases:
- Offering multiple options for the user to choose from
- Providing common follow-up actions
- Guiding the user through a decision tree
`,
  suggestedResponseInputSchema,
  async (input, context) => {
    const { question, suggestions } = input
    const appId = context?.metadata?.appId as string
    
    logger.info('suggested-response.called', {
      appId,
      hasContext: !!context,
      hasMetadata: !!context?.metadata,
      metadataKeys: context?.metadata ? Object.keys(context.metadata) : []
    })
    
    // Check for rebuild pages and include widget if available
    let rebuildWidget = null
    if (appId) {
      logger.info('suggested-response.checking-rebuild-data', { appId })
      const rebuildData = await getRebuildPageSelectorWidget(appId)
      if (rebuildData) {
        rebuildWidget = rebuildData.widget
        
        logger.info('suggested-response.rebuild-widget-included', {
          appId,
          unbuiltCount: rebuildData.unbuiltPages.length
        })
      } else {
        logger.info('suggested-response.no-rebuild-data', { appId })
      }
    } else {
      logger.warn('suggested-response.no-appid', {
        hasContext: !!context,
        contextKeys: context ? Object.keys(context) : []
      })
    }
    
    // Return structured data that will be handled by the frontend
    // The WebSocket server will transform this into a widget segment
    const result: any = {
      success: true,
      widgetType: 'suggested-response',
      widgetData: {
        type: 'suggested-response',
        question,
        suggestions
      },
      message: `Suggested response rendered with ${suggestions.length} option${suggestions.length === 1 ? '' : 's'}`
    }
    
    // Include rebuild widget if available
    if (rebuildWidget) {
      result.rebuildWidget = rebuildWidget
      result.message += ` (with rebuild page selector)`
    }
    
    return result
  }
)
