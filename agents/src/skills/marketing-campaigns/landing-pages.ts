import { createForWorkspace } from '../../workspace/index.js'
import { readJsonSidecar } from '../../workspace/json-sidecar.js'
import type { TreeEntry } from '../../workspace/files.js'
import { isDevSupervisorNotFound } from '../../services/DevSupervisorClient.js'
import { Logger } from '../../logging/index.js'

// Campaign workspace-file cleanup + the landing-page manifest, shared between the marketing-campaigns
// skill tools and the campaigns HTTP route. This module deliberately imports ONLY the workspace +
// logging primitives (never the agent/skill-tool graph) so the server route can clean up a deleted
// campaign's landing pages AND blog posts without pulling in develop-agent, skill-loader, etc.
const logger = Logger.create({ component: 'marketing-campaigns-landing-pages' })

// Manifest of campaign landing pages that the permanent /lp/:slug route reads (RUBICON-502, #5639).
export const MANIFEST_PATH = 'src/content/data/landingPages.json'
// Directory the content plugin discovers blog posts from.
const BLOG_DIR = 'src/content/data/blog'

export interface LandingPageManifestEntry {
  id: string
  slug: string
  componentPath: string
  startDate?: string
  endDate?: string
  status?: 'published' | 'scheduled' | 'draft'
  campaignId?: string
}

// Remove a deleted campaign's landing pages: delete their per-page .tsx files and drop their
// manifest entries. Best-effort — a campaign delete must not fail because the workspace is
// unavailable or a file is already gone. Entries are matched by the campaignId stamped at SUMMARY
// (stampManifestCampaignId). The /lp/:slug route is a single permanent manifest-driven route, so
// removing the entry is enough to make the slug 404 — no routes.tsx edit needed.
export async function deleteCampaignLandingPages(appId: string, campaignId: string): Promise<void> {
  const workspace = createForWorkspace(appId, 'preview')
  if (!workspace) return
  let manifest: LandingPageManifestEntry[]
  try {
    manifest = await readJsonSidecar<LandingPageManifestEntry[]>({
      files: workspace.files,
      path: MANIFEST_PATH,
      fallback: [],
      validate: (parsed: unknown) => Array.isArray(parsed) ? (parsed as LandingPageManifestEntry[]) : null,
      onMalformed: (error: SyntaxError): LandingPageManifestEntry[] => {
        logger.warn('campaign.landing-cleanup.manifest_malformed', { appId, campaignId, path: MANIFEST_PATH, error: error.message })
        return []
      },
    })
  } catch (error) {
    logger.warn('campaign.landing-cleanup.manifest_read_failed', { appId, campaignId, error: error instanceof Error ? error.message : String(error) })
    return
  }
  const owned: LandingPageManifestEntry[] = manifest.filter((e: LandingPageManifestEntry): boolean => e.campaignId === campaignId)
  if (owned.length === 0) return
  for (const entry of owned) {
    // Delete the page and its editor backup (`.tsx.bak`, left by the inline/str_replace editor) so
    // no residual file with the campaign's slug lingers after the campaign is gone.
    for (const target of [`src/pages/lp/${entry.slug}.tsx`, `src/pages/lp/${entry.slug}.tsx.bak`]) {
      try {
        await workspace.files.delete({ path: target })
      } catch (error) {
        if (!isDevSupervisorNotFound(error)) {
          logger.warn('campaign.landing-cleanup.file_delete_failed', { appId, campaignId, path: target, error: error instanceof Error ? error.message : String(error) })
        }
      }
    }
  }
  const remaining: LandingPageManifestEntry[] = manifest.filter((e: LandingPageManifestEntry): boolean => e.campaignId !== campaignId)
  await workspace.files.write({ path: MANIFEST_PATH, content: JSON.stringify(remaining, null, 2) })
  logger.info('campaign.landing-cleanup.done', { appId, campaignId, removed: owned.length })
}

// Extract the campaignId from a blog post's YAML frontmatter (`campaignId:` line), or null.
function frontmatterCampaignId(markdown: string): string | null {
  const match: RegExpMatchArray | null = markdown.match(/^campaignId:[ \t]*['"]?([^'"\n]+?)['"]?[ \t]*$/m)
  return match?.[1] ?? null
}

// Remove a deleted campaign's blog posts: delete each `src/content/data/blog/*.md` whose frontmatter
// `campaignId` matches. Symmetric with deleteCampaignLandingPages — landing pages are matched via the
// manifest, but blog posts carry `campaignId` in their own frontmatter, so we match on that. Best-
// effort: a campaign delete must not fail because the workspace is unavailable or a file is gone.
export async function deleteCampaignBlogPosts(appId: string, campaignId: string): Promise<void> {
  const workspace = createForWorkspace(appId, 'preview')
  if (!workspace) return
  let entries: TreeEntry[]
  try {
    entries = (await workspace.files.tree({ path: BLOG_DIR, kindFilter: 'file', includeGlobs: ['*.md'] })).entries
  } catch (error) {
    if (!isDevSupervisorNotFound(error)) {
      logger.warn('campaign.blog-cleanup.list_failed', { appId, campaignId, error: error instanceof Error ? error.message : String(error) })
    }
    return
  }
  let removed: number = 0
  for (const entry of entries) {
    try {
      // readText (raw content), NOT view — view returns cat -n line-numbered content, which would
      // break the line-anchored frontmatter regex and silently match nothing. Mirrors the other read
      // paths (readWorkspaceFile, campaignApplyBlogUtm).
      const content: string = await workspace.files.readText({ path: entry.path })
      if (frontmatterCampaignId(content) === campaignId) {
        await workspace.files.delete({ path: entry.path })
        // Also remove the editor backup (`<file>.md.bak`) if one exists, best-effort.
        try {
          await workspace.files.delete({ path: `${entry.path}.bak` })
        } catch (bakError) {
          if (!isDevSupervisorNotFound(bakError)) {
            logger.warn('campaign.blog-cleanup.bak_delete_failed', { appId, campaignId, path: `${entry.path}.bak`, error: bakError instanceof Error ? bakError.message : String(bakError) })
          }
        }
        removed += 1
      }
    } catch (error) {
      if (!isDevSupervisorNotFound(error)) {
        logger.warn('campaign.blog-cleanup.file_failed', { appId, campaignId, path: entry.path, error: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  // Always log (even removed:0) so a "ran but matched nothing" pass is distinguishable from
  // "never ran" — e.g. when a post predates the campaignId stamp and carries no campaignId.
  logger.info('campaign.blog-cleanup.done', { appId, campaignId, scanned: entries.length, removed })
}
