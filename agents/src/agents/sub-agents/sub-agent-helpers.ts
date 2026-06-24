import { createPromptBuilder, type Tool } from '@airo/ai-lib'

import { allAILibTools, type ToolName } from '../../tools/ai-lib-tools/index.js'
import { getModularPromptPaths } from '../../utils/prompt-utils.js'
import { resolveTemplateContext, type TemplateContextConfig } from '../template-context.js'

/** Preamble for sub-agents that inject the template reference summary as authoritative context. */
export const GROUND_TRUTH_HEADING: string =
  '## Reference Documentation (Ground Truth)\n\nThe following describes the actual tech stack and conventions of this project. Never contradict this information — it takes precedence over any assumptions.'

export interface TemplateContextInjection {
  config: TemplateContextConfig
  /** Optional section heading rendered above the injected context. */
  heading?: string
}

/**
 * Build a sub-agent system prompt: load its markdown prompt file and, when a
 * template-context injection is provided, append the resolved reference context.
 *
 * `moduleUrl` must be the calling config module's `import.meta.url` so the prompt
 * path resolves relative to that file (depth 2 → agents/src/prompts).
 */
export async function buildSystemPrompt(
  moduleUrl: string,
  promptFile: string,
  injection?: TemplateContextInjection
): Promise<string> {
  const paths = getModularPromptPaths(moduleUrl, 2)
  const promptBuilder = createPromptBuilder()
  promptBuilder.file(paths.getAgentFile('sub-agents', promptFile))

  if (injection) {
    const templateContext: string = await resolveTemplateContext(injection.config)
    if (templateContext) {
      const body: string = injection.heading
        ? `\n\n${injection.heading}\n\n${templateContext}`
        : `\n\n${templateContext}`
      promptBuilder.text(body)
    }
  }

  return promptBuilder.build({})
}

/** Select tools from the registry by name, preserving order. Names are checked at compile time. */
export function pickTools(...names: ToolName[]): Record<string, Tool> {
  const tools: Record<string, Tool> = {}
  for (const name of names) {
    tools[name] = allAILibTools[name]
  }
  return tools
}
