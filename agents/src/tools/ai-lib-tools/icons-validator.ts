import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { validateLucideIcons } from '../icons-validator.js'
import { createForWorkspace } from '../../workspace/index.js'

/**
 * Icons Validator Tool for AI-Lib
 * Validate icons used in generated content
 */
export const iconsValidatorAITool: Tool = createTool(
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

    const workspace = createForWorkspace(appId, 'preview')
    if (!workspace) {
      throw new Error(`Workspace for app '${appId}' is not available`)
    }

    const files = input.files || []
    const fixSuggestions = input.fixSuggestions !== false

    const result = await validateLucideIcons(workspace.files, files)

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
