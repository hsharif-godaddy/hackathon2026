import {
  type AgentConfig,
  createPromptBuilder,
  createHandoffTool,
  type SessionStateManager,
} from '@airo/ai-lib'
import { getAgentModelWithName } from '../utils/model-selection.js'
import { getModularPromptPaths } from '../utils/prompt-utils.js'
import { allAILibTools } from '../tools/ai-lib-tools/index.js'

/**
 * Initial Agent - Creates single-page preview plans for new apps
 * 
 * This agent is only used for brand new apps with no conversation history.
 * It creates a minimal todo list for a single-page preview and hands off to develop agent.
 * 
 * Prompt structure:
 * - core.md: Core role, workflow, and rules (always included)
 * - guidelines.md: Detailed planning instructions (optional, enabled by default)
 * - examples.md: Pattern demonstrations (optional, enabled by default)
 */

/**
 * Build the system prompt for the Initial Agent
 */
async function buildInitialSystemPrompt(options?: {
  includeGuidelines?: boolean
  includeExamples?: boolean
}): Promise<string> {
  const {
    includeGuidelines = true,
    includeExamples = true
  } = options || {}

  const promptBuilder = createPromptBuilder()
  const paths = getModularPromptPaths(import.meta.url)

  // Core role and workflow (always included)
  promptBuilder.file(paths.getAgentFile('initial', 'core.md'))

  // Guidelines (optional - detailed planning instructions)
  if (includeGuidelines) {
    promptBuilder.file(paths.getAgentFile('initial', 'guidelines.md'))
  }

  // Examples (optional - pattern demonstrations)
  if (includeExamples) {
    promptBuilder.file(paths.getAgentFile('initial', 'examples.md'))
  }

  return await promptBuilder.build()
}

/**
 * Create the Initial Agent configuration
 */
export async function createInitialAgent(
  stateManager?: SessionStateManager,
  options?: {
    includeGuidelines?: boolean
    includeExamples?: boolean
  }
): Promise<AgentConfig> {
  const systemPrompt = await buildInitialSystemPrompt(options)
  const { model, modelName } = await getAgentModelWithName('fast')

  const handoffTool = stateManager
    ? createHandoffTool({
        sourceAgentId: 'initial',
        validTargets: ['develop'],
        stateManager
      })
    : undefined

  const tools: Record<string, unknown> = {
    todoList: allAILibTools.todoList,
  }

  if (handoffTool) {
    tools.handoff = handoffTool
  }

  return {
    name: 'Initial',
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

    stopAfterTools: handoffTool ? ['handoff'] : [],

    maxSteps: 10,
    temperature: 0.5,
    maxOutputTokens: 2000,

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
