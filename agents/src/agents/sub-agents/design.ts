import type { SubAgentConfig } from '../sub-agent-runner.js'
import { buildSystemPrompt, pickTools } from './sub-agent-helpers.js'
import { docExtractor } from './visual-output-extractors.js'

export async function createDesignConfig(): Promise<SubAgentConfig> {
  return {
    id: 'design',
    name: 'Design',
    system: await buildSystemPrompt(import.meta.url, 'design.md'),
    tools: pickTools(
      'readFile', 'str_replace_based_edit_tool', 'directoryListing',
      'websiteScraper', 'showDoc', 'skill',
    ),
    model: 'claude-opus-4-7',
    maxSteps: 30,
    enablePromptCaching: true,
    visualOutputExtractors: [docExtractor],
  }
}
