import { createTool, type Tool } from '@airo/ai-lib';
import { z } from 'zod';
import { findMedia, type MediaSearchOptions, type MediaType } from '../media-search-tool.js';

/**
 * Media search response interface for AI tool output
 */
interface MediaSearchResponse {
  success: boolean;
  mediaType: MediaType;
  prompt: string | string[];
  error?: string;
  url?: string;
  urls?: string[];
  results?: Array<{
    prompt: string;
    success: boolean;
    url?: string;
    urls?: string[];
    error?: string;
  }>;
}

/**
 * Media Search Tool for AI-Lib
 * 
 * Unified tool for searching both images and videos based on text prompts.
 * By default searches for images. Set mediaType to 'video' when video content is explicitly requested.
 * 
 * Image search:
 * - Supports single prompts or arrays of prompts for parallel search
 * - Each prompt can return multiple results (controlled by count parameter)
 * - Use for illustrations, photos, graphics, and visual content
 * 
 * Video search:
 * - Only supports single prompts (no arrays)
 * - Returns one video per search
 * - Use only when video/motion content is explicitly needed
 */
export const mediaSearchAITool: Tool = createTool(
  'Search for professional stock images or videos based on text prompts. By DEFAULT, this searches for IMAGES unless you explicitly need a VIDEO. For images: supports single/multiple prompts and can return multiple results per prompt. For videos: only single prompt returning one video. Use images for most visual needs; use videos only when motion/video is specifically required.',
  z.object({
    prompt: z.union([z.string(), z.array(z.string())]).describe('Text prompt(s) describing the media to search for. Can be a single string or array of strings (array only for images). Examples: "sunset over ocean", "business meeting", "happy family"'),
    mediaType: z.enum(['image', 'video']).default('image').describe('Type of media to search for. Defaults to "image". Only use "video" when video/motion content is explicitly requested or required.'),
    count: z.number().min(1).max(50).optional().describe('Number of results to return per prompt (only applicable for images). Maximum is 50. Let context determine the appropriate number.')
  }),
  async (input, context) => {
    const { prompt, mediaType = 'image', count } = input;
    
    // Validate prompt
    if (Array.isArray(prompt)) {
      if (mediaType === 'video') {
        throw new Error('Video search does not support multiple prompts. Please provide a single prompt.');
      }
      if (prompt.length === 0 || prompt.some(p => !p || typeof p !== 'string' || p.trim().length === 0)) {
        throw new Error('A valid array of search prompts is required');
      }
    } else if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new Error('A valid search prompt is required');
    }
    
    const options: MediaSearchOptions = {
      prompt,
      mediaType,
      ...(count !== undefined && { count })
    };
    
    const result = await findMedia(options);
    
    if (!result.success) {
      throw new Error(result.error || `Failed to find ${mediaType}`);
    }
    
    // Return JSON for easier parsing in custom renderers
    const response: MediaSearchResponse = {
      success: result.success,
      mediaType,
      prompt,
      ...(result.error !== undefined && { error: result.error })
    };
    
    if ('url' in result && result.url) {
      response.url = result.url;
    }
    
    if ('urls' in result && result.urls) {
      response.urls = result.urls;
    }
    
    if ('results' in result && result.results) {
      response.results = result.results;
    }
    
    return JSON.stringify(response, null, 2);
  }
);

