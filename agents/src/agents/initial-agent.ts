import {
  type AgentConfig,
  createPromptBuilder,
  createHandoffTool,
  type SessionStateManager,
} from '@airo/ai-lib'
import { existsSync } from 'fs'
import { getAgentModelWithName } from '../utils/model-selection.js'
import { getModularPromptPaths } from '../utils/prompt-utils.js'
import { allAILibTools } from '../tools/ai-lib-tools/index.js'
import { createAgentTelemetryLogger } from '../utils/agent-logger.js'
import { getTemplate } from './template-registry.js'

/**
 * Initial Agent - Creates single-page preview plans for new apps
 *
 * This agent is only used for brand new apps with no conversation history.
 * It creates a minimal todo list for a single-page preview and hands off to develop agent.
 *
 * Prompt versions (in agents/src/prompts/initial/<version>/):
 * - 1.0: Original with attributes.md and detailed askQuestion framework
 * - 2.0: Simplified askQuestion logic, no attributes.md (10% cheaper, 4s faster, equivalent quality)
 *
 * Each version directory contains: core.md, guidelines.md, examples.md, and optionally attributes.md.
 * Shared files (communication.md, security.md) are appended from the shared/ directory.
 *
 * When a templateId is provided, prompt files are loaded from
 * agents/src/prompts/initial/templates/<templateId>/ instead.
 */

const DEFAULT_PROMPT_VERSION = '1.0'
const OPTIONAL_PROMPT_FILES = ['attributes.md', 'guidelines.md', 'examples.md']

/**
 * Build the system prompt for the Initial Agent
 */
async function buildInitialSystemPrompt(templateId?: string, promptVersion?: string): Promise<string> {
  const promptBuilder = createPromptBuilder()
  const paths = getModularPromptPaths(import.meta.url)

  if (templateId) {
    // Template mode: load from templates/<templateId>/
    const templateDir = `initial/templates/${templateId}`
    promptBuilder.file(paths.getAgentFile(templateDir, 'core.md'))

    for (const file of OPTIONAL_PROMPT_FILES) {
      const filePath = paths.getAgentFile(templateDir, file)
      if (existsSync(filePath)) {
        promptBuilder.file(filePath)
      }
    }
  } else {
    // Versioned mode: load from initial/<version>/
    const version = promptVersion || DEFAULT_PROMPT_VERSION
    const versionDir = `initial/${version}`

    promptBuilder.file(paths.getAgentFile(versionDir, 'core.md'))
    promptBuilder.file(paths.getSharedFile('communication.md'))

    for (const file of OPTIONAL_PROMPT_FILES) {
      const filePath = paths.getAgentFile(versionDir, file)
      if (existsSync(filePath)) {
        promptBuilder.file(filePath)
      }
    }

    promptBuilder.file(paths.getSharedFile('security.md'))
    return await promptBuilder.build()
  }

  // Template mode: shared files appended after template-specific files
  promptBuilder.file(paths.getSharedFile('communication.md'))
  promptBuilder.file(paths.getSharedFile('security.md'))

  return await promptBuilder.build()
}

/**
 * Create the Initial Agent configuration
 * @param stateManager - Optional session state manager for handoff support
 * @param templateId - Optional template ID to use a custom system prompt
 * @param promptVersion - Optional prompt version (e.g., '1.0', '2.0'). Defaults to DEFAULT_PROMPT_VERSION.
 */
export async function createInitialAgent(
  stateManager?: SessionStateManager,
  templateId?: string,
  promptVersion?: string
): Promise<AgentConfig> {
  if (templateId && !getTemplate(templateId)) {
    throw new Error(`Unknown template: ${templateId}`)
  }

  const systemPrompt = await buildInitialSystemPrompt(templateId, promptVersion)
  const { model, modelName } = await getAgentModelWithName('fast')

  const agentId = templateId ? `initial-${templateId}` : 'initial'
  const agentName = templateId ? `Initial (${templateId})` : 'Initial'

  const handoffTool = stateManager
    ? createHandoffTool({
        sourceAgentId: agentId,
        validTargets: ['develop'],
        stateManager
      })
    : undefined

  const tools: Record<string, unknown> = {
    todoList: allAILibTools.todoList,
    setProjectName: allAILibTools.setProjectName,
    askQuestion: allAILibTools.askQuestion,
    websiteRebuild: allAILibTools.websiteRebuild,
  }

  if (handoffTool) {
    tools.handoff = handoffTool
  }

  return {
    id: agentId,
    name: agentName,
    system: systemPrompt,
    model,
    modelName,
    tools,

    handoffs: [
      {
        agentName: 'develop',
        description: 'Hand off to development agent for all site types - single-page, multi-page, dashboards, games, or apps',
      },
    ],

    // Stop after websiteRebuild or askQuestion tools
    stopAfterTools: handoffTool ? ['handoff', 'websiteRebuild', 'askQuestion'] : ['websiteRebuild', 'askQuestion'],

    maxSteps: 10,
    temperature: 0.5,
    maxOutputTokens: 8000,
    timeout: { stepMs: 600_000 },
    providerOptions: {
      anthropic: {
        effort: 'low',
      },
    },
    logger: createAgentTelemetryLogger(agentId),

    // Enable prompt caching for cost savings
    enablePromptCaching: true,

    metadata: {
      contextPreferences: {
        includeAppContext: true,
        includeVisualContext: false,
        includeAiEditContext: false,
        includeSelectedImages: false,
        includeConversationHistory: true,
        includeTemplateDescription: true
      }
    }
  }
}
