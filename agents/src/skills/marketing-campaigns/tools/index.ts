import { z } from 'zod'
import type { SkillToolDefinition } from '@airo/ai-skills'

import { Logger } from '../../../logging/index.js'
import { SimpleCampaignRepository } from '../../../database/repositories/SimpleCampaignRepository.js'
import type { CreateSimpleCampaignParams, CreateSimpleCampaignContentParams } from '../../../database/repositories/SimpleCampaignRepository.js'
import { SocialPostRepository } from '../../../database/repositories/SocialPostRepository.js'
import { SimpleCampaignStatus } from '../../../database/schema.js'
import type { SimpleCampaignContentType, SimpleCampaignContentStatus, SocialAssociation, SocialPost } from '../../../database/schema.js'
import { SocialAssociationRepository } from '../../../database/repositories/SocialAssociationRepository.js'
import { SocialPlatform, PostState } from '../../../types/social.js'
import { MediaSearchTool } from '../../../tools/media-search-tool.js'
import { mergeBrandIdentity, MEMORY_KEY, type BrandIdentity } from '../../../tools/ai-lib-tools/brand-identity.js'
import { getKvMemoryStore } from '../../../memory/adapters/index.js'
import { workspaceScopeFromAppId, customerIdFromContext } from '../../../memory/interfaces/scope.js'
import { createForWorkspace } from '../../../workspace/index.js'
import { serializeSocialRawContent } from '../../../services/social/social-raw-content.js'
import type { SocialRawContent } from '../../../services/social/social-raw-content.js'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const logger = Logger.create({ component: 'marketing-campaigns-tools' })

const campaignRepo = new SimpleCampaignRepository()
const socialAssociationRepo = new SocialAssociationRepository()
const socialPostRepo = new SocialPostRepository()
const mediaSearch = new MediaSearchTool()
const kvMemory = getKvMemoryStore()

function isCampaignsEnabled(context: any): boolean {
  return !!context?.metadata?.marketingCampaignsEnabled
}

function campaignsDisabledResult(): { success: false; error: string } {
  return { success: false, error: 'Marketing campaigns are not available.' }
}

/**
 * Materialize a pre-launch social draft into a DRAFT social_posts carrier at
 * campaign-approve time (the GENERATE step of the V2 flow). The returned post id becomes
 * the content row's contentRefId — the stable handle launch (RUBICON-441) binds to the
 * platform. Editability is gated on campaign status, not on this id, so a freshly-stamped
 * draft stays editable until the campaign launches.
 *
 * UTM attribution (marketing_utm) is intentionally NOT minted here — that is the
 * RUBICON-499/500 workstream's responsibility, which owns the full token format
 * (utm_content/utm_term/cmp_-prefixed utm_campaign) at carrier persistence.
 */
function materializeSocialDraft(appId: string, campaignId: string, rawContent: SocialRawContent): string {
  const post: SocialPost = socialPostRepo.create({
    appId,
    campaignId,
    state: PostState.DRAFT,
    platform: rawContent.platform ?? null,
    payload: rawContent,
  })
  return post.id
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LANDING_PAGE_TEMPLATE_PATH = path.resolve(__dirname, '../templates/pages/campaign-landing.tsx')

export function sanitizeSlug(raw: string): string {
  const slug = raw
    .replace(/^\/+/, '')
    .split(/[/\\]/).pop()!
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
  return slug || 'campaign'
}

export async function buildLandingPage(slug: string, startDate: string, endDate: string): Promise<string> {
  const safe = slug.replace(/^(\d)/, 'c$1')
  const componentName = safe
    .split('-')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('') + 'Page'

  const template = await readFile(LANDING_PAGE_TEMPLATE_PATH, 'utf-8')

  return template
    .replace(/__SALE_END__/g, JSON.stringify(`${endDate}T23:59:59Z`))
    .replace(/__SALE_START__/g, JSON.stringify(`${startDate}T00:00:00Z`))
    .replace(/__COMPONENT_NAME__/g, componentName)
}

async function scaffoldLandingPage(appId: string, landingPagePath: string, startDate: string, endDate: string): Promise<{ success: boolean; filesWritten: string[] }> {
  const workspace = createForWorkspace(appId, 'preview')
  if (!workspace) {
    logger.warn('campaign-scaffold.workspace_unavailable', { appId })
    return { success: false, filesWritten: [] }
  }

  const slug = sanitizeSlug(landingPagePath)
  const filesWritten: string[] = []

  try {
    const content = await buildLandingPage(slug, startDate, endDate)
    await workspace.files.write({ path: `src/pages/lp/${slug}.tsx`, content })
    filesWritten.push(`src/pages/lp/${slug}.tsx`)
  } catch (err) {
    logger.error('campaign-scaffold.write_failed', { appId, error: err instanceof Error ? err.message : String(err) })
  }

  logger.info('campaign-scaffold.complete', { appId, filesWritten })
  return { success: filesWritten.length === 1, filesWritten }
}

const plannedAssetSchema = z.object({
  assetType: z.enum(['landing-page', 'banner', 'blog', 'social', 'email', 'ad']).describe('Content channel'),
  title: z.string().describe('Asset title or headline'),
  scheduledDate: z.string().optional().describe('Planned publish date (YYYY-MM-DD)'),
  description: z.string().optional().describe('Brief description of what this content covers'),
})

export const campaignPlanPropose: SkillToolDefinition = {
  name: 'campaignPlanPropose',
  description: `Present a campaign plan to the user for approval. This STOPS the agent and waits for the user to approve or request changes.

WHEN TO CALL: After the user answers your discovery questions (from askQuestion in CLARIFY) and you have all the information needed to build a plan. Call this tool with the full plan details.

WHAT HAPPENS: The plan is rendered inline in the chat as a conversational summary (bullet list of assets with dates) followed by approval chips. The agent STOPS and waits.

HOW TO USE: Write a brief conversational intro in your message text then call this tool. The tool renders the plan details and approval buttons. Do NOT duplicate the plan details in your message text.

CRITICAL RULES:
- Call this tool ONCE per plan presentation (initial or revised)
- Do NOT list the plan assets in your message text — the tool renders them
- Do NOT call any other tools in the same turn as this tool
- If the user requests changes, adjust the plan and call this tool AGAIN with the updated plan
- Only proceed to content generation after the user clicks "Approve"`,
  parameters: z.object({
    name: z.string().describe('Campaign name'),
    offer: z.string().describe('The campaign offer or goal — keep to 5 words or fewer (e.g. "Increase revenue by 2x")'),
    startDate: z.string().describe('Campaign start date (YYYY-MM-DD)'),
    endDate: z.string().describe('Campaign end date (YYYY-MM-DD)'),
    assets: z.array(plannedAssetSchema).min(1).describe('List of planned content pieces'),
    landingPagePath: z.string().describe('Desired slug for the landing page (e.g. "summer-sale", "halloween"). Will be sanitized and frozen as the canonical slug used across all CTAs and the route.'),
    assumptions: z.array(z.string()).min(1).describe('3-4 short plain-language assumptions you inferred about the business (audience, main goal, what to feature). Rendered on the card under "Here\'s what I\'m assuming — tell me if any of this is off" so the owner can correct a wrong guess before anything is built.'),
    whyThisMix: z.string().describe('One or two plain sentences explaining why this channel mix serves their goal and what the key assets do (e.g. landing page = one place to buy, blog = search traffic over time, social = reach your followers). No jargon.'),
    expectation: z.string().describe('A rough, directional, honest expectation — a ballpark, NEVER precise numbers or guarantees (e.g. "a small first wave of visitors and a handful of early sales, with the blog building over the following weeks"). Frame as depending on their audience and offer.'),
    vertical: z.string().optional().describe('The business vertical/industry you confirmed or inferred in CLARIFY (e.g. "coffee roaster", "law firm"). Pass it on every campaign — an inferred value is fine. Persisted to the brand book so future campaigns reuse it.'),
    salesType: z.enum(['online', 'in_store', 'service', 'hybrid']).optional().describe('How the business sells/serves customers if known or inferable: online | in_store | service | hybrid.'),
    location: z.string().optional().describe('Storefront address or service area, if known (e.g. "123 Main St, Austin TX").'),
  }),
  config: { stopAfter: true },
  async execute(input, context) {
    if (!isCampaignsEnabled(context)) {
      logger.warn('campaign-plan-propose.feature_disabled', { appId: context?.metadata?.appId })
      return campaignsDisabledResult()
    }

    const appId = context?.metadata?.appId as string | undefined

    const canonicalSlug = sanitizeSlug(input.landingPagePath)

    logger.info('campaign-plan-propose.called', {
      appId,
      campaignName: input.name,
      assetCount: input.assets.length,
      canonicalSlug,
    })

    // Persist the business signal as a side effect of this gate-enforced plan proposal.
    // A separate model-initiated brandIdentity SET loses to the PLAN gate (rule 11), so we
    // write here instead. Empty-only: never overwrite a value the brand book already has.
    if (appId && (input.vertical || input.salesType || input.location)) {
      try {
        const scope = workspaceScopeFromAppId(appId, customerIdFromContext(context))
        const existing = await kvMemory.get(scope, MEMORY_KEY)
        if (existing.success) {
          const current = (existing.exists && existing.value ? existing.value : {}) as BrandIdentity
          const update: BrandIdentity = {}
          if (input.vertical && !current.vertical) update.vertical = input.vertical
          if (input.salesType && !current.salesType) update.salesType = input.salesType
          if (input.location && !current.location) update.location = input.location
          const fields = Object.keys(update)
          if (fields.length > 0) {
            const writeResult = await kvMemory.set(scope, MEMORY_KEY, mergeBrandIdentity(current, update))
            if (writeResult.success) {
              logger.info('campaign-plan-propose.brand_signal_persisted', { appId, fields })
            } else {
              logger.warn('campaign-plan-propose.brand_signal_persist_failed', {
                appId,
                fields,
                error: writeResult.error ?? 'Unknown error',
              })
            }
          }
        }
      } catch (error) {
        logger.warn('campaign-plan-propose.brand_signal_persist_failed', {
          appId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return {
      success: true,
      widgetType: 'campaign-plan-propose',
      widgetData: {
        type: 'campaign-plan-propose',
        plan: {
          name: input.name,
          offer: input.offer,
          startDate: input.startDate,
          endDate: input.endDate,
          landingPageSlug: canonicalSlug,
          landingPageRoute: `/lp/${canonicalSlug}`,
          assets: input.assets,
          assumptions: input.assumptions,
          whyThisMix: input.whyThisMix,
          expectation: input.expectation,
        },
      },
      message: `Campaign plan "${input.name}" presented for approval. Landing page will be at /lp/${canonicalSlug}. Waiting for user response.`,
    }
  }
}

export const campaignScaffoldPage: SkillToolDefinition = {
  name: 'campaignScaffoldPage',
  description: `Scaffold the landing page template with countdown timer and date-gating. Call this AFTER social posts and email/ad copy are created, BEFORE the handoff to the builder.

This tool writes a landing page file to the workspace with:
- A countdown timer to the sale end date
- Three states: coming soon (before start), active sale (with countdown), and sale ended (after end)
- Placeholder content for the builder to fill in

The landing page MUST exist before the build handoff so the builder can EDIT it (not recreate from scratch).

CRITICAL TIMING: Call this tool in GENERATE Step 3, after socialPostCreate and email/ad, before the handoff.`,
  parameters: z.object({
    startDate: z.string().describe('Campaign start date (YYYY-MM-DD)'),
    endDate: z.string().describe('Campaign end date (YYYY-MM-DD)'),
    landingPagePath: z.string().describe('The canonical slug from the approved plan (plan.landingPageSlug). Pass exactly the value returned by campaignPlanPropose — do NOT invent a new slug.'),
  }),
  async execute(args, context) {
    if (!isCampaignsEnabled(context)) {
      logger.warn('campaign-scaffold.feature_disabled', { appId: context?.metadata?.appId })
      return campaignsDisabledResult()
    }

    const appId = context?.metadata?.appId as string | undefined
    if (!appId) {
      return { success: false, error: 'No appId in context' }
    }

    const result = await scaffoldLandingPage(appId, args.landingPagePath, args.startDate, args.endDate)
    return {
      success: result.success,
      filesWritten: result.filesWritten,
      message: result.success
        ? `Landing page scaffolded at ${result.filesWritten[0]}. Route: /lp/${sanitizeSlug(args.landingPagePath)}. Import path for routes.tsx: ./pages/lp/${sanitizeSlug(args.landingPagePath)}.tsx. The builder will EDIT this file to add creative content.`
        : 'Failed to scaffold landing page — check logs.',
    }
  }
}

export const campaignPlanCreate: SkillToolDefinition = {
  name: 'campaignPlanCreate',
  description: `Save the completed campaign and render the campaign card. Call this ONLY in the SUMMARY step — AFTER all content has been fully generated (landing page built, blog posts written, social posts created, email/ad copy written). This is the LAST tool you call in the campaign flow.

DO NOT call this tool:
- During the planning/discovery phase
- Before the user approves the plan
- Before content generation is complete

CRITICAL TIMING: Call this tool ONLY in SUMMARY, after the build handoff has completed.`,
  parameters: z.object({
    name: z.string().describe('Campaign name'),
    offer: z.string().describe('The campaign offer or goal — keep to 5 words or fewer (e.g. "Increase revenue by 2x")'),
    startDate: z.string().describe('Campaign start date (YYYY-MM-DD)'),
    endDate: z.string().describe('Campaign end date (YYYY-MM-DD)'),
    plannedContent: z.array(z.object({
      assetType: z.enum(['landing-page', 'banner', 'blog', 'social', 'email', 'ad']).describe('Content channel'),
      title: z.string().describe('Planned content title or headline'),
      scheduledDate: z.string().optional().describe('Planned publish date (YYYY-MM-DD)'),
      contentPreview: z.string().optional().describe('Brief description of what this content will cover'),
      imageUrl: z.string().optional().describe('URL of the image used for this content piece'),
      status: z.enum(['draft', 'scheduled', 'published', 'failed']).optional().describe("Publish status shown on the card badge. Use 'scheduled' for built site assets (landing page, blog) that go out at launch, and 'draft' for social/email/ad that still need the user to publish. Never 'published' before the user launches."),
      rawContent: z.object({
        message: z.string().describe('The post caption/body text.'),
        hashtags: z.array(z.string()).describe('Hashtags without the # symbol.'),
        callToAction: z.string().optional().describe('Optional CTA text.'),
        platform: z.enum(['facebook', 'instagram']).optional().describe('Optional target platform.'),
      }).optional().describe('For SOCIAL assets ONLY: the generated post body, stored as the editable pre-launch draft. Copy the message/hashtags/callToAction/platform you produced with socialPostCreate.'),
    })).describe('List of planned content items for the campaign'),
  }),
  async execute(args, context) {
    if (!isCampaignsEnabled(context)) {
      logger.warn('campaign-plan-create.feature_disabled', { appId: context?.metadata?.appId })
      return campaignsDisabledResult()
    }

    const appId = context?.metadata?.appId as string | undefined

    if (!appId) {
      return JSON.stringify({ success: false, error: 'No appId in context' })
    }

    const existingDrafts = campaignRepo.findByAppId(appId).filter(c => c.status === 'draft')
    for (const draft of existingDrafts) {
      campaignRepo.delete(draft.id)
    }

    const campaignInput: CreateSimpleCampaignParams = {
      appId,
      name: args.name,
      offer: args.offer,
      startDate: args.startDate,
      endDate: args.endDate,
    }

    const campaign = campaignRepo.create(campaignInput)

    // campaignPlanCreate is the terminal SUMMARY tool; its card shows a "Launch
    // Campaign" button. launch() requires status 'ready' (not 'draft'), so move the
    // freshly-created draft to ready here. transition() returns the updated campaign,
    // so we reuse it for the widget instead of re-reading from the DB.
    const readyCampaign = campaignRepo.transition(campaign.id, SimpleCampaignStatus.Ready)

    for (const item of args.plannedContent) {
      let imageUrl: string | undefined = item.imageUrl
      if (!imageUrl) {
        try {
          const searchQuery = `${item.title} ${args.name}`.slice(0, 60)
          const result = await mediaSearch.searchMedia(searchQuery, 'image', 1, appId)
          if (result.success) {
            imageUrl = result.url || (result.urls && result.urls[0]) || undefined
          }
        } catch {
          // Fall through without image
        }
      }

      // A social asset with a generated draft is materialized now (GENERATE step): we
      // create its DRAFT social_posts row and stamp the resulting post id as contentRefId
      // (UTM is intentionally not minted here — RUBICON-499/500 owns that). Non-social
      // assets, and social teasers without rawContent, leave contentRefId null — their
      // live-content pointer is wired later by a resolver.
      const isSocial: boolean = item.assetType === 'social'
      const rawContent: string | undefined =
        isSocial && item.rawContent ? serializeSocialRawContent(item.rawContent) : undefined
      const contentRefId: string | undefined =
        isSocial && item.rawContent ? materializeSocialDraft(appId, campaign.id, item.rawContent) : undefined

      const assetInput: CreateSimpleCampaignContentParams = {
        simpleCampaignId: campaign.id,
        assetType: item.assetType as SimpleCampaignContentType,
        title: item.title,
        scheduledDate: item.scheduledDate,
        status: (item.status ?? (isSocial ? 'draft' : 'scheduled')) as SimpleCampaignContentStatus,
        contentPreview: item.contentPreview,
        imageUrl,
        ...(rawContent !== undefined ? { rawContent } : {}),
        ...(contentRefId !== undefined ? { contentRefId } : {}),
      }
      campaignRepo.addContent(assetInput)
    }

    // Deterministically check social-connection prerequisite (local SQLite read,
    // no API call). Social posts are saved as drafts and can only publish once a
    // platform is connected, so surface this as a pending action the agent must
    // relay — rather than relying on the model to call socialRead during VERIFY.
    const hasSocialAssets: boolean = args.plannedContent.some((item: { assetType: string }): boolean => item.assetType === 'social')
    const connectedPlatforms: Set<string> = hasSocialAssets
      ? new Set(socialAssociationRepo.findByAppId(appId).map((association: SocialAssociation): string => association.platform))
      : new Set<string>()
    const socialConnected: boolean | undefined = hasSocialAssets
      ? connectedPlatforms.has(SocialPlatform.FACEBOOK) || connectedPlatforms.has(SocialPlatform.INSTAGRAM)
      : undefined
    const pendingActions: string[] =
      socialConnected === false
        ? ['Connect Facebook/Instagram so the social posts can publish — they are saved as drafts until a platform is connected.']
        : []

    const statusSummary: string =
      'Built and ready to launch. Nothing is public yet: the landing page and blog go live only when the site is published, and social posts publish only once connected and posted. Do NOT describe the campaign or any asset as "live", "launched", or "published".'

    return {
      success: true,
      widget: {
        widgetType: 'campaign-plan',
        widgetData: { campaign: readyCampaign },
      },
      campaign: readyCampaign,
      socialConnected,
      pendingActions,
      statusSummary,
    }
  }
}

export const campaignCreate: SkillToolDefinition = {
  name: 'campaignCreate',
  description: `Save a generated campaign and mark it ready for launch. Call this AFTER all campaign assets have been generated (landing page built, blog posts written, social posts created).

This tool persists the campaign record together with its actual generated assets (each asset carries a real contentRef) and marks it "ready".`,
  parameters: z.object({
    name: z.string().describe('Campaign name — must match the existing plan name'),
    offer: z.string().describe('The campaign offer or goal — keep to 5 words or fewer (e.g. "Increase revenue by 2x")'),
    startDate: z.string().describe('Campaign start date (YYYY-MM-DD)'),
    endDate: z.string().describe('Campaign end date (YYYY-MM-DD)'),
    assets: z.array(z.object({
      assetType: z.enum(['landing-page', 'banner', 'blog', 'social', 'email', 'ad']).describe('Type of asset'),
      externalRef: z.string().describe('Reference: file path for blogs/pages, post ID for social, or description for email/ad'),
      title: z.string().describe('Asset title or headline'),
      scheduledDate: z.string().optional().describe('Scheduled publish/send date (YYYY-MM-DD)'),
      status: z.enum(['draft', 'scheduled', 'published', 'failed']).optional().describe('Current status'),
      contentPreview: z.string().optional().describe('Brief content preview'),
      imageUrl: z.string().optional().describe('URL of the image used for this content'),
    })).describe('All campaign assets to track'),
  }),
  async execute(args, context) {
    if (!isCampaignsEnabled(context)) {
      logger.warn('campaign-create.feature_disabled', { appId: context?.metadata?.appId })
      return campaignsDisabledResult()
    }

    const appId = context?.metadata?.appId as string | undefined

    if (!appId) {
      return JSON.stringify({ success: false, error: 'No appId in context' })
    }

    // Create the campaign and attach its (already-generated, real) content. We do NOT
    // look up and reuse a prior draft: that made the result depend on there being
    // exactly one draft, and forced a delete-then-recreate of placeholder content.
    // Each call persists a fresh campaign with the real assets it was given.
    const campaign = campaignRepo.create({
      appId,
      name: args.name,
      offer: args.offer,
      startDate: args.startDate,
      endDate: args.endDate,
    })

    const readyCampaign = campaignRepo.transition(campaign.id, SimpleCampaignStatus.Ready)

    for (const asset of args.assets) {
      let imageUrl: string | undefined = asset.imageUrl
      if (!imageUrl) {
        try {
          const searchQuery = `${asset.title} ${args.name}`.slice(0, 60)
          const result = await mediaSearch.searchMedia(searchQuery, 'image', 1, appId)
          if (result.success) {
            imageUrl = result.url || (result.urls && result.urls[0]) || undefined
          }
        } catch {
          // Fall through without image
        }
      }

      const assetInput: CreateSimpleCampaignContentParams = {
        simpleCampaignId: campaign.id,
        assetType: asset.assetType as SimpleCampaignContentType,
        contentRefId: asset.externalRef,
        title: asset.title,
        scheduledDate: asset.scheduledDate,
        status: (asset.status || 'scheduled') as SimpleCampaignContentStatus,
        contentPreview: asset.contentPreview,
        imageUrl,
      }
      campaignRepo.addContent(assetInput)
    }

    return {
      success: true,
      widget: {
        widgetType: 'campaign-plan',
        widgetData: { campaign: readyCampaign },
      },
      campaign: readyCampaign,
    }
  }
}

export const tools: SkillToolDefinition[] = [
  campaignPlanPropose,
  campaignScaffoldPage,
  campaignPlanCreate,
  campaignCreate,
]
