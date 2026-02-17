import { createTool, type Tool } from '@airo/ai-lib';
import { z } from 'zod';
import { MediaSlotTool, type MediaSlotResult } from '../media-slot-tool.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';

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
  'Select an image or video for a specific location in the app. Returns a slot URL (like "/airo-assets/images/pages/home/hero") that you should use in the code. The actual image is resolved at runtime, allowing users to easily swap images without code changes. Use descriptive slot names that reflect the image location and purpose.',
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
    orientations: z.string().optional().describe(
      'Filter by orientation. Values: "horizontal", "vertical", "square", "panoramic_horizontal", "panoramic_vertical"'
    ),
    compositions: z.string().optional().describe(
      'Filter by composition style. Values: "abstract", "candid", "close_up", "copy_space", "cut_out", "full_frame", "full_length", "headshot", "looking_at_camera", "macro", "portrait", "wide_shot"'
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

    const mediaSlotTool = new MediaSlotTool();

    const result = await mediaSlotTool.selectMedia({
      slot,
      query,
      mediaType,
      size,
      orientations,
      compositions,
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
      ...(result.alternatives && { alternatives: result.alternatives }),
      ...(result.alternativeCount !== undefined && { alternativeCount: result.alternativeCount }),
    };

    return JSON.stringify(response, null, 2);
  }
);
