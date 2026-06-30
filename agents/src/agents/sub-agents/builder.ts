import type { SubAgentConfig } from '../sub-agent-runner.js'
import { buildSystemPrompt, pickTools, GROUND_TRUTH_HEADING } from './sub-agent-helpers.js'
import { pageExtractor, docExtractor } from './visual-output-extractors.js'

export async function createBuilderConfig(): Promise<SubAgentConfig> {
  return {
    id: 'builder',
    name: 'Builder',
    system: await buildSystemPrompt(import.meta.url, 'builder.md', {
      config: { mode: 'summary' },
      heading: GROUND_TRUTH_HEADING,
    }),
    tools: pickTools(
      'reference', 'str_replace_based_edit_tool', 'readFile', 'directoryListing',
      'grepSearch', 'terminalCommand', 'skill', 'serverRestart', 'viewLogs', 'showDoc',
    ),
    model: 'claude-sonnet-4-6',
    maxSteps: 100,
    enablePromptCaching: true,
    visualOutputExtractors: [pageExtractor, docExtractor],
  }
}

export async function createInteractiveBuilderConfig(agentId: string): Promise<SubAgentConfig> {
  return {
    id: agentId,
    name: 'Builder (Interactive)',
    system: await buildSystemPrompt(import.meta.url, 'builder.md', {
      config: { mode: 'summary' },
      heading: GROUND_TRUTH_HEADING,
    }),
    tools: pickTools(
      'reference', 'str_replace_based_edit_tool', 'readFile', 'directoryListing',
      'grepSearch', 'terminalCommand', 'skill', 'requestSecrets', 'askQuestion',
      'serverRestart', 'viewLogs', 'showDoc',
    ),
    model: 'claude-sonnet-4-6',
    maxSteps: 100,
    enablePromptCaching: true,
    visualOutputExtractors: [pageExtractor, docExtractor],
  }
}
