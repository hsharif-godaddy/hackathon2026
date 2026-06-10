import { createPromptBuilder } from '@airo/ai-lib'

import type { SubAgentConfig } from '../sub-agent-runner.js'
import { allAILibTools } from '../../tools/ai-lib-tools/index.js'
import { getModularPromptPaths } from '../../utils/prompt-utils.js'

export async function createPlanReviewConfig(_appPath: string): Promise<SubAgentConfig> {
  const paths = getModularPromptPaths(import.meta.url, 2)
  const promptBuilder = createPromptBuilder()
  promptBuilder.file(paths.getAgentFile('sub-agents', 'plan-review.md'))

  const system = await promptBuilder.build({})

  return {
    id: 'plan-review',
    name: 'Plan Review',
    system,
    tools: {
      readFile: allAILibTools['readFile']!,
      directoryListing: allAILibTools['directoryListing']!,
      grepSearch: allAILibTools['grepSearch']!,
      str_replace_based_edit_tool: allAILibTools['str_replace_based_edit_tool']!,
    },
    model: 'claude-sonnet-4-6',
    maxSteps: 30,
    enablePromptCaching: true,
  }
}
