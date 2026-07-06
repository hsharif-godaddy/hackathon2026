import { SocialPost, PostImageData } from '../../types/social-posts.js'
import { createTool, type Tool } from '@airo/ai-lib'
import { logger } from '../../logging/index.js'
import { SocialPostRepository } from '../../database/repositories/SocialPostRepository.js'
import { PostState } from '../../types/social.js'
import { findMedia } from '../media-search-tool.js'
import { z } from 'zod'

/**
 * Generate a unique ID for a social post
 * @returns A unique social post identifier
 */
export function generatePostId(): string {
  return `post_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

const socialPostRepo = new SocialPostRepository()

/**
 * Normalize time format to 24-hour format for TimePicker
 * TimePicker expects 24-hour format internally (e.g., "16:00") regardless of hour12 display setting
 * Also rounds up to nearest 15-minute interval since TimePicker only accepts 15-minute increments
 * @param timeString The time string to normalize (e.g., "4:12 PM", "16:07")
 * @returns Normalized 24-hour time string rounded to 15-min interval (e.g., "16:15") or undefined if invalid
 */
function normalizeTimeFormat(timeString: string | undefined): string | undefined {
  if (!timeString) return undefined

  // Match time pattern and extract components
  const timeMatch = timeString.match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM|am|pm|a\.m\.|p\.m\.)?$/i)
  if (!timeMatch) return undefined

  let hours = parseInt(timeMatch[1]!, 10)
  let minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0
  const period = timeMatch[3]?.toUpperCase().replace(/\./g, '')

  // If AM/PM is present, convert to 24-hour format
  if (period === 'PM' && hours !== 12) {
    hours += 12
  } else if (period === 'AM' && hours === 12) {
    hours = 0
  } else if (!period) {
    // Already in 24-hour format, just validate
    if (hours < 0 || hours > 23) {
      return undefined
    }
  } else if (period && period !== 'AM' && period !== 'PM') {
    return undefined
  }

  // Validate minutes
  if (minutes > 59) {
    return undefined
  }

  // Round up to nearest 15-minute interval
  // If minutes are not already on a 15-min interval, round up
  const remainder = minutes % 15
  if (remainder !== 0) {
    minutes = minutes + (15 - remainder)

    // Handle hour overflow (e.g., 8:58 rounds to 9:00)
    if (minutes >= 60) {
      hours += 1
      minutes = 0

      // Handle day overflow (e.g., 23:58 rounds to 00:00)
      if (hours >= 24) {
        hours = 0
      }
    }
  }

  // Format: "HH:MM" (24-hour format with leading zeros)
  const hoursStr = String(hours).padStart(2, '0')
  const minutesStr = String(minutes).padStart(2, '0')
  return `${hoursStr}:${minutesStr}`
}

/**
 * Validate input parameters for post creation
 * @param mode The generation mode (single or multiple)
 * @param platform The target platform(s)
 * @param includeImages Whether images are requested
 * @param appId The application ID
 * @throws Error if validation fails
 */
function validateInputParameters(
  mode: string,
  platform: string,
  includeImages: boolean,
  appId: string | undefined
): void {
  if (includeImages && !appId) {
    throw new Error('App ID is required for image generation/search and is not available in context')
  }
}

/**
 * Normalize post count based on mode
 * @param posts The array of posts
 * @param mode The generation mode
 * @param count The requested count
 * @returns Normalized posts array
 */
function normalizePostCount(posts: SocialPost[], mode: string, count: number): SocialPost[] {
  if (posts.length === 0) {
    throw new Error('No posts were generated. Please provide post content in the posts array.')
  }

  if (mode === 'single' && posts.length > 1) {
    logger.warn('socialPostCreate.post_count.adjusted', {
      originalCount: posts.length,
      adjustedCount: 1,
      mode
    })
    return posts[0] ? [posts[0]] : []
  }

  if (mode === 'multiple') {
    const targetCount = Math.min(Math.max(count, 1), 5)

    if (posts.length < targetCount) {
      logger.warn('socialPostCreate.post_count.insufficient', {
        providedCount: posts.length,
        requestedCount: targetCount,
        mode
      })
    } else if (posts.length > targetCount) {
      logger.warn('socialPostCreate.post_count.adjusted', {
        originalCount: posts.length,
        adjustedCount: targetCount,
        mode
      })
      return posts.slice(0, targetCount)
    }
  }

  return posts
}

/**
 * Assign IDs and topic to posts
 * @param posts The posts to process
 * @param topic The topic to assign
 * @returns Posts with IDs and topic assigned
 */
function assignPostMetadata(posts: SocialPost[], topic: string): SocialPost[] {
  return posts.map(post => ({
    ...post,
    id: generatePostId(),
    topic
  }))
}

function persistStandalonePosts(posts: SocialPost[], appId: string): SocialPost[] {
  return posts.map((post) => {
    try {
      const created = socialPostRepo.create({
        appId,
        associationId: null,
        platform: post.platform ?? null,
        state: PostState.DRAFT,
        payload: {
          message: post.content,
          hashtags: post.hashtags,
          ...(post.callToAction ? { callToAction: post.callToAction } : {}),
          ...(post.platform ? { platform: post.platform } : {}),
        },
        campaignId: null,
      })
      return {
        ...post,
        id: created.id,
      }
    } catch (error) {
      logger.error('socialPostCreate.persist_standalone.failed', {
        appId,
        postId: post.id,
        error: error instanceof Error ? error.message : String(error),
      })
      return post
    }
  })
}

/**
 * Calculate platform distribution for posts
 * Note: Posts are now platform-agnostic, so this returns empty for backward compatibility
 * @param posts The posts to analyze
 * @returns Record of platform counts (empty for platform-agnostic posts)
 */
function calculatePlatformDistribution(posts: SocialPost[]): Record<string, number> {
  const platformCounts: Record<string, number> = {}
  posts.forEach(post => {
    if (post.platform) {
      platformCounts[post.platform] = (platformCounts[post.platform] || 0) + 1
    }
  })
  return platformCounts
}

/**
 * Generate an auto-prompt for image generation/search based on business context
 * @param imageProvider The image provider (generate or search)
 * @param businessType The type of business
 * @param topic The topic for the post
 * @param styleLabel The style label of the post
 * @returns Generated image prompt
 */
function generateAutoImagePrompt(
  imageProvider: string,
  businessType: string,
  topic: string,
  styleLabel: string
): string {
  const visualTheme = styleLabel.toLowerCase().replace(/[^a-z\s]/g, '').trim()

  // For stock photo search: simple, generic terms work best
  // For AI generation: more detailed descriptions with context
  if (imageProvider === 'generate') {
    return `Professional social media image for ${businessType}: ${topic}. Style: ${visualTheme}. High quality, engaging composition.`
  }

  // For search: use broader, more generic terms to get variety
  // Extract key concept from topic (first 2-3 words max)
  const topicWords = topic.split(' ').slice(0, 2).join(' ')

  // Use randomization for true variety in search results
  const searchStrategies = [
    `${businessType} ${topicWords}`,
    `${businessType} professional`,
    `${visualTheme} ${businessType}`,
    `${topicWords} lifestyle`,
    `${businessType} background`,
    `${topicWords} professional`,
  ]

  // Use random selection for variety
  const strategyIndex = Math.floor(Math.random() * searchStrategies.length)
  return searchStrategies[strategyIndex]!
}

/**
 * Determine the image prompt for a post
 * @param post The post to generate prompt for
 * @param imageProvider The image provider
 * @param globalPrompt Optional global prompt override
 * @param brandContext Optional brand context
 * @param topic The topic
 * @returns The determined image prompt and its source
 */
function determineImagePrompt(
  post: SocialPost,
  imageProvider: string,
  globalPrompt: string | undefined,
  brandContext: any | undefined,
  topic: string
): { prompt: string; source: string } {
  // Priority: post-specific > global > auto-generated
  const postImages = post.images && post.images.length > 0 ? post.images[0] : null
  const postSpecificPrompt = postImages?.prompt

  if (postSpecificPrompt) {
    return { prompt: postSpecificPrompt, source: 'post-specific' }
  }

  if (globalPrompt) {
    return { prompt: globalPrompt, source: 'global' }
  }

  const businessType = brandContext?.type || 'business'
  const autoPrompt = generateAutoImagePrompt(imageProvider, businessType, topic, post.styleLabel)

  return { prompt: autoPrompt, source: 'auto-generated' }
}

/**
 * Generate an AI image for a social post
 * @param prompt The image prompt
 * @param appId The application ID
 * @param postId The post ID
 * @returns Image result with success status and public path
 */
async function generateImageForPost(
  prompt: string,
  appId: string,
  postId: string
): Promise<{ success: boolean; publicPath?: string; error?: string }> {
  try {
    const result = await findMedia({
      prompt,
      appId,
      mediaType: 'generate',
      size: '1024x1024',
      filename: `social-post-${postId}`
    })

    if (!result.success || !result.url) {
      return {
        success: false,
        error: result.error || 'Image generation failed'
      }
    }

    return {
      success: true,
      publicPath: result.url
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Process images for all posts using parallel search when applicable
 * @param posts The posts to process
 * @param imageProvider The image provider
 * @param appId The application ID
 * @param globalImagePrompt Optional global image prompt
 * @param brandContext Optional brand context
 * @param topic The topic
 */
async function processPostImages(
  posts: SocialPost[],
  imageProvider: string,
  appId: string,
  globalImagePrompt: string | undefined,
  brandContext: any | undefined,
  topic: string
): Promise<void> {
  logger.info('socialPostCreate.image.begin', {
    imageProvider,
    postCount: posts.length,
    hasGlobalPrompt: !!globalImagePrompt,
    appId
  })

  const postsData: Array<{ post: SocialPost; prompt: string; source: string }> = []
  for (const post of posts) {
    const { prompt, source } = determineImagePrompt(post, imageProvider, globalImagePrompt, brandContext, topic)
    postsData.push({ post, prompt, source })
  }

  if (imageProvider === 'generate') {
    await processGeneratedImagesParallel(postsData, imageProvider, appId)
  } else {
    await processSearchImagesParallel(postsData, imageProvider)
  }
}

/**
 * Process image searches in parallel for better performance
 * @param postsData Array of posts with their prompts and metadata
 * @param imageProvider The image provider
 */
async function processSearchImagesParallel(
  postsData: Array<{ post: SocialPost; prompt: string; source: string }>,
  imageProvider: string
): Promise<void> {
  const prompts = postsData.map(pd => pd.prompt)

  logger.info('socialPostCreate.image.parallel_search.begin', {
    imageProvider,
    postCount: postsData.length,
    prompts: prompts.map(p => p.substring(0, 50))
  })

  try {
    // Use parallel search from media-search-tool
    const result = await findMedia({
      prompt: prompts,
      mediaType: 'image',
      count: 1
    })

    if (result.success && result.results) {
      // Map results back to posts
      for (let i = 0; i < postsData.length; i++) {
        const { post, prompt, source } = postsData[i]!
        const imageResult = result.results[i]

        logger.info('socialPostCreate.image.prompt', {
          postId: post.id,
          styleLabel: post.styleLabel,
          promptSource: source,
          imagePrompt: prompt.substring(0, 100),
          imageProvider,
          platform: post.platform
        })

        if (imageResult && imageResult.success && imageResult.url) {
          const imageData: PostImageData = {
            url: imageResult.url,
            prompt,
            width: 1024,
            height: 1024
          }

          post.images = post.images || []
          post.images.push(imageData)

          logger.info('socialPostCreate.image.success', {
            postId: post.id,
            imageProvider,
            imageUrl: imageResult.url
          })
        } else {
          logger.warn('socialPostCreate.image.failed', {
            postId: post.id,
            imageProvider,
            error: imageResult?.error || 'Unknown error'
          })
        }
      }

      logger.info('socialPostCreate.image.parallel_search.complete', {
        imageProvider,
        successCount: result.results.filter(r => r.success).length,
        totalCount: postsData.length
      })
    } else {
      logger.error('socialPostCreate.image.parallel_search.failed', {
        imageProvider,
        error: result.error || 'Parallel search failed'
      })
    }
  } catch (error) {
    logger.error('socialPostCreate.image.parallel_search.error', {
      imageProvider,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

/**
 * Process generated images in parallel for better performance
 * @param postsData Array of posts with their prompts and metadata
 * @param imageProvider The image provider
 * @param appId The application ID
 */
async function processGeneratedImagesParallel(
  postsData: Array<{ post: SocialPost; prompt: string; source: string }>,
  imageProvider: string,
  appId: string
): Promise<void> {
  logger.info('socialPostCreate.image.parallel_generation.begin', {
    imageProvider,
    postCount: postsData.length
  })

  const generationPromises = postsData.map(async ({ post, prompt, source }) => {
    try {
      logger.info('socialPostCreate.image.prompt', {
        postId: post.id,
        styleLabel: post.styleLabel,
        promptSource: source,
        imagePrompt: prompt.substring(0, 100),
        imageProvider,
        platform: post.platform
      })

      const imageResult = await generateImageForPost(prompt, appId, post.id!)

      if (imageResult.success && imageResult.publicPath) {
        const imageData: PostImageData = {
          url: imageResult.publicPath,
          prompt,
          width: 1024,
          height: 1024
        }

        post.images = post.images || []
        post.images.push(imageData)

        logger.info('socialPostCreate.image.success', {
          postId: post.id,
          imageProvider,
          imageUrl: imageResult.publicPath
        })

        return { success: true }
      } else {
        logger.warn('socialPostCreate.image.failed', {
          postId: post.id,
          imageProvider,
          error: imageResult.error || 'Unknown error'
        })

        return { success: false, error: imageResult.error }
      }
    } catch (error) {
      logger.error('socialPostCreate.image.error', {
        postId: post.id,
        imageProvider,
        error: error instanceof Error ? error.message : String(error)
      })

      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  const results = await Promise.all(generationPromises)

  logger.info('socialPostCreate.image.parallel_generation.complete', {
    imageProvider,
    successCount: results.filter(r => r.success).length,
    totalCount: postsData.length
  })
}

export const socialPostCreateAITool: Tool = createTool(
  `Generate engaging social media posts for Facebook and Instagram.

This tool uses YOUR intelligence as the LLM to create social posts for connected platforms. You should:

1. **Read Brand Context**: Understand the business type, target audience, and brand from available context
2. **Determine Optimal Tone**: Choose the tone that best fits the business (professional/casual/playful/inspirational/luxury)
3. **Decide Emoji Usage**: Determine if and how many emojis to use based on brand appropriateness
4. **Set Hashtag Count**: Choose optimal number of hashtags (typically 3-7 for FB, 10-20 for IG)
5. **Create Posts**: Generate either a single optimized post or 3-5 variations based on the selected mode
6. **Generate Images**: If includeImages is true, provide image prompts for each post
7. **Extract Scheduling Info & Smart Date Handling**:
   - If the user mentions a specific date/time to publish (e.g., "schedule for February 23rd at 4:00 PM"), extract it into scheduledDate and scheduledTime fields
   - CRITICAL: If the post is scheduled to go out AT the time of an event/launch, DO NOT mention the specific date/time in the content. Instead use "today", "now", "it's here", "launching today" language since the post will be live WHEN the event happens
   - Example: "schedule post for March 25th at 3PM to announce our launch on March 25th at 3PM" → scheduledDate="2026-03-25", scheduledTime="15:00", content should say "THE BIG DAY IS HERE!" or "LAUNCHING NOW!" (NOT "March 25th at 3:00 PM")
   - Only include future dates in content if the post is meant to promote an event happening AFTER the scheduled post time
   - When in doubt, use present-tense "now/today" language if scheduling info is provided

Each post in the "posts" array should have:
- styleLabel: A descriptive title for this post variation (e.g., "Fresh & Bright", "Behind the Scenes")
- styleDescription: Brief explanation of the style approach (will be shown in UI)
- content: The actual post text (with emojis if appropriate)
- hashtags: Array of relevant hashtags without the # symbol
- platform: OPTIONAL - Posts are platform-agnostic. User selects which platforms to publish to in the UI.
- callToAction: Optional CTA text (e.g., "Book your table today!")
- imagePrompt: If includeImages is true, include a specific image prompt for this post

MODE HANDLING:
- "single": Generate one optimized post
- "multiple": Generate 3-5 variations (default behavior) for selection

IMPORTANT PLATFORM-SPECIFIC GENERATION:
- The "platform" parameter determines which character limits and requirements to use
- ALWAYS ask the user which platform(s) they want to target if unclear from context
- Consider platform restrictions when generating content:
  * Facebook: 63,206 character limit, images optional but recommended
  * Instagram: 2,200 character limit, ALWAYS requires at least 1 image
- Do NOT set the platform field in posts - it's optional and user-selected at publish time
- Users will select which platform(s) to publish to in the UI (can select both)
- IMPORTANT: Generate content based on the "platform" parameter:
  * "facebook": Optimize for Facebook - use up to ~63,000 characters, images optional
  * "instagram": Optimize for Instagram - keep under ~2,000 characters, ALWAYS include images
  * "all": Conservative approach - keep under ~2,000 characters and ALWAYS include images (works on both platforms)
- NOTE: If user wants Facebook-optimized content, use platform="facebook" for longer posts
- NOTE: If user wants Instagram-optimized content, use platform="instagram" for image-focused posts

IMAGE HANDLING:
- If includeImages is true, the tool will add images to posts (uses stock image search by default)
- **CRITICAL: Instagram posts REQUIRE at least one image - always set includeImages=true when generating Instagram posts**
- Stock image search (imageProvider="search"): Uses Getty Images to find professional stock photos (DEFAULT)
- AI image generation (imageProvider="generate"): Uses DALL-E to create custom AI images (only if explicitly requested)
- For stock photos: Keep prompts SIMPLE and GENERIC (e.g., "pottery crafts professional photography")
- For AI generation: Use detailed, descriptive prompts with visual details
- IMPORTANT: Let the tool auto-generate prompts from businessType + topic unless you have specific visual requirements
- The global imagePrompt parameter is ONLY used when you need to override auto-generation
- Auto-generated prompts combine businessType + topic for best stock photo search results

IMPORTANT: Generate posts that feel natural and authentic to the business, not generic templates..`,
  z.object({
    topic: z.string().describe('What the post is about, excluding scheduling details (e.g., "website launch celebration", "weekend brunch special"). If the user mentions a date for scheduling, do NOT include it here - that goes in scheduledDate/scheduledTime fields.'),
    scheduledDate: z.string().optional().describe('If user specified a date to publish, provide in YYYY-MM-DD format (e.g., "2026-02-23"). Use the current year 2026 unless user specifies otherwise. Leave empty if no specific date mentioned. IMPORTANT: If the post should go out ON this date (e.g., "post on March 25th to announce March 25th launch"), the content should use present tense ("launching now", "today") NOT future dates.'),
    scheduledTime: z.string().optional().describe('If user specified a time to publish, provide in format: "H:MM AM" or "H:MM PM" (e.g., "4:12 PM", "11:37 AM"). Must include AM or PM. The time will be automatically rounded UP to the nearest 15-minute interval (e.g., "8:12 PM" becomes "8:15 PM", "3:07 AM" becomes "3:15 AM"). Examples: "4:00 PM" ✓, "8:12 PM" ✓, "4:00 pm" ✓. The time should be at least 20 minutes in the future. If the requested time would be in the past or too soon, leave this field empty. Leave empty if no specific time mentioned.'),
    contentApproach: z.enum([
      'product-focused',
      'story-telling',
      'question-based',
      'behind-the-scenes',
      'seasonal',
      'educational',
      'promotional',
      'lifestyle-focused',
      'community-centered',
      'inspirational',
      'trending-topic',
      'interactive-poll',
      'fun-facts'
    ]).describe('The approach to content creation for these posts'),
    platform: z.enum(['facebook', 'instagram', 'all']).default('all').describe('Target platform(s)'),
    mode: z.enum(['single', 'multiple']).default('multiple').describe('Generate a single optimized post or multiple variations'),
    count: z.number().min(1).max(5).default(3).optional().describe('Number of posts to generate in multiple mode (1-5)'),
    contentStyle: z.object({
      length: z.enum(['short', 'medium', 'long']).optional(),
      tone: z.enum(['casual', 'professional', 'inspirational', 'humorous', 'formal']).optional(),
      hashtagDensity: z.enum(['minimal', 'moderate', 'heavy']).optional(),
      emojiUsage: z.enum(['none', 'minimal', 'moderate', 'heavy']).optional()
    }).optional().describe('Optional style guidance for content creation'),
    includeImages: z.boolean().default(true).describe('Whether to include images for posts (stock photos by default)'),
    imageProvider: z.enum(['generate', 'search']).default('search').optional().describe('Use "search" for stock photos (default) or "generate" for AI-generated images'),
    imagePrompt: z.string().optional().describe('Optional custom prompt for image generation/search. If not provided, will be derived from post content'),
    posts: z.array(z.object({
      styleLabel: z.string().describe('Title for this post variant (e.g., "Customer Story", "Product Spotlight")'),
      styleDescription: z.string().optional().describe('Brief explanation of this style approach (displayed in UI)'),
      content: z.string().describe('The actual post text with appropriate formatting'),
      hashtags: z.array(z.string()).describe('Array of hashtags WITHOUT # symbol'),
      platform: z.enum(['facebook', 'instagram']).optional().describe('Optional - posts are platform-agnostic. User selects platforms at publish time.'),
      callToAction: z.string().optional().describe('Optional call-to-action text'),
      imagePrompt: z.string().optional().describe('Optional custom prompt for generating/searching for an image specific to this post')
    })).describe('Array of post variations (1 for single mode, 1-5 for multiple mode)'),
    brandContext: z.object({
      name: z.string().optional().describe('Business or brand name if known'),
      type: z.string().optional().describe('Type of business / brand'),
      tone: z.string().optional().describe('Brand tone you determined is appropriate'),
      targetAudience: z.string().optional().describe('Who the business / brand serves')
    }).optional().describe('Brand context you inferred or was provided')
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string
    const mode = input.mode
    const count = input.count ?? (mode === 'multiple' ? 3 : 1)
    const includeImages = input.includeImages
    const imageProvider = input.imageProvider ?? 'search'

    validateInputParameters(mode, input.platform, includeImages, appId)

    logger.info('socialPostCreate.generate.begin', {
      topic: input.topic,
      contentApproach: input.contentApproach,
      platform: input.platform,
      mode,
      requestedCount: count,
      postCount: input.posts.length,
      hasBrandContext: !!input.brandContext,
      includeImages,
      imageProvider
    })

    // Normalize post count based on mode
    let posts = normalizePostCount(input.posts as SocialPost[], mode, count)
    posts = assignPostMetadata(posts, input.topic)

    // Generate images if requested
    if (includeImages && appId) {
      try {
        await processPostImages(
          posts,
          imageProvider,
          appId,
          input.imagePrompt,
          input.brandContext,
          input.topic
        )
      } catch (error) {
        logger.error('socialPostCreate.images.process_failed', {
          error: error instanceof Error ? error.message : String(error),
          postCount: posts.length,
          imageProvider
        })
      }
    }

    if (appId) {
      posts = persistStandalonePosts(posts, appId)
    }

    const platformCounts = calculatePlatformDistribution(posts)

    // Normalize scheduled time to 24-hour format for TimePicker
    const normalizedTime = normalizeTimeFormat(input.scheduledTime)

    // Log if time was rounded
    if (input.scheduledTime && normalizedTime && input.scheduledTime !== normalizedTime) {
      logger.info('socialPostCreate.time.rounded', {
        originalTime: input.scheduledTime,
        roundedTime: normalizedTime
      })
    }

    logger.info('socialPostCreate.generate.complete', {
      postCount: posts.length,
      platformDistribution: platformCounts,
      requestedPlatform: input.platform,
      mode,
      topic: input.topic,
      includeImages,
      postsWithImages: posts.filter(post => post.images && post.images.length > 0).length,
      hasScheduling: !!(input.scheduledDate || input.scheduledTime),
      scheduledTime: input.scheduledTime,
      normalizedTime
    })

    return {
      success: true,
      widget: {
        widgetType: 'social-post-list',
        widgetData: {
          posts,
          topic: input.topic,
          mode,
          scheduledDate: input.scheduledDate,
          scheduledTime: normalizedTime
        }
      },
      posts,
      platformCounts,
      mode,
      includeImages,
      scheduledDate: input.scheduledDate,
      scheduledTime: normalizedTime
    }
  }
)
