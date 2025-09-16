import { createTool, Agent, openAIModels } from '@airo/ai-lib'
import { z } from 'zod'

export const imageGenerationTool = createTool(
  'Generate images using DALL-E based on text descriptions',
  z.object({
    prompt: z.string().describe('Detailed description of the image to generate'),
    size: z.enum(['256x256', '512x512', '1024x1024', '1792x1024', '1024x1792']).optional().describe('Image size (default: 1024x1024)'),
    n: z.number().min(1).max(4).optional().describe('Number of images to generate (default: 1)')
  }),
  async ({ prompt, size = '256x256', n = 1 }: { prompt: string; size?: string; n?: number }) => {
    console.log('🎨 Image generation tool called:', { prompt: prompt.substring(0, 100), size, n })
    
    try {
      console.log('🎨 Creating image generation agent...')
      
      // Create a dedicated image generation agent
      const imageAgent = new Agent({
        name: 'Image Generator',
        model: openAIModels.dalle3(),
        systemPrompt: 'You are an image generation assistant.'
      })
      
      console.log('🎨 Agent created, calling generateImage...')
      console.log('🎨 Options:', { prompt: prompt.substring(0, 50), size, n })
      
      const result = await imageAgent.generateImage({
        prompt,
        size,
        n
      })
      
      console.log('🎨 Image generation successful:', { imageCount: result.images.length })
      console.log('🎨 Image results structure:', result.images.map(img => ({
        hasUrl: !!img.url,
        hasBase64: !!img.base64,
        urlLength: img.url ? img.url.length : 0,
        base64Length: img.base64 ? img.base64.length : 0,
        revisedPrompt: (img as any).revisedPrompt?.substring(0, 100) || 'No revised prompt',
        hasMetadata: !!img.metadata,
        metadataKeys: img.metadata ? Object.keys(img.metadata) : []
      })))
      
      const toolResult = {
        success: true,
        prompt,
        images: result.images.map(img => ({
          url: img.url,
          base64: img.base64,
          revisedPrompt: (img as any).revisedPrompt || img.metadata?.revisedPrompt
        })),
        usage: result.usage
      }
      
      console.log('🎨 Returning tool result:', {
        success: toolResult.success,
        prompt: toolResult.prompt.substring(0, 50),
        imageCount: toolResult.images.length,
        images: toolResult.images.map(img => ({
          hasUrl: !!img.url,
          hasBase64: !!img.base64,
          revisedPrompt: img.revisedPrompt?.substring(0, 50) || 'No revised prompt'
        }))
      })
      
      return toolResult
    } catch (error) {
      console.error('❌ Image generation error details:')
      console.error('❌ Error message:', error instanceof Error ? error.message : String(error))
      console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace')
      console.error('❌ Error object:', error)
      
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        prompt
      }
    }
  }
)
