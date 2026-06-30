import type { SubAgentConfig } from '../sub-agent-runner.js'
import { buildSystemPrompt, pickTools } from './sub-agent-helpers.js'

export async function createWorkflowInitConfig(): Promise<SubAgentConfig> {
  return {
    id: 'workflow-init',
    name: 'WorkflowInit',
    system: await buildSystemPrompt(import.meta.url, 'workflow-init.md'),
    tools: pickTools('reference', 'readFile', 'directoryListing'),
    model: 'claude-sonnet-4-6',
    maxSteps: 15,
    enablePromptCaching: true,
  }
}
