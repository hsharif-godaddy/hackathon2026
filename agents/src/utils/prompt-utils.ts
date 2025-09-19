import path from 'path'
import { fileURLToPath } from 'url'

/**
 * Get the path to a prompt file in the prompts directory
 * @param agentName - The name of the agent (e.g., 'develop', 'database', 'color-scheme', 'example')
 * @param currentModuleUrl - The import.meta.url of the calling module
 * @returns The full path to the prompt file
 */
export function getPromptPath(agentName: string, currentModuleUrl: string): string {
  const currentDir = path.dirname(fileURLToPath(currentModuleUrl))
  const promptsDir = path.resolve(currentDir, '..', 'prompts')
  return path.join(promptsDir, `${agentName}.md`)
}

/**
 * Get the path to a template description file in the prompts/template-descriptions directory
 * @param version - The version string (e.g., 'v1.0.0')
 * @param currentModuleUrl - The import.meta.url of the calling module
 * @returns The full path to the template description file
 */
export function getTemplateDescriptionPath(version: string, currentModuleUrl: string): string {
  const currentDir = path.dirname(fileURLToPath(currentModuleUrl))
  const promptsDir = path.resolve(currentDir, '..', 'prompts')
  return path.join(promptsDir, 'template-descriptions', `${version}.md`)
}
