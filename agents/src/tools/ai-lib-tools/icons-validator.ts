import { createTool } from '@airo/ai-lib'
import { z } from 'zod'
import { validateLucideIcons, IconsValidatorOptions } from '../icons-validator.js'
import { AppRepository } from '../../database/repositories/AppRepository.js'

// Initialize tool instances
const appRepo = new AppRepository()

/**
 * Icons Validator Tool for AI-Lib
 * Validate icons used in generated content
 */
export const iconsValidatorAITool = createTool(
  'Validate icons used in generated content. Use this tool when the site is nearly complete to ensure all icons exist. This prevents runtime errors from invalid icon names.',
  z.object({
    files: z.array(z.string()).optional().describe('Specific files to validate (relative paths). If empty, validates all .tsx/.ts/.jsx/.js files'),
    fixSuggestions: z.boolean().default(true).describe('Include detailed fix suggestions in the output')
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string
    if (!appId) {
      throw new Error('App ID is required for content validation')
    }

    const app = appRepo.findById(appId)
    if (!app) {
      throw new Error(`App '${appId}' not found`)
    }

    const files = input.files || []
    const fixSuggestions = input.fixSuggestions !== false

    const result = await validateLucideIcons(app.path, files)

    if (!result) {
      throw new Error('Icons validation failed to execute')
    }

    let responseMessage = ''

    if (result.valid) {
      responseMessage = `✅ **Icons Validation PASSED**\n\n`
      responseMessage += `📊 **Summary:**\n`
      responseMessage += `- Files scanned: ${result.scannedFiles.length}\n`
      responseMessage += `- Errors found: 0\n`
      responseMessage += `- Warnings: ${result.warnings.length}\n\n`

      if (result.warnings.length > 0) {
        responseMessage += `⚠️ **Warnings:**\n`
        result.warnings.forEach(warning => {
          responseMessage += `- **${warning.file}**: ${warning.message}\n`
        })
        responseMessage += '\n'
      }

      responseMessage += `🎉 **All icons are valid!** Your site is ready for production.`
    } else {
      responseMessage = `❌ **Icons Validation FAILED**\n\n`
      responseMessage += `📊 **Summary:**\n`
      responseMessage += `- Files scanned: ${result.scannedFiles.length}\n`
      responseMessage += `- Errors found: ${result.errors.length}\n`
      responseMessage += `- Warnings: ${result.warnings.length}\n\n`

      responseMessage += `🚨 **Critical Errors:**\n`
      result.errors.forEach(error => {
        responseMessage += `- **${error.file}**: ${error.message}\n`
      })

      if (result.warnings.length > 0) {
        responseMessage += `\n⚠️ **Warnings:**\n`
        result.warnings.forEach(warning => {
          responseMessage += `- **${warning.file}**: ${warning.message}\n`
        })
      }

      if (fixSuggestions && result.fixSuggestions.length > 0) {
        responseMessage += `\n💡 **Fix Suggestions:**\n`
        result.fixSuggestions.forEach(suggestion => {
          responseMessage += `- ${suggestion}\n`
        })
      }

      responseMessage += `\n🔧 **Next Steps**: Fix the errors above to ensure your site works correctly in production.`
    }

    return responseMessage
  }
)
