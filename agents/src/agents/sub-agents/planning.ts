import type { SubAgentConfig } from '../sub-agent-runner.js'
import { buildSystemPrompt, pickTools, GROUND_TRUTH_HEADING } from './sub-agent-helpers.js'
import { docExtractor } from './visual-output-extractors.js'

export async function createPlanningConfig(): Promise<SubAgentConfig> {
  return {
    id: 'planning',
    name: 'Planning',
    system: await buildSystemPrompt(import.meta.url, 'planning.md', {
      config: { mode: 'summary' },
      heading: GROUND_TRUTH_HEADING,
    }),
    tools: pickTools(
      'reference', 'readFile', 'directoryListing',
      'grepSearch', 'str_replace_based_edit_tool', 'skill', 'showDoc',
    ),
    model: 'claude-opus-4-7',
    maxSteps: 50,
    enablePromptCaching: true,
    visualOutputExtractors: [docExtractor],
  }
}
