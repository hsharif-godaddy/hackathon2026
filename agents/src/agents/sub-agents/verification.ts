import type { SubAgentConfig } from '../sub-agent-runner.js'
import { buildSystemPrompt, pickTools } from './sub-agent-helpers.js'

export async function createVerificationConfig(): Promise<SubAgentConfig> {
  return {
    id: 'verification',
    name: 'Verification',
    system: await buildSystemPrompt(import.meta.url, 'verification.md'),
    tools: pickTools(
      'readFile', 'directoryListing', 'grepSearch',
      'terminalCommand', 'screenshot', 'crawlPages',
    ),
    model: 'claude-sonnet-4-6',
    maxSteps: 40,
    temperature: 0.1,
    enablePromptCaching: true,
  }
}
