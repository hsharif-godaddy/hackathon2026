import {
  type AgentConfig,
  createPromptBuilder,
  createHandoffTool,
  type SessionStateManager,
} from '@airo/ai-lib'
import { getAgentModelWithName } from '../utils/model-selection.js'
import { getModularPromptPaths } from '../utils/prompt-utils.js'
import { allAILibTools } from '../tools/ai-lib-tools/index.js'
import { createAgentTelemetryLogger } from '../utils/agent-logger.js'

/**
 * Initial Agent - Creates single-page preview plans for new apps
 * 
 * This agent is only used for brand new apps with no conversation history.
 * It creates a minimal todo list for a single-page preview and hands off to develop agent.
 * 
 * Prompt structure:
 * - core.md: Core role, workflow, and rules
 * - attributes.md: Attribute discovery for personalization
 * - guidelines.md: Detailed planning instructions
 * - examples.md: Pattern demonstrations
 * - security.md: Content restrictions
 */

/**
 * Build the system prompt for the Initial Agent
 */
async function buildInitialSystemPrompt(): Promise<string> {
  const promptBuilder = createPromptBuilder()
  const paths = getModularPromptPaths(import.meta.url)

  promptBuilder.file(paths.getAgentFile('initial', 'core.md'))
  promptBuilder.file(paths.getAgentFile('initial', 'attributes.md'))
  promptBuilder.file(paths.getAgentFile('initial', 'guidelines.md'))
  promptBuilder.file(paths.getAgentFile('initial', 'examples.md'))
  promptBuilder.file(paths.getSharedFile('security.md'))

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
    setProjectName: allAILibTools.setProjectName,
    askQuestion: allAILibTools.askQuestion,
    websiteRebuild: allAILibTools.websiteRebuild,
  }

  if (handoffTool) {
    tools.handoff = handoffTool
  }

  return {
    id: 'initial',
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

    // Stop after websiteRebuild or askQuestion tools
    stopAfterTools: handoffTool ? ['handoff', 'websiteRebuild', 'askQuestion'] : ['websiteRebuild', 'askQuestion'],

    maxSteps: 10,
    temperature: 0.5,
    maxOutputTokens: 2000,
    logger: createAgentTelemetryLogger('initial'),

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
