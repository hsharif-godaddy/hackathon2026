import path from 'path'
import { fileURLToPath } from 'url'
import { readFileSync, existsSync } from 'fs'

/**
 * Prompt Utilities for Modular Agent System
 * 
 * This module provides utilities for working with the modular prompt system.
 * Instead of manually constructing paths with join() and dirname(), use these
 * helpers to get clean, consistent paths to prompt files and directories.
 * 
 * @example
 * // Old way (manual path construction)
 * const promptsDir = dirname(getPromptPath('develop', import.meta.url))
 * const developDir = join(promptsDir, 'develop')
 * const sharedDir = join(promptsDir, 'shared')
 * 
 * // New way (using helpers)
 * const paths = getModularPromptPaths(import.meta.url)
 * const developCore = paths.getAgentFile('develop', 'core.md')
 * const sharedComm = paths.getSharedFile('communication.md')
 */

/**
 * Valid template versions that are allowed in the system
 * This enum prevents path traversal through version parameter validation
 */
export enum TemplateVersion {
  V8 = 'v8'
  // Add new versions here as they become available
}

/**
 * Safely read and validate the version from a .version file
 * @param appPath - Path to the application directory containing .version file
 * @returns Valid TemplateVersion or null if invalid/missing
 */
export function getValidatedTemplateVersion(appPath: string): TemplateVersion | null {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  // Safe: appPath comes from internal agent configuration, '.version' is static literal
  const versionPath = path.join(appPath, '.version')
  
  if (!existsSync(versionPath)) {
    return null
  }
  
  try {
    const versionContent = readFileSync(versionPath, 'utf-8').trim()
    
    // Validate against allowed enum values
    const validVersions = Object.values(TemplateVersion) as string[]
    if (validVersions.includes(versionContent)) {
      return versionContent as TemplateVersion
    }
    
    console.warn(`Invalid template version in .version file: ${versionContent}. Allowed: ${validVersions.join(', ')}`)
    return null
  } catch (error) {
    console.warn('Failed to read .version file:', error)
    return null
  }
}

/**
 * Get the base prompts directory path
 * @param currentModuleUrl - The import.meta.url of the calling module
 * @returns The full path to the prompts directory
 */
function getPromptsDir(currentModuleUrl: string): string {
  const currentDir = path.dirname(fileURLToPath(currentModuleUrl))
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  // Safe: Uses static literals relative to module location, no user input
  return path.resolve(currentDir, '..', 'prompts')
}

/**
 * Get the path to a prompt file in the prompts directory
 * @param agentName - The name of the agent (e.g., 'develop', 'database', 'color-scheme', 'example')
 * @param currentModuleUrl - The import.meta.url of the calling module
 * @returns The full path to the prompt file
 */
export function getPromptPath(agentName: string, currentModuleUrl: string): string {
  const promptsDir = getPromptsDir(currentModuleUrl)
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  // Safe: agentName is developer-controlled, not user input (e.g., 'develop', 'database')
  return path.join(promptsDir, `${agentName}.md`)
}

/**
 * Get the path to a template description file in the prompts/template-descriptions directory
 * @param version - The validated template version from TemplateVersion enum
 * @param currentModuleUrl - The import.meta.url of the calling module
 * @returns The full path to the template description file
 */
export function getTemplateDescriptionPath(version: TemplateVersion, currentModuleUrl: string): string {
  const promptsDir = getPromptsDir(currentModuleUrl)
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  // Safe: version is validated TemplateVersion enum value, not arbitrary user input
  return path.join(promptsDir, 'template-descriptions', `${version}.md`)
}

/**
 * Get the path to an agent's modular prompt directory
 * @param agentName - The name of the agent (e.g., 'develop', 'database', 'color-scheme', 'example')
 * @param currentModuleUrl - The import.meta.url of the calling module
 * @returns The full path to the agent's prompt directory
 */
export function getAgentPromptDir(agentName: string, currentModuleUrl: string): string {
  const promptsDir = getPromptsDir(currentModuleUrl)
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  // Safe: agentName is developer-controlled, not user input (e.g., 'develop', 'database')
  return path.join(promptsDir, agentName)
}

/**
 * Get the path to the shared prompts directory
 * @param currentModuleUrl - The import.meta.url of the calling module
 * @returns The full path to the shared prompts directory
 */
export function getSharedPromptDir(currentModuleUrl: string): string {
  const promptsDir = getPromptsDir(currentModuleUrl)
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  // Safe: Uses static literal 'shared', no user input
  return path.join(promptsDir, 'shared')
}

/**
 * Get the path to a specific prompt file within an agent's modular directory
 * @param agentName - The name of the agent (e.g., 'develop', 'database', 'color-scheme', 'example')
 * @param fileName - The prompt file name (e.g., 'core.md', 'tools.md')
 * @param currentModuleUrl - The import.meta.url of the calling module
 * @returns The full path to the specific prompt file
 */
export function getAgentPromptFile(agentName: string, fileName: string, currentModuleUrl: string): string {
  const agentDir = getAgentPromptDir(agentName, currentModuleUrl)
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  // Safe: fileName is developer-controlled, not user input (e.g., 'core.md', 'tools.md')
  return path.join(agentDir, fileName)
}

/**
 * Get the path to a specific shared prompt file
 * @param fileName - The shared prompt file name (e.g., 'communication.md', 'security.md')
 * @param currentModuleUrl - The import.meta.url of the calling module
 * @returns The full path to the shared prompt file
 */
export function getSharedPromptFile(fileName: string, currentModuleUrl: string): string {
  const sharedDir = getSharedPromptDir(currentModuleUrl)
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  // Safe: fileName is developer-controlled, not user input (e.g., 'communication.md', 'security.md')
  return path.join(sharedDir, fileName)
}

/**
 * Modular prompt builder helper that returns common directory paths
 * @param currentModuleUrl - The import.meta.url of the calling module
 * @returns Object with common directory paths for building modular prompts
 */
export function getModularPromptPaths(currentModuleUrl: string) {
  return {
    promptsDir: getPromptsDir(currentModuleUrl),
    sharedDir: getSharedPromptDir(currentModuleUrl),
    getAgentDir: (agentName: string) => getAgentPromptDir(agentName, currentModuleUrl),
    getAgentFile: (agentName: string, fileName: string) => getAgentPromptFile(agentName, fileName, currentModuleUrl),
    getSharedFile: (fileName: string) => getSharedPromptFile(fileName, currentModuleUrl)
  }
}
