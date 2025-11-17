import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { generateImage } from '../image-generation-tool.js'
import { AppRepository } from '../../database/repositories/AppRepository.js'

/**
 * Image Generate Tool for AI-Lib
 * Generate an image using AI based on a detailed text prompt
 */
export const imageGenerateAITool: Tool = createTool(
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
    
    // Get the app's preview URL to construct the full image URL
    const appRepository = new AppRepository()
    const app = appRepository.findById(appId)
    
    if (!app) {
      throw new Error(`App not found with ID: ${appId}`)
    }
    
    // Combine previewUrl with the publicPath to create full image URL
    const imageUrl = app.previewUrl 
      ? `${app.previewUrl.replace(/\/+$/, '')}${result.publicPath}` 
      : result.publicPath
    
    let response = `![${prompt}](${imageUrl})`
    response += `\n\nImage saved to: ${result.publicPath}`
    
    return response
  }
)
