import { SocialPost, PostImageData } from '../../types/social-posts.js'
import { createTool, type Tool } from '@airo/ai-lib'
import { logger } from '../../logging/index.js'
import { findMedia } from '../media-search-tool.js'
import { z } from 'zod'

/**
 * Generate a unique ID for a social post
 * @returns A unique social post identifier
 */
export function generatePostId(): string {
  return `post_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Platform-specific validation details
 * @deprecated - Use ValidationDetails instead
 */
export interface PlatformValidation {
  isValid: boolean
  characterCount: number
  maxCharacters: number
  maxImages: number
  errorMessages?: string[]
}

/**
 * Platform-specific character and image limits
 */
const PLATFORM_LIMITS = {
  facebook: { maxChars: 63206, maxImages: 9, minImages: 0},
  instagram: { maxChars: 2200, maxImages: 1, minImages: 1 },
} as const

/**
 * Calculate the full content length including hashtags and call-to-action
 * @param post The post to calculate length for
 * @returns Object with full content string and its length
 */
function calculateContentLength(post: SocialPost): { fullContent: string; contentLength: number } {
  const hashtagsString = post.hashtags.map(tag => `#${tag}`).join(' ')
  const callToActionString = post.callToAction ? ` ${post.callToAction}` : ''
  const fullContent = `${post.content} ${hashtagsString}${callToActionString}`

  return {
    fullContent,
    contentLength: fullContent.length
  }
}

/**
 * Validates a post against platform-specific requirements
 * @param post The post to validate
 * @returns Post with validation data
 */
export const validatePost = (post: SocialPost): SocialPost => {
  const { contentLength } = calculateContentLength(post)
  const limits = PLATFORM_LIMITS[post.platform]
  const errors: string[] = []

  // Check if content exceeds character limit
  if (contentLength > limits.maxChars) {
    errors.push(`Total content (including hashtags and call-to-action) exceeds ${post.platform} ${limits.maxChars} character limit`)
  }

  // Check if Instagram posts have at least one image
  const imageCount = post.images?.length || 0
  if (post.platform === 'instagram' && imageCount < limits.minImages) {
    errors.push(`Instagram posts require at least ${limits.minImages} image`)
  }

  // Extract individual length components
  const hashtagsString = post.hashtags.map(tag => `#${tag}`).join(' ')
  const callToActionString = post.callToAction ? ` ${post.callToAction}` : ''

  // Create validation result with detailed breakdown
  const validation = {
    isValid: errors.length === 0,
    characterCount: contentLength,
    contentLength: post.content.length,
    hashtagsLength: hashtagsString.length,
    callToActionLength: callToActionString.length,
    maxCharacters: limits.maxChars,
    maxImages: limits.maxImages,
    imageCount,
    ...(errors.length > 0 && { errorMessages: errors })
  }

  return {
    ...post,
    validation
  }
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

/**
 * Calculate platform distribution for posts
 * @param posts The posts to analyze
 * @returns Record of platform counts
 */
function calculatePlatformDistribution(posts: SocialPost[]): Record<string, number> {
  const platformCounts: Record<string, number> = {}
  posts.forEach(post => {
    platformCounts[post.platform] = (platformCounts[post.platform] || 0) + 1
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

Each post in the "posts" array should have:
- styleLabel: A descriptive title for this post variation (e.g., "Fresh & Bright", "Behind the Scenes")
- styleDescription: Brief explanation of the style approach (will be shown in UI)
- content: The actual post text (with emojis if appropriate)
- hashtags: Array of relevant hashtags without the # symbol
- platform: "facebook" or "instagram" - IMPORTANT: Each post must target one specific platform
- callToAction: Optional CTA text (e.g., "Book your table today!")
- imagePrompt: If includeImages is true, include a specific image prompt for this post

MODE HANDLING:
- "single": Generate one optimized post for the specified platform (requires specific platform selection)
- "multiple": Generate 3-5 variations (default behavior) for selection

IMPORTANT PLATFORM HANDLING:
- platform="all" is an INPUT parameter that tells you to generate posts for ALL supported platforms
- When you receive platform="all", create a mix of posts: some for Facebook, some for Instagram
- CRITICAL: Each individual post in the "posts" array MUST have a specific platform value (facebook or instagram)
- NEVER set an individual post's platform field to "all" - that's only used as the input parameter
- Example: If user asks for platform="all" with count=4, you might create: 2 Facebook posts, 2 Instagram post
- When creating for "all" platforms, aim for a balanced mix across the requested platforms
- Each post should be optimized for its specific platform (length, hashtag count, style)
- In single mode, a specific platform MUST be selected (not "all") since you're only creating one post

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
    topic: z.string().describe('What the post is about (e.g., "weekend brunch special", "new spring menu")'),
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
      platform: z.enum(['facebook', 'instagram']).describe('The specific platform this post is optimized for'),
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

    const validatedPosts = posts.map(post => validatePost(post))
    const finalPosts = validatedPosts.filter(post => post.validation?.isValid)

    if (finalPosts.length === 0) {
      throw new Error('None of the provided posts are valid for their platforms. Please adjust the content to fit platform limits.')
    }

    const platformCounts = calculatePlatformDistribution(finalPosts)

    logger.info('socialPostCreate.generate.complete', {
      totalPostCount: posts.length,
      validPostCount: finalPosts.length,
      platformDistribution: platformCounts,
      requestedPlatform: input.platform,
      mode,
      topic: input.topic,
      includeImages,
      postsWithImages: finalPosts.filter(post => post.images && post.images.length > 0).length
    })

    return {
      success: true,
      widget: {
        widgetType: 'social-post-list',
        widgetData: {
          posts: finalPosts,
          topic: input.topic,
          mode
        }
      },
      posts: finalPosts,
      filteredCount: posts.length - finalPosts.length,
      platformCounts,
      mode,
      includeImages
    }
  }
)
