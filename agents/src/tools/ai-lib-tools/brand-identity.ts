import { createTool, type Tool } from '@airo/ai-lib'
import type {
  BrandDataAudience,
  BrandDataIconography,
  BrandDataLayout,
  BrandDataMission,
  BrandDataPersonality,
  BrandDataPhotography,
  BrandDataToneMatrix,
  BrandDataVoice,
} from '@airo/shared/brand-data'
import { z } from 'zod'
import { MemoryRepository } from '../../database/repositories/MemoryRepository.js'
import { Logger } from '../../logging/index.js'

const logger = Logger.create({ component: 'brand-identity-tool' })
const memoryRepo = new MemoryRepository()

const MEMORY_KEY = 'brand.identity'

/**
 * Structured brand identity data stored in memory.
 * Replaces fragile markdown parsing of design.* keys.
 * Sub-interfaces derive from @airo/shared/brand-data to keep the API contract in sync.
 *
 * Note: toneMatrix is stored as a flat array here. The brand-data route wraps it
 * in `{ contexts: [...] }` to match BrandDataToneMatrix for the client.
 */
export interface BrandIdentity {
  brandName?: string
  personality?: BrandDataPersonality
  voice?: BrandDataVoice
  tagline?: string
  audience?: BrandDataAudience
  iconography?: BrandDataIconography
  layout?: BrandDataLayout
  photography?: BrandDataPhotography
  mission?: BrandDataMission
  toneMatrix?: BrandDataToneMatrix['contexts']
}

const personalitySchema = z.object({
  description: z.string().optional(),
  traits: z.array(z.object({
    name: z.string(),
    description: z.string(),
  })).optional(),
}).optional()

const voiceSchema = z.object({
  weAre: z.array(z.string()).optional(),
  weAreNot: z.array(z.string()).optional(),
  sampleCopy: z.object({
    headline: z.string(),
    body: z.string(),
  }).optional(),
}).optional()

const audienceSchema = z.object({
  description: z.string().optional(),
  segments: z.array(z.string()).optional(),
}).optional()

const iconographySchema = z.object({
  style: z.string().optional(),
  tags: z.array(z.string()).optional(),
}).optional()

const layoutSchema = z.object({
  grid: z.string().optional(),
  spacing: z.string().optional(),
  components: z.string().optional(),
}).optional()

const photographySchema = z.object({
  style: z.string().optional(),
  subjects: z.array(z.string()).optional(),
  avoid: z.array(z.string()).optional(),
  treatments: z.array(z.string()).optional(),
}).optional()

const missionSchema = z.object({
  statement: z.string().optional(),
  story: z.string().optional(),
  values: z.array(z.string()).optional(),
}).optional()

const toneMatrixSchema = z.array(z.object({
  context: z.string(),
  description: z.string().optional(),
  tone: z.string(),
  language: z.string().optional(),
  purpose: z.string().optional(),
  examples: z.array(z.string()).optional(),
})).optional()

/**
 * Deep merge brand identity objects. New values overwrite old ones at the leaf level,
 * but unset fields in the update don't remove existing data.
 */
export function mergeBrandIdentity(existing: BrandIdentity, update: BrandIdentity): BrandIdentity {
  const merged: BrandIdentity = { ...existing }

  if (update.brandName !== undefined) {
    merged.brandName = update.brandName
  }
  if (update.personality !== undefined) {
    merged.personality = update.personality
  }
  if (update.voice !== undefined) {
    merged.voice = update.voice
  }
  if (update.tagline !== undefined) {
    merged.tagline = update.tagline
  }
  if (update.audience !== undefined) {
    merged.audience = update.audience
  }
  if (update.iconography !== undefined) {
    merged.iconography = update.iconography
  }
  if (update.layout !== undefined) {
    merged.layout = update.layout
  }
  if (update.photography !== undefined) {
    merged.photography = update.photography
  }
  if (update.mission !== undefined) {
    merged.mission = update.mission
  }
  if (update.toneMatrix !== undefined) {
    merged.toneMatrix = update.toneMatrix
  }

  return merged
}

/**
 * Brand Book Tool for AI-Lib
 * Saves and retrieves structured brand identity data for the Brand Book view.
 * Use this tool whenever the user asks about "brand book", "brand guidelines", or brand identity.
 * Uses merge semantics so agents can set one field at a time without losing others.
 */
export const brandIdentityAITool: Tool = createTool(
  'Save or retrieve brand book data (brandName, personality, voice, audience, iconography, layout, tagline, photography, mission, toneMatrix). Use this tool when the user asks about their "brand book" or "brand guidelines". Use mode "set" to save/update data (merges with existing), "get" to retrieve current data. Do NOT create pages or files for brand book requests — use this tool instead.',
  z.object({
    mode: z.enum(['set', 'get']).describe('Operation mode: "set" to save/update identity data, "get" to retrieve current data'),
    brandName: z.string().min(1).optional().describe('Brand or business name'),
    personality: personalitySchema.describe('Brand personality: description and traits'),
    voice: voiceSchema.describe('Brand voice: tone attributes (weAre/weAreNot) and sample copy'),
    tagline: z.string().optional().describe('Brand tagline or slogan'),
    audience: audienceSchema.describe('Target audience: description and segments'),
    iconography: iconographySchema.describe('Icon style: description and tags'),
    layout: layoutSchema.describe('Layout guidelines: grid, spacing, components'),
    photography: photographySchema.describe('Photography style: visual direction, preferred subjects, things to avoid, and image treatments'),
    mission: missionSchema.describe('Brand mission: statement, origin story, and core values'),
    toneMatrix: toneMatrixSchema.describe('Tone matrix: how brand voice adapts across contexts. Each entry has context, description, tone, language style, purpose, and example copy.'),
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string | undefined

    if (!appId) {
      return '**Error:** No app ID available in context'
    }

    try {
      if (input.mode === 'get') {
        const result = await memoryRepo.get(appId, MEMORY_KEY)
        if (!result.success) {
          logger.warn('brandIdentity.get.readFailed', { appId, error: result.error ?? 'Unknown error' })
          return '**Error:** Failed to read brand identity data. Please try again.'
        }
        if (!result.exists || !result.value) {
          return '**Brand Identity:** No brand identity data saved yet.'
        }
        const identity = result.value as BrandIdentity
        return `**Brand Identity Data:**\n\n${JSON.stringify(identity, null, 2)}`
      }

      // mode === 'set'
      const update: BrandIdentity = {}
      if (input.brandName !== undefined) update.brandName = input.brandName
      if (input.personality !== undefined) update.personality = input.personality
      if (input.voice !== undefined) update.voice = input.voice
      if (input.tagline !== undefined) update.tagline = input.tagline
      if (input.audience !== undefined) update.audience = input.audience
      if (input.iconography !== undefined) update.iconography = input.iconography
      if (input.layout !== undefined) update.layout = input.layout
      if (input.photography !== undefined) update.photography = input.photography
      if (input.mission !== undefined) update.mission = input.mission
      if (input.toneMatrix !== undefined) update.toneMatrix = input.toneMatrix

      // Read existing, merge, save
      const existing = await memoryRepo.get(appId, MEMORY_KEY)
      if (!existing.success) {
        logger.warn('brandIdentity.set.readFailed', { appId, error: existing.error ?? 'Unknown error' })
        return '**Error:** Failed to read existing brand identity. Cannot safely merge — please try again.'
      }
      const current = (existing.exists && existing.value ? existing.value : {}) as BrandIdentity
      const merged = mergeBrandIdentity(current, update)

      const writeResult = await memoryRepo.set(appId, MEMORY_KEY, merged)
      if (!writeResult.success) {
        logger.warn('brandIdentity.set.writeFailed', { appId, error: writeResult.error ?? 'Unknown error' })
        return '**Error:** Failed to save brand identity data. Please try again.'
      }

      const updatedFields = Object.keys(update).filter(k => update[k as keyof BrandIdentity] !== undefined)

      logger.info('brandIdentity.set.success', {
        appId,
        updatedFields,
        totalFields: Object.keys(merged).filter(k => merged[k as keyof BrandIdentity] !== undefined).length,
      })

      return `**Brand Identity Updated**\n\nUpdated: ${updatedFields.join(', ')}`
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('brandIdentity.error', { appId, error: errorMessage, mode: input.mode })
      return `**Error:** ${errorMessage}`
    }
  }
)
