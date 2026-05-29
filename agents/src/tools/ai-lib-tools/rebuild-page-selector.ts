import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'

import { AppRepository } from '../../database/repositories/AppRepository.js'
import { Logger } from '../../logging/index.js'
import { DevSupervisorError } from '../../services/DevSupervisorClient.js'
import { RebuildOrchestrationService } from '../../services/RebuildOrchestrationService.js'
import type { RebuildWorkflowState, SitemapData } from '../../types/rebuild.js'
import { createForWorkspace } from '../../workspace/index.js'
import type { WorkspaceFiles } from '../../workspace/files.js'

const logger = Logger.create({ component: 'rebuild-page-selector-tool' })
const appRepo = new AppRepository()

/**
 * Widget type for page selector
 */
interface RebuildPageSelectorWidget {
  widgetType: 'rebuild-page-selector'
  widgetData: {
    appId: string
    sourceUrl: string
    availablePages: Array<{
      slug: string
      title: string
      url: string
      isBuilt: boolean
    }>
    totalPages: number
    builtPages: number
  }
}

export function slugToTitle(slug: string): string {
  return slug === 'homepage' ? 'Homepage' : slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, ' ')
}

export async function loadWorkflowState(files: WorkspaceFiles): Promise<RebuildWorkflowState | null> {
  try {
    const result = await files.view({ path: '.source-site/workflow-state.json' })
    return JSON.parse(result.content)
  } catch (error) {
    if (error instanceof DevSupervisorError && error.code === 'not_found') return null
    logger.warn('rebuild-page-selector.workflow-state-read-error', { error })
    return null
  }
}

export async function loadSitemap(files: WorkspaceFiles): Promise<SitemapData | null> {
  try {
    const result = await files.view({ path: '.source-site/sitemap.json' })
    return JSON.parse(result.content)
  } catch (error) {
    if (error instanceof DevSupervisorError && error.code === 'not_found') return null
    logger.warn('rebuild-page-selector.sitemap-read-error', { error })
    return null
  }
}

/**
 * Check if there are unbuilt rebuild pages available
 */
export async function hasUnbuiltRebuildPages(appId: string): Promise<boolean> {
  try {
    const workspace = createForWorkspace(appId, 'preview')
    if (!workspace) return false

    const [workflowState, sitemap] = await Promise.all([
      loadWorkflowState(workspace.files),
      loadSitemap(workspace.files)
    ])
    if (!workflowState || !sitemap) return false

    return sitemap.pages
      .filter(p => p.scraped && !workflowState.pagesBuilt.includes(p.slug))
      .length > 0
  } catch (error) {
    logger.warn('rebuild-page-selector.has-unbuilt-check-failed', { appId, error })
    return false
  }
}

export const rebuildPageSelectorAITool: Tool = createTool(
  `Show available pages to build from a rebuilt website.

This tool displays a dropdown/selector of pages that were discovered during the website rebuild process.

**WHEN TO USE:**
- After the homepage has been built in a rebuild workflow
- When the user asks "what other pages can I build?"
- To show the user what pages are available for building

**MODES:**

**SHOW MODE** - Display available pages:
- Shows a dropdown widget with unbuilt pages
- User can select a page and click "Build"
- Pages already built are marked and excluded from selection

**BUILD MODE** - Generate prompt for a specific page:
- Takes a page slug as input
- Generates a detailed build prompt for that page
- Returns the prompt for the develop agent to execute

**WORKFLOW:**
1. After homepage is built, call with mode: 'show'
2. User selects a page from dropdown and clicks "Build"
3. Call with mode: 'build' and the selected pageSlug
4. Use the returned prompt to build the page
5. Repeat until all desired pages are built

**EXAMPLE:**
You: rebuildPageSelector({ mode: 'show' })
Tool returns: Widget with available pages
User clicks "Build" on "About" page
You: rebuildPageSelector({ mode: 'build', pageSlug: 'about' })
Tool returns: { success: true, pagePrompt: "Build an about page..." }`,
  z.object({
    mode: z.enum(['show', 'build']).describe('show: Display available pages | build: Generate prompt for a page'),
    pageSlug: z.string().optional().describe('For build mode: The slug of the page to build (e.g., "about", "contact")')
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string

    if (!appId) {
      throw new Error('App ID is required for rebuild page selector')
    }

    const app = await appRepo.findById(appId)
    if (!app) {
      throw new Error(`App not found: ${appId}`)
    }

    const workspace = createForWorkspace(appId, 'preview')
    if (!workspace) {
      throw new Error('Workspace not available for this app')
    }
    const { files } = workspace

    const [workflowState, sitemap] = await Promise.all([
      loadWorkflowState(files),
      loadSitemap(files)
    ])
    if (!workflowState) {
      return {
        success: false,
        error: 'No rebuild workflow found. Start a rebuild first using websiteRebuild tool.',
        message: 'No rebuild workflow found for this app.'
      }
    }
    if (!sitemap) {
      return {
        success: false,
        error: 'No sitemap found. The rebuild process may not have completed successfully.',
        message: 'No sitemap found for this app.'
      }
    }

    if (input.mode === 'show') {
      logger.info('rebuildPageSelector.show', {
        appId,
        totalPages: sitemap.totalPages,
        builtPages: workflowState.pagesBuilt.length
      })

      const availablePages = sitemap.pages
        .filter(p => p.scraped)
        .map(p => ({
          slug: p.slug,
          title: slugToTitle(p.slug),
          url: p.url,
          isBuilt: workflowState.pagesBuilt.includes(p.slug)
        }))

      const unbuiltPages = availablePages.filter(p => !p.isBuilt)

      const widget: RebuildPageSelectorWidget = {
        widgetType: 'rebuild-page-selector',
        widgetData: {
          appId,
          sourceUrl: workflowState.sourceUrl,
          availablePages,
          totalPages: availablePages.length,
          builtPages: workflowState.pagesBuilt.length
        }
      }

      if (unbuiltPages.length === 0) {
        return {
          success: true,
          message: 'All available pages have been built!',
          widget,
          allPagesBuilt: true
        }
      }

      return {
        success: true,
        message: `${unbuiltPages.length} page(s) available to build`,
        widget,
        availablePages: unbuiltPages,
        suggestedResponse: `I found ${unbuiltPages.length} additional page(s) from your original site. Select a page from the dropdown to build it.`
      }
    }

    if (input.mode === 'build') {
      if (!input.pageSlug) {
        throw new Error('pageSlug is required for build mode')
      }

      logger.info('rebuildPageSelector.build', {
        appId,
        pageSlug: input.pageSlug
      })

      const page = sitemap.pages.find(p => p.slug === input.pageSlug)
      if (!page) {
        return {
          success: false,
          error: `Page not found: ${input.pageSlug}`,
          message: `Could not find a page with slug "${input.pageSlug}"`
        }
      }

      if (!page.scraped) {
        return {
          success: false,
          error: `Page was not scraped: ${input.pageSlug}`,
          message: `The page "${input.pageSlug}" was discovered but not scraped. Cannot build it.`
        }
      }

      if (workflowState.pagesBuilt.includes(input.pageSlug)) {
        return {
          success: false,
          error: `Page already built: ${input.pageSlug}`,
          message: `The page "${input.pageSlug}" has already been built.`
        }
      }

      const service = new RebuildOrchestrationService(app.path)
      const pagePrompt = await service.buildPage(appId, input.pageSlug)

      logger.info('rebuildPageSelector.prompt-generated', {
        appId,
        pageSlug: input.pageSlug,
        promptLength: pagePrompt.length
      })

      return {
        success: true,
        message: `Generated build prompt for "${input.pageSlug}" page`,
        pageSlug: input.pageSlug,
        pagePrompt,
        suggestedResponse: `I'll now build the ${input.pageSlug} page based on your original site.`
      }
    }

    throw new Error(`Invalid mode: ${input.mode}`)
  }
)
