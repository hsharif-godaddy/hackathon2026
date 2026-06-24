import type { SubAgentConfig } from '../sub-agent-runner.js'
import { buildSystemPrompt, pickTools } from './sub-agent-helpers.js'

export async function createDiscoveryConfig(): Promise<SubAgentConfig> {
  return {
    id: 'discovery',
    name: 'Discovery',
    system: await buildSystemPrompt(import.meta.url, 'discovery.md', {
      config: { mode: 'listing' },
    }),
    tools: pickTools(
      'reference', 'readFile', 'directoryListing',
      'grepSearch', 'terminalCommand', 'websiteScraper',
    ),
    model: 'claude-sonnet-4-6',
    maxSteps: 50,
    enablePromptCaching: true,
  }
}
