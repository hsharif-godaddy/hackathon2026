import type { SubAgentConfig } from '../sub-agent-runner.js'
import { buildSystemPrompt, pickTools } from './sub-agent-helpers.js'

export async function createPlanReviewConfig(): Promise<SubAgentConfig> {
  return {
    id: 'plan-review',
    name: 'Plan Review',
    system: await buildSystemPrompt(import.meta.url, 'plan-review.md'),
    tools: pickTools(
      'reference', 'readFile', 'directoryListing',
      'grepSearch', 'str_replace_based_edit_tool',
    ),
    model: 'claude-sonnet-4-6',
    maxSteps: 30,
    enablePromptCaching: true,
  }
}
