import { createPromptBuilder, type AgentConfig } from '@airo/ai-lib'
import { getAgentModelWithName } from '../utils/model-selection.js'
import { allAILibTools } from '../tools/ai-lib-tools/index.js'
import { getModularPromptPaths } from '../utils/prompt-utils.js'
import { createAgentTelemetryLogger } from '../utils/agent-logger.js'

export async function createDebugAgent(): Promise<AgentConfig> {
  const promptBuilder = createPromptBuilder()
  const paths = getModularPromptPaths(import.meta.url)

  const systemPrompt = await promptBuilder
    .file(paths.getAgentFile('debug', 'core.md'))
    .build()

  const { model, modelName } = await getAgentModelWithName('fast')

  return {
    id: 'debug',
    name: 'Debug Agent',
    system: systemPrompt,
    model,
    modelName,
    tools: {
      viewLogs: allAILibTools.viewLogs,
      serverStatus: allAILibTools.serverStatus,
      serverRestart: allAILibTools.serverRestart,
      terminalCommand: allAILibTools.terminalCommand,
      readFile: allAILibTools.readFile,
      directoryListing: allAILibTools.directoryListing,
      grepSearch: allAILibTools.grepSearch,
    },
    handoffs: [],
    maxSteps: 20,
    temperature: 0.2,
    logger: createAgentTelemetryLogger('debug'),
  }
}
