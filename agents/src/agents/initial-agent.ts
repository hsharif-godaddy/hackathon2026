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
 * Initial Agent - Creates a simple preview for new apps
 * 
 * This agent is only used for brand new apps with no conversation history.
 * It creates a simple, style-focused preview page and hands off to develop agent.
 */

/**
 * Build the system prompt for the Initial Agent
 */
async function buildInitialSystemPrompt(): Promise<string> {
  const promptBuilder = createPromptBuilder()

  const paths = getModularPromptPaths(import.meta.url)

  promptBuilder
    .file(paths.getAgentFile('initial', 'core.md'))

  return await promptBuilder.build()
}

/**
 * Create the Initial Agent configuration
 */
export async function createInitialAgent(
  stateManager?: SessionStateManager
): Promise<AgentConfig> {
  const systemPrompt = await buildInitialSystemPrompt()
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
        description: 'Hand off to development agent to implement the preview page',
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
