import { type AgentConfig, createPromptBuilder } from '@airo/ai-lib'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

import { allAILibTools } from '../tools/ai-lib-tools/index.js'
import { logger } from '../logging/index.js'
import { createAgentTelemetryLogger } from '../utils/agent-logger.js'
import { getAgentModelWithName } from '../utils/model-selection.js'

function hasInteractiveRunAgent(): (result: unknown) => boolean {
  return (result: unknown): boolean => {
    const r = result as { steps?: Array<{ content: Array<{ type: string; toolName?: string; output?: unknown }> }> } | null
    if (!r?.steps) return false
    for (const step of r.steps) {
      for (const item of step.content) {
        if (item.type === 'tool-result' && item.output) {
          const parsed = typeof item.output === 'string'
            ? (() => { try { return JSON.parse(item.output as string) } catch { return null } })()
            : item.output
          if (parsed && typeof parsed === 'object' && (parsed as Record<string, unknown>).interactive === true) {
            return true
          }
        }
      }
    }
    return false
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function createDeepBuildAgent(): Promise<AgentConfig> {
  const promptsDir = join(__dirname, '..', 'prompts')

  const promptBuilder = createPromptBuilder()
  promptBuilder.file(join(promptsDir, 'deep-build', 'core.md'))
  promptBuilder.file(join(promptsDir, 'shared', 'communication.md'))
  promptBuilder.file(join(promptsDir, 'shared', 'security.md'))

  const system = await promptBuilder.build({})
  const { model, modelName } = await getAgentModelWithName('full')

  const config: AgentConfig = {
    id: 'deep-build',
    name: 'Deep Build',
    system,
    model,
    modelName,
    tools: {
      askQuestion: allAILibTools.askQuestion,
      runAgent: allAILibTools.runAgent,
      awaitAgents: allAILibTools.awaitAgents,
      todoList: allAILibTools.todoList,
      showDoc: allAILibTools.showDoc,
      readFile: allAILibTools.readFile,
      str_replace_based_edit_tool: allAILibTools['str_replace_based_edit_tool'],
      skill: allAILibTools.skill,
    },
    stopAfterTools: ['askQuestion'],
    stopWhen: [hasInteractiveRunAgent()],
    maxSteps: 100,
    temperature: 0.3,
    maxOutputTokens: 16000,
    timeout: { stepMs: 600_000 },
    enablePromptCaching: true,
    logger: createAgentTelemetryLogger('deep-build'),
    metadata: {
      contextPreferences: {
        includeTemplateDescription: false,
      },
    },
  }

  logger.info('deep_build_agent.config_created', { toolCount: Object.keys(config.tools!).length })

  return config
}
