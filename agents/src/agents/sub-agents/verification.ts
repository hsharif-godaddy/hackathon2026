import { createPromptBuilder } from '@airo/ai-lib'

import type { SubAgentConfig } from '../sub-agent-runner.js'
import { allAILibTools } from '../../tools/ai-lib-tools/index.js'
import { getModularPromptPaths } from '../../utils/prompt-utils.js'

export async function createVerificationConfig(_appPath: string): Promise<SubAgentConfig> {
  const paths = getModularPromptPaths(import.meta.url, 2)
  const promptBuilder = createPromptBuilder()
  promptBuilder.file(paths.getAgentFile('sub-agents', 'verification.md'))

  const system = await promptBuilder.build({})

  return {
    id: 'verification',
    name: 'Verification',
    system,
    tools: {
      readFile: allAILibTools['readFile']!,
      directoryListing: allAILibTools['directoryListing']!,
      grepSearch: allAILibTools['grepSearch']!,
      terminalCommand: allAILibTools['terminalCommand']!,
      screenshot: allAILibTools['screenshot']!,
      crawlPages: allAILibTools['crawlPages']!,
    },
    model: 'claude-sonnet-4-6',
    maxSteps: 40,
    temperature: 0.1,
    enablePromptCaching: true,
  }
}
