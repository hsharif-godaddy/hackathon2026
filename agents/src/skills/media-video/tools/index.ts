import { z } from 'zod';
import { logger } from '../../../logging/index.js';
import { grantSessionManager } from '@airo/ai-grants';
import type { SkillToolDefinition } from '@airo/ai-skills';
import { imagegenService } from '../../../services/ImagegenService.js';
import { appRepository } from '../../../database/repositories/index.js';
import { mediaManifestService, type MediaSlot } from '../../../services/MediaManifestService.js';

const GenerateVideoInputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(1000)
    .describe('Text description of the video to generate'),
  orientation: z
    .enum(['landscape', 'portrait'])
    .default('landscape')
    .describe('landscape (default) or portrait'),
  duration: z
    .coerce
    .number()
    .int()
    .refine((val) => [5, 6, 7, 8].includes(val), {
      message: 'Duration must be 5, 6, 7, or 8 seconds',
    })
    .describe('Seconds: 5, 6, 7, or 8'),
  slotName: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9/_-]*[a-z0-9]$/i, 'Slot name must be a valid path (alphanumeric, slashes, hyphens, underscores)')
    .describe('Media slot path for this video. When replacing an existing image/video, use the EXACT existing slot path (e.g. "pages/home/featured-1"). For new placements, use standard naming (e.g. "pages/about/hero"). Look at the source code to find the current slot path from /airo-assets/images/ or /airo-assets/videos/ URLs.'),
});

type GenerateVideoInput = z.infer<typeof GenerateVideoInputSchema>;

export const generateVideoTool: SkillToolDefinition = {
  name: 'generate_video',
  description:
    'Generate a video from a text prompt. Always provide slotName to register in the Media Panel. When replacing existing media, use the exact existing slot path.',

  parameters: GenerateVideoInputSchema,

  async execute(input: GenerateVideoInput, context?: unknown) {
    const appId = (context as { metadata?: { appId?: string } })?.metadata?.appId;
    const socketId = (context as { socketId?: string })?.socketId;

    logger.info('skills.media-video.tools.generate_video.start', {
      promptLength: input.prompt.length,
      orientation: input.orientation,
      duration: input.duration,
      appId,
    });

    // 1. Get customer context from app database
    const app = appId ? appRepository.findById(appId) : null;
    const customerId = app?.customerId;

    if (!customerId) {
      logger.error('skills.media-video.tools.generate_video.no_customer', { appId });
      return { error: 'Unable to determine customer identity for video generation' };
    }

    // 2. Get budget user from grant system
    const budgetUserId = socketId
      ? grantSessionManager.getCurrentUserId(socketId, customerId)
      : customerId;

    if (!budgetUserId) {
      logger.error('skills.media-video.tools.generate_video.grants_exhausted', { appId, socketId });
      return { error: 'All credit grants have been exhausted. Please purchase additional credits to generate videos.' };
    }

    // 3. Call imagegen API (polls internally until complete)
    const result = await imagegenService.generateVideo({
      description: input.prompt,
      orientation: input.orientation,
      duration: input.duration,
      customerId,
      budgetUserId,
    });

    logger.info('skills.media-video.tools.generate_video.success', {
      sessionId: result.sessionId,
    });

    // 4a. Register video in the media manifest so it appears in the Media Panel.
    let normalizedSlot = input.slotName.trim().replace(/^\/+|\/+$/g, '');
    let manifestWriteSuccess = false;
    if (appId && normalizedSlot) {
      try {
      // Resolve slot name: if it doesn't exist in manifest, try to find an exact path-suffix match.
      // Only match when the candidate ends with the full normalized path AND the preceding char is '/' or start-of-string,
      // preventing partial segment collisions (e.g. "about/hero" must not match "pages/home/hero").
      const existingManifest = await mediaManifestService.getManifest(appId);
      if (existingManifest.success && existingManifest.manifest) {
        const manifestSlots = Object.keys(existingManifest.manifest);
        if (!manifestSlots.includes(normalizedSlot)) {
          const match = manifestSlots.find((s) => {
            if (s === normalizedSlot) return true;
            // Full-segment suffix: candidate must end with "/normalizedSlot"
            return s.endsWith('/' + normalizedSlot);
          });
          if (match) {
            logger.info('skills.media-video.tools.generate_video.slot_resolved', {
              appId,
              requested: normalizedSlot,
              resolved: match,
            });
            normalizedSlot = match;
          }
        }
      }

      const now = new Date().toISOString();
      // Merge with existing slot data to preserve alternatives and previous AI generations
      const existingSlot = existingManifest.manifest?.[normalizedSlot];
      const previousAiUrls = existingSlot?.aiGeneratedUrls || [];
      const mergedAiUrls = [result.url, ...previousAiUrls.filter((u: string) => u !== result.url)].slice(0, 20);
      const slotEntry: MediaSlot = {
        ...existingSlot,
        mediaType: 'video',
        currentUrl: result.url,
        searchQuery: input.prompt,
        alternatives: existingSlot?.alternatives || [],
        aiGeneratedUrls: mergedAiUrls,
        userModified: true,
        createdAt: existingSlot?.createdAt || now,
        lastUpdated: now,
      };

      const manifestResult = await mediaManifestService.setSlot(appId, normalizedSlot, slotEntry, true);
      if (manifestResult.success) {
        manifestWriteSuccess = true;
        logger.info('skills.media-video.tools.generate_video.manifest_updated', {
          appId,
          slotName: normalizedSlot,
        });
      } else {
        logger.error('skills.media-video.tools.generate_video.manifest_update_failed', {
          appId,
          slotName: normalizedSlot,
          error: manifestResult.error,
        });
      }
      } catch (err) {
        logger.error('skills.media-video.tools.generate_video.manifest_write_error', {
          appId,
          slotName: normalizedSlot,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 5. Return structured result
    return {
      structuredContent: {
        url: result.url,
        sessionId: result.sessionId,
        slotUrl: manifestWriteSuccess ? `/airo-assets/videos/${normalizedSlot}` : undefined,
      },
    };
  },

  config: {
    timeout: 330000, // 5.5 minutes (poll timeout is 5 min, add buffer)
  },
};
