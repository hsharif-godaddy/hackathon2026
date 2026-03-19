import { getModel } from '@airo/ai-lib'
import { llmMetadataContext, type LitellmMetadata } from '@airo/ai-common'
import { buildLitellmMetadataFromContext, LlmCallSource, type ExecutionContext } from '@airo/ai-grants'
import { generateText } from 'ai'
import { propagateAttributes } from '@langfuse/tracing'

import { AppRepository } from '../database/repositories/AppRepository.js'
import { ConversationRepository } from '../database/repositories/ConversationRepository.js'
import { SummaryRepository } from '../database/repositories/SummaryRepository.js'
import { Logger, log } from '../logging/index.js'

const logger = Logger.create({ service: 'video-prompt-generation' })

export class VideoPromptGenerationService {
  private summaryRepo: SummaryRepository
  private conversationRepo: ConversationRepository
  private static appRepo = new AppRepository()

  constructor() {
    this.summaryRepo = new SummaryRepository()
    this.conversationRepo = new ConversationRepository()
  }

  /**
   * Generates a detailed video prompt based on the app's conversation summary
   *
   * @param appId The app ID to get the summary for
   * @param socketId Optional socket ID for grant-aware billing (when called from websocket context)
   * @returns A structured video prompt or null if generation fails
   */
  async generateVideoPrompt(appId: string, socketId?: string): Promise<string | null> {
    try {
      if (!appId || appId.trim().length === 0) {
        logger.warn('video-prompt-generation.empty-appid', {})
        return null
      }

      // Get the latest conversation summary for the app
      const summary = await this.summaryRepo.findLatestForApp(appId)

      let contentText: string

      if (!summary?.summaryText) {
        logger.warn('video-prompt-generation.no-summary', { appId })

        const conversation = await this.conversationRepo.getLatestForApp(appId)

        if (!conversation) {
          logger.warn('video-prompt-generation.no-conversation', { appId })
          return null
        }

        const messages = await this.conversationRepo.getMessages(conversation.id)

        if (messages.length === 0) {
          logger.warn('video-prompt-generation.no-messages', { appId })
          return null
        }

        contentText = messages
          .map(msg => `${msg.sender === 'user' ? 'User' : 'Agent'}: ${msg.content}`)
          .join('\n\n')

        logger.info('video-prompt-generation.using-messages', {
          appId,
          messageCount: messages.length,
          contentLength: contentText.length
        })
      } else {
        contentText = summary.summaryText

        logger.info('video-prompt-generation.summary-found', {
          appId,
          summaryLength: summary.summaryText.length
        })
      }

      // Get the model using ai-lib's unified provider
      // Use 'sonnet' for high-quality video prompt generation
      const model = await getModel('sonnet')

      // Look up app info for grant-aware billing
      // Background tasks may not have socketId, but can use subscriptionId for grant lookup
      const app = VideoPromptGenerationService.appRepo.findById(appId)
      const subscriptionId = app?.subscriptionId
      const customerId = app?.customerId

      // Build execution context for grant-aware metadata
      // Include subscriptionId so buildLitellmMetadataFromContext can use subscription-based grant lookup
      const executionContext: ExecutionContext | undefined = (appId || socketId || subscriptionId) ? {
        socketId,
        metadata: {
          appId,
          subscriptionId,
          customerId,
        }
      } : undefined

      // Additional tags to always include (service-specific)
      const additionalTags = ['source:tool-llm', 'source:video-prompt-generation']

      // Build metadata using the grants-aware helper
      let metadata: LitellmMetadata | null = null
      if (executionContext) {
        metadata = buildLitellmMetadataFromContext(executionContext, {
          source: LlmCallSource.ToolVideoPrompt,
        })
      }

      // Merge additional tags into metadata from grants-aware helper
      if (metadata) {
        const mergedTags = [...new Set([...(metadata.tags || []), ...additionalTags])]
        metadata = { ...metadata, tags: mergedTags }
      }

      // Fallback to existing context if buildLitellmMetadataFromContext returned null
      // (feature flag off or no grants available)
      if (!metadata) {
        const existingMetadata = llmMetadataContext.getStore();
        let userIdentifier = existingMetadata?.user;

        if (!userIdentifier) {
          userIdentifier = subscriptionId || customerId;
        }

        const mergedTags = [...new Set([
          ...(existingMetadata?.tags || []),
          ...(existingMetadata ? [] : [
            customerId ? `cid:${customerId}` : undefined,
            `appId:${appId}`
          ].filter((t): t is string => !!t)),
          'source:tool-llm',
          'source:video-prompt-generation'
        ])];

        metadata = {
          ...(userIdentifier && { user: userIdentifier }),
          tags: mergedTags
        };
      }

      const attributes: { userId: string; sessionId?: string; metadata?: Record<string, string> } = { userId: appId }
      if (socketId) {attributes.sessionId = socketId}
      if (customerId) {attributes.metadata = { customerId }}

      const generateVideoPromptWithAttributes = async () =>
        propagateAttributes(attributes, async () =>
          generateText({
            model,
            system: `You are an expert video production and creative director. Your task is to generate a detailed, professional video prompt that can be used to create promotional videos for businesses.
          
[CRITICAL: The video prompt should be in the same language as the business/app summary. Do not use any random data which is not available in summary.]

Based on the business/app summary provided, create a comprehensive video prompt following this EXACT structure:

**Subject:**
[Describe the main subject/focus of the video - the business, product, or service in an eye-catching way]

**Action:**
[Describe the key actions and movements happening in the video - what people are doing, how products are being used]

**Scene:**
[Describe the setting, location, and environment where the video takes place]

**Camera Movement:**
[Describe the camera angles and movements - wide shots, tracking shots, close-ups, etc.]

**Lighting:**
[Describe the lighting style - natural daylight, warm tones, soft highlights, etc.]

**Style:**
[Describe the overall production style - professional, vibrant, modern, commercial, etc. and target platform]

**Outro (Mandatory – Always End the Video This Way):**
[Describe the branded outro with:
- Business name and logo
- Tagline (create one based on the business)
- Location/service area
- Call to action
- Final shot composition
- Outro should be 2-3 seconds long
- Note that it should be suitable for social media platforms]

IMPORTANT GUIDELINES:
- Use the business/app summary to understand what the business does and what makes it unique
- Make the prompt cinematic, engaging, and suitable for professional video production
- Focus on creating promotional content that drives engagement and conversions
- Keep the tone energetic, positive, and brand-focused
- Ensure the outro is polished and memorable
- Do not add data which is not provided in the business/app summary like email, phone number, etc. [Important]
- Use vivid, descriptive language that a video production AI can understand
- Make it suitable for social media platforms (Instagram Reels, YouTube Shorts, TikTok)
- The video will be 12 seconds in PORTRAIT format (720x1280 - vertical mobile format), so plan the pacing accordingly
- Frame subjects vertically and use vertical compositions suitable for mobile viewing`,
            prompt: `Business/App Summary:
${contentText}

Generate a detailed 12-second video prompt following the exact structure provided in the system prompt.`,
            temperature: 0.7,
            maxOutputTokens: 1500,
            experimental_telemetry: { isEnabled: true, functionId: 'video-prompt-generation' },
          })
        )

      const result = metadata
        ? await llmMetadataContext.run(metadata, generateVideoPromptWithAttributes)
        : await generateVideoPromptWithAttributes()

      const videoPrompt = result.text?.trim()

      if (videoPrompt && videoPrompt.length > 0) {
        logger.info('video-prompt-generation.generated', {
          appId,
          promptLength: videoPrompt.length,
          contentLength: contentText.length
        })
        return videoPrompt
      }

      logger.warn('video-prompt-generation.empty-content', { appId })
      return null
    } catch (error) {
      log.error(logger, 'video-prompt-generation.error', error as Error, { appId })
      return null
    }
  }
}

const videoPromptGenerationService = new VideoPromptGenerationService()

export function getVideoPromptGenerationService(): VideoPromptGenerationService {
  return videoPromptGenerationService
}
