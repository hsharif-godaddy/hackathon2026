import { z } from 'zod';
import { logger } from '../../../logging/index.js';
import { grantSessionManager } from '@airo/ai-grants';
import type { SkillToolDefinition } from '@airo/ai-skills';
import { imagegenService } from '../../../services/ImagegenService.js';
import { appRepository } from '../../../database/repositories/index.js';

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
});

type GenerateVideoInput = z.infer<typeof GenerateVideoInputSchema>;

export const generateVideoTool: SkillToolDefinition = {
  name: 'generate_video',
  description:
    'Generate a video from a text prompt. Returns video URL.',

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

    // 4. Return structured result
    return {
      structuredContent: {
        url: result.url,
        sessionId: result.sessionId,
      },
    };
  },

  config: {
    timeout: 330000, // 5.5 minutes (poll timeout is 5 min, add buffer)
  },
};
