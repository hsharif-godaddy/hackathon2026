import { z } from 'zod'
import type { SkillToolDefinition } from '@airo/ai-skills'

import { Logger } from '../../../logging/index.js'
import { SimpleCampaignRepository } from '../../../database/repositories/SimpleCampaignRepository.js'
import type { CreateSimpleCampaignParams, CreateSimpleCampaignContentParams } from '../../../database/repositories/SimpleCampaignRepository.js'
import { SocialPostRepository } from '../../../database/repositories/SocialPostRepository.js'
import { SimpleCampaignStatus } from '../../../database/schema.js'
import type { SimpleCampaign, SimpleCampaignContentType, SimpleCampaignContentStatus, SocialAssociation, SocialPost } from '../../../database/schema.js'
import { SocialAssociationRepository } from '../../../database/repositories/SocialAssociationRepository.js'
import { SocialPlatform, PostState } from '../../../types/social.js'
import { MediaSearchTool } from '../../../tools/media-search-tool.js'
import { mergeBrandIdentity, MEMORY_KEY, type BrandIdentity } from '../../../tools/ai-lib-tools/brand-identity.js'
import { getKvMemoryStore } from '../../../memory/adapters/index.js'
import { workspaceScopeFromAppId, customerIdFromContext } from '../../../memory/interfaces/scope.js'
import { createForWorkspace } from '../../../workspace/index.js'
import { serializeSocialRawContent } from '../../../services/social/social-raw-content.js'
import type { SocialRawContent } from '../../../services/social/social-raw-content.js'
import { resolvePublishedUrlFromToolContext } from '../../../services/site-published-url.js'
import { decorateBlogCta, decorateSocialCta, decorateConversionCtaLinks, hasCampaignConversionCta } from '../../../services/campaign-link-decorator.js'
import { isDevSupervisorNotFound } from '../../../services/DevSupervisorClient.js'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const logger = Logger.create({ component: 'marketing-campaigns-tools' })

function jsonArray<T extends z.ZodTypeAny>(field: string, schema: T): z.ZodType<z.output<T>> {
  return z.preprocess((v: unknown): unknown => {
    if (typeof v !== 'string') return v
    try {
      const parsed: unknown = JSON.parse(v)
      if (!Array.isArray(parsed)) {
        logger.warn('marketing-campaigns.json_array_not_array', {
          field,
          receivedType: parsed === null ? 'null' : typeof parsed,
          length: v.length,
        })
        return v
      }
      return parsed
    } catch (e) {
      logger.warn('marketing-campaigns.json_array_parse_failed', { field, length: v.length, parseError: e instanceof Error ? e.message : String(e) })
      return v
    }
  }, schema)
}

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
 * UTM attribution (marketing_utm) is minted here at carrier persistence (RUBICON-499/500/501,
 * social half): once the DRAFT carrier exists we have its stable id, so we put the ABSOLUTE
 * tracked URL in the caption (a caption lives off-site, so a relative /lp link wouldn't
 * resolve) and mint the marketing_utm row keyed by the post id. For caption-clickable
 * platforms (Facebook, Google Business Profile) we decorate the existing /lp/<slug> link if
 * the caption has one, otherwise APPEND the tracked URL — so the post always carries a
 * trackable link. Instagram is excluded: its captions can't carry per-post clickable links
 * ("link in bio"), so per-post IG attribution is handled separately. Decoration is also
 * skipped when the site isn't published or the campaign slug is unknown.
 * Returns the post id plus the (possibly decorated) rawContent so the caller persists the
 * same caption to the content-row projection that it wrote to the carrier.
 */
const CAPTION_LINK_PLATFORMS: ReadonlySet<string> = new Set(['facebook', 'google_business_profile'])

function materializeSocialDraft(
  appId: string,
  campaignId: string,
  rawContent: SocialRawContent,
  opts: { publishedUrl: string | null; campaignSlug: string | undefined },
): { postId: string; rawContent: SocialRawContent } {
  const post: SocialPost = socialPostRepo.create({
    appId,
    campaignId,
    state: PostState.DRAFT,
    platform: rawContent.platform ?? null,
    payload: rawContent,
  })

  const platform: string | undefined = rawContent.platform
  if (opts.publishedUrl && opts.campaignSlug && platform && CAPTION_LINK_PLATFORMS.has(platform)) {
    const trackedUrl: string = decorateSocialCta({
      publishedUrl: opts.publishedUrl,
      campaignSlug: opts.campaignSlug,
      contentRefId: post.id,
      simpleCampaignId: campaignId,
      platform,
    }).absoluteUrl
    // Rewrite the campaign /lp link only when the caption carries a real conversion CTA token
    // (exact-match, same rule as the rewriter); otherwise append the tracked URL (FB/GMB captions
    // support clickable links). A loose substring check would route prefix-slug collisions
    // (/lp/<slug>-2025) into the rewrite branch, which then no-ops and leaves the minted row unused.
    const decoratedMessage: string = hasCampaignConversionCta(rawContent.message, opts.campaignSlug)
      ? decorateConversionCtaLinks(rawContent.message, opts.campaignSlug, trackedUrl)
      : `${rawContent.message}\n\n${trackedUrl}`
    if (decoratedMessage !== rawContent.message) {
      const decoratedRawContent: SocialRawContent = { ...rawContent, message: decoratedMessage }
      socialPostRepo.update(post.id, { payload: decoratedRawContent })
      logger.info('campaign.social-utm.applied', { appId, campaignId, postId: post.id, platform })
      return { postId: post.id, rawContent: decoratedRawContent }
    }
  }

  return { postId: post.id, rawContent }
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
    assets: jsonArray('assets', z.array(plannedAssetSchema).min(1)).describe('List of planned content pieces'),
    landingPagePath: z.string().describe('Desired slug for the landing page (e.g. "summer-sale", "halloween"). Will be sanitized and frozen as the canonical slug used across all CTAs and the route.'),
    assumptions: jsonArray('assumptions', z.array(z.string()).min(1)).describe('3-4 short plain-language assumptions you inferred about the business (audience, main goal, what to feature). Rendered on the card under "Here\'s what I\'m assuming — tell me if any of this is off" so the owner can correct a wrong guess before anything is built.'),
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
  description: `Save the completed campaign and render the campaign card. Call this ONLY in the SUMMARY step — AFTER all content has been fully generated (landing page built, blog posts written, social posts created, email/ad copy written). This saves the campaign; for a campaign with blog posts, follow it with campaignApplyBlogUtm to add UTM tracking to the blog CTAs.

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
    landingPageSlug: z.string().optional().describe('The canonical campaign slug (the same plan.landingPageSlug used at PLAN — the /lp/<slug> all CTAs point to). Pass it so social post captions get UTM tracking added to their landing-page link.'),
    plannedContent: jsonArray('plannedContent', z.array(z.object({
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
        platform: z.enum(['facebook', 'instagram', 'google_business_profile']).optional().describe('Target platform. facebook / google_business_profile captions carry the tracked landing link; instagram is link-in-bio.'),
      }).optional().describe('For SOCIAL assets ONLY: the generated post body, stored as the editable pre-launch draft. Copy the message/hashtags/callToAction/platform you produced with socialPostCreate.'),
    }).refine(
      (item): boolean => item.assetType !== 'social' || item.rawContent !== undefined,
      { message: 'rawContent is required for social assets — copy the message/hashtags/callToAction/platform you produced with socialPostCreate (a social post cannot be persisted or UTM-tracked without it).' },
    ))).describe('List of planned content items for the campaign'),
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

    // Resolved once for the social-CTA UTM decoration below (social posts are materialized
    // in this loop; the campaign id already exists here, so unlike blog there's no separate
    // post-summary tool). Both are absent on apps without a published site / frozen slug —
    // social drafts then materialize undecorated.
    const campaignSlug: string | undefined = args.landingPageSlug ? sanitizeSlug(args.landingPageSlug) : undefined
    const publishedUrl: string | null = await resolvePublishedUrlFromToolContext(appId, context)

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
      // create its DRAFT social_posts row, decorate the campaign CTA in its caption with
      // UTM tracking (RUBICON-499/500/501), and stamp the resulting post id as contentRefId.
      // The decorated caption is persisted to BOTH the carrier and the content-row
      // projection. Non-social assets, and social teasers without rawContent, leave
      // contentRefId null — their live-content pointer is wired later by a resolver.
      const isSocial: boolean = item.assetType === 'social'
      const materialized: { postId: string; rawContent: SocialRawContent } | undefined =
        isSocial && item.rawContent
          ? materializeSocialDraft(appId, campaign.id, item.rawContent, { publishedUrl, campaignSlug })
          : undefined
      const rawContent: string | undefined = materialized ? serializeSocialRawContent(materialized.rawContent) : undefined
      const contentRefId: string | undefined = materialized?.postId

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
    assets: jsonArray('assets', z.array(z.object({
      assetType: z.enum(['landing-page', 'banner', 'blog', 'social', 'email', 'ad']).describe('Type of asset'),
      externalRef: z.string().describe('Reference: file path for blogs/pages, post ID for social, or description for email/ad'),
      title: z.string().describe('Asset title or headline'),
      scheduledDate: z.string().optional().describe('Scheduled publish/send date (YYYY-MM-DD)'),
      status: z.enum(['draft', 'scheduled', 'published', 'failed']).optional().describe('Current status'),
      contentPreview: z.string().optional().describe('Brief content preview'),
      imageUrl: z.string().optional().describe('URL of the image used for this content'),
    }))).describe('All campaign assets to track'),
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

/**
 * Decorate the campaign landing-page CTA inside generated blog posts with UTM tracking
 * (RUBICON-501, blog half).
 *
 * Runs in SUMMARY, AFTER campaignPlanCreate (the campaign row must exist — marketing_utm
 * references it) and AFTER the build handoff created the blog markdown. For each blog post it
 * mints a marketing_utm row and rewrites the bare `/lp/<slug>` conversion CTA in the markdown
 * to the UTM-decorated RELATIVE link (relative so it survives a later domain change). Only the
 * conversion CTA is touched; incidental in-blog/nav links are left bare (see
 * decorateConversionCtaLinks). Posts that don't link to this campaign are skipped.
 *
 * contentRefId for the act_ token is the blog slug — a stable, frozen per-post id available at
 * this layer without reading posts.json.
 */
export const campaignApplyBlogUtm: SkillToolDefinition = {
  name: 'campaignApplyBlogUtm',
  description: `Decorate the campaign landing-page CTA inside the generated blog posts with UTM tracking. Call this in SUMMARY, AFTER campaignPlanCreate and AFTER the blog posts were created in the build handoff. For each blog post it records UTM attribution and rewrites the bare /lp/<slug> CTA in the markdown to the tracked link; incidental links are left untouched. Pass the campaign's landing slug and the slugs of the blog posts that were created.`,
  parameters: z.object({
    landingPageSlug: z.string().describe('The canonical campaign slug (plan.landingPageSlug) — the /lp/<slug> the CTAs point to.'),
    blogPosts: jsonArray('blogPosts', z.array(z.object({
      slug: z.string().describe('The blog post slug — its src/content/data/blog/<slug>.md filename.'),
      topicSlug: z.string().optional().describe('Topic for utm_term (e.g. the blog topic). Defaults to none.'),
    })).min(1)).describe('The blog posts created for this campaign.'),
  }),
  async execute(args, context) {
    if (!isCampaignsEnabled(context)) {
      logger.warn('campaign-blog-utm.feature_disabled', { appId: context?.metadata?.appId })
      return campaignsDisabledResult()
    }
    const appId: string | undefined = context?.metadata?.appId as string | undefined
    if (!appId) {
      return { success: false, error: 'No appId in context' }
    }

    // The campaign was just persisted by campaignPlanCreate (status 'ready'); marketing_utm
    // references it, so it must exist before this runs.
    const campaign: SimpleCampaign | undefined = campaignRepo
      .findByAppId(appId)
      .find((c: SimpleCampaign): boolean => c.status === SimpleCampaignStatus.Ready)
    if (!campaign) {
      return { success: false, error: 'No ready campaign found — call campaignPlanCreate first.' }
    }

    const publishedUrl: string | null = await resolvePublishedUrlFromToolContext(appId, context)
    if (!publishedUrl) {
      return { success: false, error: 'No published site URL available — a published website is required to generate campaign URLs.' }
    }

    const workspace = createForWorkspace(appId, 'preview')
    if (!workspace) {
      return { success: false, error: 'Workspace unavailable.' }
    }

    const slug: string = sanitizeSlug(args.landingPageSlug)
    const decorated: string[] = []
    const skipped: string[] = []
    const failed: string[] = []

    for (const post of args.blogPosts) {
      const filePath: string = `src/content/data/blog/${post.slug}.md`
      let markdown: string
      try {
        markdown = (await workspace.files.view({ path: filePath })).content
      } catch (error: unknown) {
        // A missing file is a legitimate skip (the post doesn't exist for this app); any other
        // error (supervisor restart, 5xx, permission) means a real CTA may have gone undecorated,
        // so surface it instead of silently bucketing it as skipped.
        if (isDevSupervisorNotFound(error)) {
          skipped.push(post.slug)
          continue
        }
        logger.warn('campaign.blog-utm.read_failed', {
          appId,
          campaignId: campaign.id,
          slug: post.slug,
          error: error instanceof Error ? error.message : String(error),
        })
        failed.push(post.slug)
        continue
      }

      // Only decorate posts that carry a real conversion CTA token for THIS campaign — exact-match,
      // same rule as the rewriter below. A loose substring check would mint a marketing_utm row for
      // prefix-slug collisions (/lp/<slug>-2025) or already-decorated links, leaving an orphan row.
      if (!hasCampaignConversionCta(markdown, slug)) {
        skipped.push(post.slug)
        continue
      }

      // Mints the marketing_utm row (contentRefId = slug) and returns the relative decorated link.
      const relativePath: string = decorateBlogCta({
        publishedUrl,
        campaignSlug: slug,
        contentRefId: post.slug,
        simpleCampaignId: campaign.id,
        topicSlug: post.topicSlug,
      }).relativePath
      const updated: string = decorateConversionCtaLinks(markdown, slug, relativePath)
      if (updated !== markdown) {
        await workspace.files.write({ path: filePath, content: updated })
        decorated.push(post.slug)
      } else {
        skipped.push(post.slug)
      }
    }

    logger.info('campaign.blog-utm.applied', { appId, campaignId: campaign.id, decorated: decorated.length, skipped: skipped.length, failed: failed.length })
    return {
      success: failed.length === 0,
      decorated,
      skipped,
      failed,
      message: `Decorated the campaign CTA in ${decorated.length} blog post(s)${skipped.length ? `; skipped ${skipped.length} (no /lp/${slug} CTA or already decorated)` : ''}${failed.length ? `; ${failed.length} failed to read (see logs)` : ''}.`,
    }
  },
}

export const tools: SkillToolDefinition[] = [
  campaignPlanPropose,
  campaignScaffoldPage,
  campaignPlanCreate,
  campaignCreate,
  campaignApplyBlogUtm,
]
