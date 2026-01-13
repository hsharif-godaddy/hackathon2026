import { getModel, llmMetadataContext, type LitellmMetadata } from '@airo/ai-lib'
import { generateText } from 'ai'
import { Logger, log } from '../logging/index.js'
import { SummaryRepository } from '../database/repositories/SummaryRepository.js'

const logger = Logger.create({ service: 'video-prompt-generation' })

export class VideoPromptGenerationService {
  private summaryRepo: SummaryRepository

  constructor() {
    this.summaryRepo = new SummaryRepository()
  }

  /**
   * Generates a detailed video prompt based on the app's conversation summary
   *
   * @param appId The app ID to get the summary for
   * @returns A structured video prompt or null if generation fails
   */
  async generateVideoPrompt(appId: string): Promise<string | null> {
    try {
      if (!appId || appId.trim().length === 0) {
        logger.warn('video-prompt-generation.empty-appid', {})
        return null
      }

      // Get the latest conversation summary for the app
      const summary = await this.summaryRepo.findLatestForApp(appId)

      if (!summary || !summary.summaryText) {
        logger.warn('video-prompt-generation.no-summary', { appId })
        return null
      }

      logger.info('video-prompt-generation.summary-found', {
        appId,
        summaryLength: summary.summaryText.length
      })

      // Get the model using ai-lib's unified provider
      // Use 'sonnet' for high-quality video prompt generation
      const model = await getModel('sonnet')

      // Create metadata for video prompt generation
      const metadata: LitellmMetadata = {
        tags: ['source:video-prompt-generation', `appId:${appId}`]
      }

      // Generate video prompt using AI with metadata context
      const result = await llmMetadataContext.run(metadata, async () => {
        return await generateText({
          model,
          system: `You are an expert video production and creative director. Your task is to generate a detailed, professional video prompt that can be used to create promotional videos for businesses.

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
- Note that it should be suitable for social media platforms]

IMPORTANT GUIDELINES:
- Use the business/app summary to understand what the business does and what makes it unique
- Make the prompt cinematic, engaging, and suitable for professional video production
- Focus on creating promotional content that drives engagement and conversions
- Keep the tone energetic, positive, and brand-focused
- Ensure the outro is polished and memorable
- Use vivid, descriptive language that a video production AI can understand
- Make it suitable for social media platforms (Instagram Reels, YouTube Shorts, TikTok)
- The video will be 12 seconds in landscape format (1280x720), so plan the pacing accordingly`,
          prompt: `Business/App Summary:
${summary.summaryText}

Generate a detailed 12-second video prompt following the exact structure provided in the system prompt.`,
          temperature: 0.7,
          maxOutputTokens: 1500,
          experimental_telemetry: { isEnabled: true, functionId: 'video-prompt-generation' },
        })
      })

      const videoPrompt = result.text?.trim()

      if (videoPrompt && videoPrompt.length > 0) {
        logger.info('video-prompt-generation.generated', {
          appId,
          promptLength: videoPrompt.length,
          summaryLength: summary.summaryText.length
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
