import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { getKvMemoryStore } from '../../memory/adapters/index.js'
import { customerIdFromContext, workspaceScopeFromAppId } from '../../memory/interfaces/scope.js'
import { getBrandMoodImages } from '../../services/media/brand-mood-images.js'
import { AppMetadataRepository } from '../../database/index.js'
import type { DesignKitRef } from '../../types/design-kit.js'
import { mergeBrandIdentity, type BrandIdentity } from './brand-identity.js'
import { Logger } from '../../logging/index.js'

const logger = Logger.create({ component: 'brand-tool' })
const memoryStore = getKvMemoryStore()

const IDENTITY_KEY = 'brand.identity'
const SUMMARY_KEY = 'brand.summary'
const IMAGERY_KEY = 'brand.imagery'
const PALETTE_KEY = 'brand.colors.palette'
const TYPOGRAPHY_KEY = 'brand.typography'

// Identity field schemas mirror brand-identity.ts (the shared brandBook tool) so
// the `brand.identity` shape stays identical and the brand-data route keeps
// working regardless of which tool wrote it. Kept inline so this design-kit tool
// is self-contained and decoupled from the shared production brand tool.
const personalitySchema = z.object({
  description: z.string().optional(),
  traits: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
}).optional()

const voiceSchema = z.object({
  weAre: z.array(z.string()).optional(),
  weAreNot: z.array(z.string()).optional(),
  sampleCopy: z.object({ headline: z.string(), body: z.string() }).optional(),
}).optional()

const audienceSchema = z.object({
  description: z.string().optional(),
  segments: z.array(z.string()).optional(),
}).optional()

const missionSchema = z.object({
  statement: z.string().optional(),
  story: z.string().optional(),
  values: z.array(z.string()).optional(),
}).optional()

/**
 * Brand Tool (Design Kit Wizard).
 *
 * One consolidated tool for all brand CONTENT — replaces the shared `brandBook`
 * tool plus the separate `memorySet` calls for `brand.imagery` and
 * `brand.summary`. Keeping it design-kit-owned isolates the wizard from the
 * production brand tooling. `set` writes identity (merge), imagery keyword, and
 * summary in a single call; `get` returns the ENTIRE brand in one read so the
 * agent doesn't fan out multiple memory reads.
 */
export const brandAITool: Tool = createTool(
  'Manage all brand content in one call (Design Kit). mode "set" saves/updates the brand identity (voice, tagline, audience, personality, mission), the imagery keyword, and the brand summary — pass any subset; identity merges with existing data. mode "get" returns the ENTIRE brand in one read: identity, summary, imagery (keyword + mood images), colours, typography, and chosen kit. Prefer this over multiple memory reads/writes.',
  z.object({
    mode: z.enum(['set', 'get']).describe('"set" to save/update brand content, "get" to read the entire brand back'),
    brandName: z.string().min(1).optional().describe('Brand or business name'),
    personality: personalitySchema.describe('Brand personality: description and traits'),
    voice: voiceSchema.describe('Brand voice: tone attributes (weAre/weAreNot) and sample copy'),
    tagline: z.string().optional().describe('Brand tagline or slogan'),
    audience: audienceSchema.describe('Target audience: description and segments'),
    mission: missionSchema.describe('Brand mission: statement, origin story, and core values'),
    imageryKeywords: z.string().optional().describe('A single comma-separated string of mood/vibe descriptors for the brand imagery (e.g. "warm artisan linen, earthy tones, golden light, slow fashion") — the basis for the mood-image stock search. Provide ONE string, not an array.'),
    summary: z.string().optional().describe('A 2–3 sentence brand summary'),
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string | undefined
    if (!appId) return '**Error:** No app ID available in context'

    const scope = workspaceScopeFromAppId(appId, customerIdFromContext(context))

    try {
      if (input.mode === 'get') {
        const [identity, summary, imagery, palette, typography, moodImages] = await Promise.all([
          memoryStore.get(scope, IDENTITY_KEY),
          memoryStore.get(scope, SUMMARY_KEY),
          memoryStore.get(scope, IMAGERY_KEY),
          memoryStore.get(scope, PALETTE_KEY),
          memoryStore.get(scope, TYPOGRAPHY_KEY),
          getBrandMoodImages(appId),
        ])

        // Chosen kit comes from app metadata (designKit) — the single source of
        // truth written by the catalog-install tool / ui-kit upload route. Read
        // is best-effort so a metadata hiccup never fails the brand read.
        let kitName: string | undefined
        try {
          const designKit = new AppMetadataRepository().get(appId).designKit as DesignKitRef | undefined
          kitName = designKit?.displayName
        } catch (kitErr) {
          logger.warn('brand.get.designKit.readFailed', { appId, error: kitErr instanceof Error ? kitErr.message : String(kitErr) })
        }

        const imageryValue = (imagery.exists && imagery.value ? imagery.value : {}) as Record<string, unknown>
        const brand = {
          identity: identity.exists ? identity.value : undefined,
          summary: summary.exists ? (summary.value as { text?: string } | undefined)?.text : undefined,
          imagery: (imagery.exists || moodImages.length > 0)
            ? { ...imageryValue, ...(moodImages.length > 0 ? { moodImages } : {}) }
            : undefined,
          colors: palette.exists ? palette.value : undefined,
          typography: typography.exists ? typography.value : undefined,
          kit: kitName ? { name: kitName } : undefined,
        }
        return `**Brand:**\n\n\`\`\`json\n${JSON.stringify(brand, null, 2)}\n\`\`\``
      }

      // mode === 'set'
      const written: string[] = []

      const identityUpdate: BrandIdentity = {}
      if (input.brandName !== undefined) identityUpdate.brandName = input.brandName
      if (input.personality !== undefined) identityUpdate.personality = input.personality
      if (input.voice !== undefined) identityUpdate.voice = input.voice
      if (input.tagline !== undefined) identityUpdate.tagline = input.tagline
      if (input.audience !== undefined) identityUpdate.audience = input.audience
      if (input.mission !== undefined) identityUpdate.mission = input.mission

      if (Object.keys(identityUpdate).length > 0) {
        const existing = await memoryStore.get(scope, IDENTITY_KEY)
        if (!existing.success) {
          logger.warn('brand.set.identity.readFailed', { appId, error: existing.error ?? 'Unknown error' })
          return '**Error:** Failed to read existing brand identity. Cannot safely merge — please try again.'
        }
        const current = (existing.exists && existing.value ? existing.value : {}) as BrandIdentity
        const write = await memoryStore.set(scope, IDENTITY_KEY, mergeBrandIdentity(current, identityUpdate))
        if (!write.success) {
          logger.warn('brand.set.identity.writeFailed', { appId, error: write.error ?? 'Unknown error' })
          return '**Error:** Failed to save brand identity. Please try again.'
        }
        written.push('identity')
      }

      if (input.imageryKeywords !== undefined) {
        const write = await memoryStore.set(scope, IMAGERY_KEY, { keyword: input.imageryKeywords })
        if (!write.success) {
          logger.warn('brand.set.imagery.writeFailed', { appId, error: write.error ?? 'Unknown error' })
          return '**Error:** Failed to save brand imagery. Please try again.'
        }
        written.push('imagery')
      }

      if (input.summary !== undefined) {
        const write = await memoryStore.set(scope, SUMMARY_KEY, { text: input.summary })
        if (!write.success) {
          logger.warn('brand.set.summary.writeFailed', { appId, error: write.error ?? 'Unknown error' })
          return '**Error:** Failed to save brand summary. Please try again.'
        }
        written.push('summary')
      }

      logger.info('brand.set.success', { appId, written })
      return `**Brand updated:** ${written.length > 0 ? written.join(', ') : '(nothing to update)'}`
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('brand.error', { appId, error: message, mode: input.mode })
      return `**Error:** ${message}`
    }
  }
)
