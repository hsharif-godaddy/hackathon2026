import { type AgentConfig, createPromptBuilder } from '@airo/ai-lib'

import { allAILibTools } from '../../tools/ai-lib-tools/index.js'
import { returnToParentAITool } from '../../tools/ai-lib-tools/return-to-parent.js'
import { getAgentModelWithName } from '../../utils/model-selection.js'
import { getModularPromptPaths } from '../../utils/prompt-utils.js'
import { createAgentTelemetryLogger } from '../../utils/agent-logger.js'

export async function createInteractiveInterviewConfig(agentId: string): Promise<AgentConfig> {
  const paths = getModularPromptPaths(import.meta.url, 2)
  const promptBuilder = createPromptBuilder()
  promptBuilder.file(paths.getAgentFile('sub-agents', 'interview.md'))

  const system = await promptBuilder.build({})
  const { model, modelName } = await getAgentModelWithName('full')

  return {
    id: agentId,
    name: 'Interview',
    system,
    model,
    modelName,
    tools: {
      askQuestion: allAILibTools['askQuestion']!,
      str_replace_based_edit_tool: allAILibTools['str_replace_based_edit_tool']!,
      readFile: allAILibTools['readFile']!,
      directoryListing: allAILibTools['directoryListing']!,
      showDoc: allAILibTools['showDoc']!,
      skill: allAILibTools['skill']!,
      returnToParent: returnToParentAITool,
    },
    stopAfterTools: ['askQuestion', 'returnToParent'],
    maxSteps: 50,
    temperature: 0.3,
    maxOutputTokens: 16000,
    timeout: { stepMs: 600_000 },
    enablePromptCaching: true,
    logger: createAgentTelemetryLogger(agentId),
    metadata: {
      contextPreferences: {
        includeTemplateDescription: false,
        includeAppContext: true,
        includeVisualContext: false,
        includeAiEditContext: false,
        includeSelectedImages: false,
        includeConversationHistory: true,
      },
    },
  }
}
