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
 * Media Tool for AI-Lib
 * 
 * Unified tool for searching images, videos, and generating AI images.
 * By default searches for images. Use mediaType to specify video search or image generation.
 * 
 * Image search:
 * - Supports single prompts or arrays of prompts for parallel search
 * - Each prompt can return multiple results (controlled by count parameter)
 * - Use for finding stock photos, illustrations, graphics
 * 
 * Video search:
 * - Only supports single prompts (no arrays)
 * - Returns one video per search
 * - Use only when video/motion content is explicitly needed
 * 
 * Image generation:
 * - Only supports single prompts (no arrays)
 * - Generates custom AI images using DALL-E
 * - Use when image search fails or when user explicitly requests generation
 */
export const mediaSearchAITool: Tool = createTool(
  'Search for professional stock images/videos OR generate AI images. By DEFAULT, this searches for IMAGES. Use "video" for video search, or "generate" to create custom AI images. For images: supports single/multiple prompts and returns multiple results. For videos: single prompt only. For generation: single prompt only, use when image search fails or user explicitly requests AI-generated images.',
  z.object({
    prompt: z.union([z.string(), z.array(z.string())]).describe('Text prompt(s) describing the media to search for. Can be a single string or array of strings (array only for images). Limit each prompt to 1-5 keywords for best results. Examples: "sunset over ocean", "business meeting", "happy family"'),
    mediaType: z.enum(['image', 'video', 'generate']).default('image').describe('Type of media to search for. Defaults to "image". Use "video" for video search, or "generate" to create AI images.'),
    count: z.number().min(1).max(50).optional().describe('Number of results to return per prompt (only applicable for images). Maximum is 50. Let context determine the appropriate number.'),
    orientations: z.string().optional().describe('Filter by image orientation. Only the first value is used if multiple comma-separated values are provided. Valid values: "horizontal", "vertical", "square", "panoramic_horizontal", "panoramic_vertical".'),
    compositions: z.string().optional().describe('Filter by image composition. Only the first value is used if multiple comma-separated values are provided. Valid values: "abstract", "candid", "close_up", "copy_space", "cut_out", "full_frame", "full_length", "headshot", "looking_at_camera", "macro", "medium_shot", "part_of_a_series", "portrait", "sparse", "still_life", "three_quarter_length", "waist_up", "wide_shot".'),
    color: z.string().optional().describe('Filter by color. Can be a hex code (e.g. "#FF0000").'),
    size: z.enum(['1024x1024', '1024x1536', '1536x1024', 'auto']).default('1024x1024').optional().describe('Size for generated images (only for mediaType: "generate")'),
    filename: z.string().optional().describe('Optional custom filename without extension for generated images (only for mediaType: "generate")')
  }),
  async (input, context) => {
    const { prompt, mediaType = 'image', count, orientations, compositions, color, size, filename } = input;
    
    // Validate prompt
    if (Array.isArray(prompt)) {
      if (mediaType === 'video' || mediaType === 'generate') {
        throw new Error(`${mediaType === 'video' ? 'Video search' : 'Image generation'} does not support multiple prompts. Please provide a single prompt.`);
      }
      if (prompt.length === 0 || prompt.some(p => !p || typeof p !== 'string' || p.trim().length === 0)) {
        throw new Error('A valid array of search prompts is required');
      }
    } else if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new Error('A valid prompt is required');
    }
    
    // Get appId from context for image generation
    const appId = context?.metadata?.appId as string;
    if (mediaType === 'generate' && !appId) {
      throw new Error('App ID is required for image generation and is not available in context');
    }
    
    const options: MediaSearchOptions = {
      prompt,
      mediaType,
      ...(count !== undefined && { count }),
      ...(appId && { appId }),
      ...(size && { size }),
      ...(filename && { filename }),
      ...(orientations && { orientations }),
      ...(compositions && { compositions }),
      ...(color && { color })
    };
    
    const result = await findMedia(options);
    
    if (!result.success) {
      throw new Error(result.error || `Failed to ${mediaType === 'generate' ? 'generate' : 'find'} ${mediaType === 'generate' ? 'image' : mediaType}`);
    }
    
    // Return JSON for all operations (search and generation) for consistent rendering
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
