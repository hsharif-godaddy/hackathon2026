import type { SubAgentConfig } from '../sub-agent-runner.js'
import { buildSystemPrompt, pickTools } from './sub-agent-helpers.js'

export async function createDeveloperTypecheckConfig(): Promise<SubAgentConfig> {
  return {
    id: 'developer-typecheck',
    name: 'Type Checker',
    system: await buildSystemPrompt(import.meta.url, 'developer-typecheck.md'),
    tools: pickTools(
      'reference', 'readFile', 'directoryListing',
      'grepSearch', 'str_replace_based_edit_tool', 'terminalCommand',
    ),
    model: 'claude-haiku-4-5',
    maxSteps: 40,
    temperature: 0.1,
    enablePromptCaching: true,
    // GoCode/LiteLLM rejects tools.*.eager_input_streaming; @ai-sdk/anthropic
    // enables it by default when streaming with tools (toolStreaming defaults true).
    providerOptions: { anthropic: { toolStreaming: false } },
  }
}
