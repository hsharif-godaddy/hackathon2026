import { createTool } from '@airo/ai-lib'
import { z } from 'zod'
import { findImage } from '../image-search-tool.js'
import { generateImage } from '../image-generation-tool.js'

/**
 * Image Search Tool for AI-Lib
 * Search for images on the web based on text prompts
 */
export const imageSearchAITool = createTool(
  'Search for images on the web based on text prompts. Supports single prompts or arrays of prompts for parallel search. Each prompt returns one high-quality image. Use this when you need to find relevant images to illustrate concepts.',
  z.object({
    prompt: z.union([z.string(), z.array(z.string())]).describe('Text prompt(s) describing the image(s) to search for. Can be a single string or array of strings for parallel search. Each prompt returns one image.')
  }),
  async (input, context) => {
    const { prompt } = input
    
    // Validate prompt
    if (Array.isArray(prompt)) {
      if (prompt.length === 0 || prompt.some(p => !p || typeof p !== 'string' || p.trim().length === 0)) {
        throw new Error('A valid array of image search prompts is required')
      }
    } else if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new Error('A valid image search prompt is required')
    }
    
    const result = await findImage({ prompt })
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to find image(s)')
    }
    
    // Handle single prompt case
    if (!Array.isArray(prompt) && result.url) {
      return `![${prompt}](${result.url})`
    }
    
    // Handle array prompts case
    if (Array.isArray(prompt) && result.results) {
      const markdownImages = result.results.map(r => {
        if (r.success && r.url) {
          return `![${r.prompt}](${r.url})`
        } else if (r.success && r.urls && r.urls.length > 0) {
          return r.urls.map(url => `![${r.prompt}](${url})`).join('\n')
        } else {
          return `<!-- Error for "${r.prompt}": ${r.error || 'No image found'} -->`
        }
      }).join('\n\n')
      
      return markdownImages
    }
    
    throw new Error('Unexpected result format from image search')
  }
)

/**
 * Image Generate Tool for AI-Lib
 * Generate an image using AI based on a detailed text prompt
 */
export const imageGenerateAITool = createTool(
  'Generate an image using AI based on a detailed text prompt and save it to the app\'s public directory. Uses gpt-image-1 model which produces high-quality, vivid images by default.',
  z.object({
    prompt: z.string().describe('Detailed description of the image to generate'),
    size: z.enum(['1024x1024', '1024x1536', '1536x1024', 'auto']).default('1024x1024').describe('Size of the generated image'),
    filename: z.string().optional().describe('Optional custom filename without extension (default: derived from prompt)')
  }),
  async (input, context) => {
    const { prompt, size, filename } = input
    
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new Error('A valid image generation prompt is required')
    }
    
    const appId = context?.metadata?.appId as string
    if (!appId) {
      throw new Error('App ID is required for image generation and is not available in context')
    }
    
    const result = await generateImage({
      prompt,
      size: size as '1024x1024' | '1024x1536' | '1536x1024' | 'auto',
      appId,
      ...(filename && { filename })
    })
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to generate image')
    }
    
    let response = `![${prompt}](${result.publicPath})`
    response += `\n\nImage saved to: ${result.publicPath}`
    
    return response
  }
)
