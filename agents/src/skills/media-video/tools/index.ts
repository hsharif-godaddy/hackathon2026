import { buildLitellmMetadataFromContext, LlmCallSource, type ExecutionContext } from '@airo/ai-grants';
import { generateSoraVideo, type SoraVideoDuration } from '@airo/ai-lib';
import { BudgetExceededError, llmMetadataContext } from '@airo/ai-common';
import type { SkillToolDefinition } from '@airo/ai-skills';
import { z } from 'zod';

import { appRepository } from '../../../database/repositories/index.js';
import { logger } from '../../../logging/index.js';
import { captionFromPrompt } from '../../../services/MediaCaptionService.js';
import { mediaManifestService, type MediaSlot } from '../../../services/MediaManifestService.js';
import { uploadGeneratedVideo } from '../../../utils/upload-generated-video.js';

const GENERATED_VIDEO_CONFIRMATION_ERROR = 'Generated video requires explicit confirmation. Use the media tool with mediaType video for stock clips, or ask the user to confirm generated video first.';

function hasGeneratedVideoConfirmation(userMessage: unknown): boolean {
  if (typeof userMessage !== 'string') {
    return false;
  }
  const normalized = userMessage.trim().toLowerCase();
  return normalized === 'confirmed'
    || normalized === 'i understand, continue'
    || normalized.endsWith('\nconfirmed')
    || normalized.endsWith('\ni understand, continue');
}

const GenerateVideoInputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(1000)
    .describe('Text description of the video to generate. For on-site use (hero, background, embedded video), prefer loop-friendly prompts: continuous cyclic motion, steady camera, seamless loopable scene — avoid one-time actions or strong start/end camera moves.'),
  orientation: z
    .enum(['landscape', 'portrait'])
    .default('landscape')
    .describe('landscape (default) or portrait'),
  duration: z
    .coerce
    .number()
    .int()
    .refine((val) => [4, 8, 12].includes(val), {
      message: 'Duration must be 4, 8, or 12 seconds',
    })
    .describe('Seconds: 4, 8, or 12 (Sora-2 supported durations)'),
  slotName: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9/_-]*[a-z0-9]$/i, 'Slot name must be a valid path (alphanumeric, slashes, hyphens, underscores)')
    .describe('Media slot path for this video. When replacing an existing image/video, use the EXACT existing slot path (e.g. "pages/home/featured-1"). For new placements, use standard naming (e.g. "pages/about/hero"). Look at the source code to find the current slot path from /airo-assets/images/ or /airo-assets/videos/ URLs.'),
  userConfirmed: z
    .literal(true)
    .describe(
      'Must be true only after the user explicitly confirmed via askQuestion that they want to proceed with expensive AI video generation.'
    ),
});

type GenerateVideoInput = z.infer<typeof GenerateVideoInputSchema>;

export const generateVideoTool: SkillToolDefinition = {
  name: 'generate_video',
  description:
    'Generate a video from a text prompt using Sora-2 (expensive, up to 5 minutes per clip, not reliable for complex prompts). Requires userConfirmed=true after askQuestion approval. Prefer the media tool with mediaType video for free stock clips when the user needs multiple videos. Always provide slotName.',

  parameters: GenerateVideoInputSchema,

  async execute(input: GenerateVideoInput, context?: unknown) {
    const toolContext = context as {
      metadata?: {
        appId?: string;
        customerId?: string;
        subscriptionId?: string;
        budgetServiceEnabled?: boolean;
        bmsBudgetId?: string;
        budgetSessionId?: string;
        traceId?: string;
        _userMessage?: string;
      };
      socketId?: string;
    };
    const appId = toolContext.metadata?.appId;
    const socketId = toolContext.socketId;
    const budgetServiceEnabled = toolContext.metadata?.budgetServiceEnabled === true;
    const bmsBudgetId = toolContext.metadata?.bmsBudgetId;

    logger.info('skills.media-video.tools.generate_video.start', {
      promptLength: input.prompt.length,
      orientation: input.orientation,
      duration: input.duration,
      appId,
    });

    if (!appId) {
      logger.error('skills.media-video.tools.generate_video.no_app', { appId });
      return { error: 'Unable to upload generated video without app context' };
    }

    const app = appRepository.findById(appId);
    const customerId = app?.customerId;

    if (!customerId) {
      logger.error('skills.media-video.tools.generate_video.no_customer', { appId });
      return { error: 'Unable to determine customer identity for video generation' };
    }

    if (!hasGeneratedVideoConfirmation(toolContext.metadata?._userMessage)) {
      logger.warn('skills.media-video.tools.generate_video.confirmation_required', { appId, socketId });
      return { error: GENERATED_VIDEO_CONFIRMATION_ERROR };
    }

    const executionContext: ExecutionContext = {
      socketId,
      metadata: {
        appId,
        customerId,
        subscriptionId: toolContext.metadata?.subscriptionId ?? app.subscriptionId,
        budgetServiceEnabled,
        bmsBudgetId,
        budgetSessionId: toolContext.metadata?.budgetSessionId,
        ...(toolContext.metadata?.traceId && { traceId: toolContext.metadata.traceId }),
      },
    };

    const litellmMetadata = buildLitellmMetadataFromContext(executionContext, {
      source: LlmCallSource.ToolVideoGenerate,
    });

    if (!litellmMetadata?.user) {
      logger.error('skills.media-video.tools.generate_video.grants_exhausted', { appId, socketId });
      return { error: 'Video generation is expensive and credit grants are exhausted. Recommend the media tool with mediaType video for free stock clips instead of AI generation.' };
    }

    const budgetUserId = litellmMetadata.user;

    return await llmMetadataContext.run(litellmMetadata, async function generateVideoWithBilling() {
      let soraResult: Awaited<ReturnType<typeof generateSoraVideo>>;
      try {
        soraResult = await generateSoraVideo({
          prompt: input.prompt,
          orientation: input.orientation,
          duration: input.duration as SoraVideoDuration,
        });
      } catch (err) {
        if (BudgetExceededError.isInstance(err)) {
          logger.warn('skills.media-video.tools.generate_video.budget_exceeded', {
            appId,
            socketId,
            budgetUserId,
            statusCode: err.statusCode,
          });
          return {
            error:
              'Generated video budget exceeded. Use the media tool with mediaType video for stock clips instead of generated video.',
          };
        }
        throw err;
      }

      const url = await uploadGeneratedVideo(appId, soraResult.buffer);

      logger.info('skills.media-video.tools.generate_video.success', {
        videoId: soraResult.videoId,
        appId,
        budgetUserId,
      });

      let normalizedSlot = input.slotName.trim().replace(/^\/+|\/+$/g, '');
      let manifestWriteSuccess = false;
      if (normalizedSlot) {
        try {
          const existingManifest = await mediaManifestService.getManifest(appId);
          if (existingManifest.success && existingManifest.manifest) {
            const manifestSlots = Object.keys(existingManifest.manifest);
            if (!manifestSlots.includes(normalizedSlot)) {
              const match = manifestSlots.find((s) => {
                if (s === normalizedSlot) return true;
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
          const existingSlot = existingManifest.manifest?.[normalizedSlot];
          const previousAiUrls = existingSlot?.aiGeneratedUrls || [];
          const mergedAiUrls = [url, ...previousAiUrls.filter((u: string) => u !== url)].slice(0, 20);
          const caption = await captionFromPrompt(input.prompt);
          const slotEntry: MediaSlot = {
            ...existingSlot,
            mediaType: 'video',
            currentUrl: url,
            searchQuery: caption,
            caption,
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

      return {
        structuredContent: {
          url,
          sessionId: soraResult.videoId,
          slotUrl: manifestWriteSuccess ? `/airo-assets/videos/${normalizedSlot}` : undefined,
        },
      };
    });
  },

  config: {
    // 330s = 300s Sora poll ceiling + buffer for upload/manifest writes
    timeout: 330000,
  },
};
