import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { appPlanTool, AppPlanToolOptions } from '../app-plan-tool.js'

/**
 * App Plan Tool for AI-Lib
 * Manage app planning data including color schemes and metadata
 */
export const appPlanAITool: Tool = createTool(
  'Manage app planning data including color schemes and metadata.',
  z.object({
    operation: z.enum(['create', 'read', 'update', 'delete']).describe('The operation to perform on the app plan'),
    appId: z.string().optional().describe('App ID (usually provided by context)'),
    appName: z.string().optional().describe('Name of the app'),
    colorPalette: z.object({
      scheme: z.string().describe('Color scheme name'),
      name: z.string().optional().describe('Display name for the color scheme'),
      primary: z.string().describe('Primary color (hex)'),
      secondary: z.string().describe('Secondary color (hex)'),
      accent: z.string().describe('Accent color (hex)')
    }).optional().describe('Color palette configuration'),
    planData: z.record(z.string(), z.any()).optional().describe('Additional planning data')
  }),
  async (input, context) => {
    const result = await appPlanTool.execute(input as AppPlanToolOptions)
    
    if (!result.success) {
      throw new Error(result.error || 'App plan operation failed')
    }

    let responseMessage = `✅ **App Plan ${input.operation.toUpperCase()}**\n`
    responseMessage += result.message || ''

    if (result.data) {
      responseMessage += `\n\n📋 **Plan Details:**`
      responseMessage += `\n- **App ID:** ${result.data.appId}`
      
      if (result.data.appName) {
        responseMessage += `\n- **App Name:** ${result.data.appName}`
      }
      
      if (result.data.colorPalette) {
        responseMessage += `\n- **Color Theme:** ${result.data.colorPalette.theme}`
        if (result.data.colorPalette.name) {
          responseMessage += ` (${result.data.colorPalette.name})`
        }
        responseMessage += `\n- **Primary Color:** ${result.data.colorPalette.primary}`
        responseMessage += `\n- **Secondary Color:** ${result.data.colorPalette.secondary}`
        responseMessage += `\n- **Accent Color:** ${result.data.colorPalette.accent}`
      }
      
      if (result.data.planData && Object.keys(result.data.planData).length > 0) {
        responseMessage += `\n- **Additional Data:** ${Object.keys(result.data.planData).length} items stored`
      }
      
      responseMessage += `\n- **Last Updated:** ${result.data.updatedAt.toLocaleString()}`
    }

    return responseMessage
  }
)
