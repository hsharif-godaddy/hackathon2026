import { createTool, type Tool } from '@airo/ai-lib';
import { z } from 'zod';
import { MediaSlotTool, type MediaSlotResult } from '../media-slot-tool.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { logger } from '../../logging/index.js';
import { fillSlotFromRebuildSource } from '../rebuild-source-media.js';

/**
 * Media Slot Tool for AI-Lib
 *
 * Selects images or videos for semantic slots in the application.
 * Instead of returning direct URLs, this tool stores the media in a manifest
 * and returns a slot URL that the proxy resolves at runtime.
 *
 * Benefits:
 * - Images can be changed without code edits
 * - Users can browse alternatives and swap images
 * - Original search context is preserved for re-searching
 */
export const mediaSlotAITool: Tool = createTool(
  'Select an image or video for a specific location in the app. Returns a slot URL that you should use in the code. For images the URL is like "/airo-assets/images/pages/home/hero" — use in <img src="...">. For videos the URL is like "/airo-assets/videos/pages/home/hero" — you MUST use <video src="..."> (NOT <img>). The actual media is resolved at runtime, allowing users to easily swap without code changes.',
  z.object({
    slot: z.string().describe(
      `Semantic path identifying this media's PURPOSE and CONTENT. Format: "{location}/{descriptive-name}"

NAMING RULES:
1. Use DESCRIPTIVE names that identify the CONTENT, not generic numbers
2. For distinct items (products, team members, menu items): use the item's identity
   - ✅ "menu/carne-asada-taco", "menu/fish-tacos", "team/john-smith-ceo"
   - ❌ "menu/item-1", "menu/item-2", "team/member-1"
3. Only use numbers for truly interchangeable items (gallery images, carousel slides)
   - ✅ "gallery/slide-1", "testimonials/quote-3" (interchangeable)
4. Include location prefix: "pages/{page}/", "components/", "products/"

EXAMPLES:
- Product images: "products/sunrise-blend-coffee", "products/classic-burger"
- Menu items: "menu/fish-tacos", "menu/veggie-burrito"
- Team photos: "team/sarah-chen-founder", "team/mike-jones-chef"
- Hero images: "pages/home/hero", "pages/about/hero"
- Generic galleries: "pages/home/gallery-1" (ok - interchangeable)`
    ),
    query: z.string().describe(
      'Search terms describing the desired media. Be specific about subject, style, mood. Examples: "modern office team collaboration", "sunset beach vacation", "professional headshot business woman"'
    ),
    mediaType: z.enum(['image', 'video']).default('image').describe(
      'Type of media to search for. Default is "image". Use "video" only when motion content is explicitly needed.'
    ),
    size: z.object({
      width: z.number().describe('Desired width in pixels'),
      height: z.number().describe('Desired height in pixels'),
      fit: z.enum(['cover', 'contain', 'crop']).default('cover').describe(
        'How the image should fit the dimensions. "cover" fills the area (may crop), "contain" fits entirely (may letterbox), "crop" crops to exact size.'
      ),
    }).optional().describe(
      'Requested dimensions for the media. Helps select appropriately sized images.'
    ),
    orientations: z.array(z.enum([
      'horizontal', 'vertical', 'square', 'panoramic_horizontal', 'panoramic_vertical'
    ])).optional().describe(
      'Filter by image orientation. Use horizontal for banners/heroes, vertical for sidebars, square for thumbnails/profiles.'
    ),
    compositions: z.array(z.enum([
      'abstract', 'candid', 'close_up', 'copy_space', 'cut_out', 'full_frame',
      'full_length', 'headshot', 'looking_at_camera', 'macro', 'medium_shot',
      'portrait', 'sparse', 'still_life', 'waist_up', 'wide_shot'
    ])).optional().describe(
      'Filter by composition style. Use copy_space for hero images with text overlay, headshot for team photos, close_up for product details, wide_shot for landscapes.'
    ),
    moods: z.array(z.enum([
      'dramatic', 'bold', 'vivid', 'warm', 'cool', 'natural', 'black_and_white'
    ])).optional().describe(
      'Filter by mood/tone of image. Use warm for restaurants/hospitality, bold for fitness/sports, cool for tech/corporate, natural for wellness/eco.'
    ),
    graphicalStyles: z.array(z.enum([
      'photography', 'illustration', 'fine_art', 'vector'
    ])).optional().describe(
      'Filter by graphical style. Use photography for most real-world sites, illustration for playful/educational, vector for icons/diagrams.'
    ),
    sortOrder: z.enum(['best_match', 'most_popular', 'newest', 'random']).optional().describe(
      'Sort order for results. Default: best_match. Use most_popular for generic content, newest for trendy/current looks.'
    ),
    color: z.string().optional().describe(
      'Filter by dominant color as hex string (e.g., "#FF0000" for red). Use to match brand colors.'
    ),
    advancedFilters: z.object({
      numberOfPeople: z.array(z.enum(['none', 'one', 'two', 'group'])).optional().describe(
        'Filter by number of people visible. Use none for product/nature shots, one for portraits, group for team/social.'
      ),
      ethnicity: z.array(z.enum([
        'black', 'white', 'east_asian', 'hispanic_latinx', 'japanese',
        'middle_eastern', 'south_asian', 'southeast_asian'
      ])).optional().describe(
        'Filter by ethnicity representation.'
      ),
      ageOfPeople: z.array(z.enum([
        'newborn', 'baby', 'child', 'teenager', 'young_adult',
        'adult', 'mature_adult', 'senior_adult'
      ])).optional().describe(
        'Filter by age group.'
      ),
      minimumSize: z.enum(['x_small', 'small', 'medium', 'large', 'x_large', 'xx_large']).optional().describe(
        'Minimum image size. Use large or x_large for hero/banner images, medium for content images.'
      ),
      subjectCategory: z.array(z.enum([
        'person', 'people', 'animal', 'nature', 'technology', 'food',
        'architecture', 'vehicle', 'product', 'abstract', 'workspace', 'lifestyle', 'other'
      ])).optional().describe(
        'Filter by primary subject category. Use food for restaurant sites, technology for tech companies, architecture for real estate.'
      ),
      usageContext: z.array(z.enum([
        'hero', 'banner', 'background', 'product', 'profile', 'thumbnail',
        'icon', 'content', 'testimonial', 'gallery', 'general'
      ])).optional().describe(
        'Filter by intended usage context. Use hero for main page images, background for section backgrounds, profile for team photos.'
      ),
    }).optional().describe(
      'Advanced filters for fine-tuning image search. Only use when specific criteria are important.'
    ),
    count: z.number().min(1).max(10).default(5).optional().describe(
      'Number of alternative images to store (1-10, default 5). Alternatives are shown to users for easy swapping.'
    ),
  }),
  async (input, context) => {
    const {
      slot,
      query,
      mediaType = 'image',
      size,
      orientations,
      compositions,
      moods,
      graphicalStyles,
      sortOrder,
      color,
      advancedFilters,
      count = 5,
    } = input;

    // Get appId from context
    const appId = context?.metadata?.appId as string;
    if (!appId) {
      throw new Error('App ID is required and is not available in context');
    }

    // Get conversationId and customerId for tracking
    const conversationId = context?.metadata?.sessionId as string | undefined;
    let customerId: string | undefined;

    if (appId) {
      const appRepo = new AppRepository();
      const app = appRepo.findById(appId);
      customerId = app?.subscriptionId || app?.customerId;
    }

    // Observability: log every media request (slot + query). Pairs with
    // media-slot.source-fill below — together they show what the agent asked for
    // vs whether we served a scraped source photo or fell through to Getty.
    logger.info('media-slot.fill', { appId, slot, query, mediaType });

    // Rebuild fidelity: while a rebuilt site is in its initial build, fill the slot
    // with the customer's matching scraped photo instead of Getty stock. Returns
    // null (→ Getty below) for non-rebuild apps, post-build editing, or when no
    // source image fits.
    const sourceFill = await fillSlotFromRebuildSource({ appId, slot, query, mediaType });
    if (sourceFill) {
      return JSON.stringify(sourceFill, null, 2);
    }

    const mediaSlotTool = new MediaSlotTool();

    const result = await mediaSlotTool.selectMedia({
      slot,
      query,
      mediaType,
      size,
      orientations,
      compositions,
      moods,
      graphicalStyles,
      sortOrder,
      color,
      advancedFilters,
      count,
      appId,
      conversationId,
      customerId,
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to select media');
    }

    // Return structured response for the agent
    const response: MediaSlotResult = {
      success: true,
      slot: result.slot,
      slotUrl: result.slotUrl,
      mediaType: result.mediaType,
      searchQuery: result.searchQuery,
      ...(result.resolvedUrl && { resolvedUrl: result.resolvedUrl }),
      ...(result.thumbnailUrl && { thumbnailUrl: result.thumbnailUrl }),
      ...(result.alternatives && { alternatives: result.alternatives }),
      ...(result.alternativeCount !== undefined && { alternativeCount: result.alternativeCount }),
    };

    // Add explicit element guidance for videos so agent doesn't use <img>
    if (result.mediaType === 'video') {
      (response as unknown as Record<string, unknown>).note = `IMPORTANT: Use <video src="${result.slotUrl}" autoPlay muted loop playsInline /> in the code. Do NOT use <img> for video slots. If replacing an existing <img>, change the element to <video>.`;
    }

    return JSON.stringify(response, null, 2);
  }
);
