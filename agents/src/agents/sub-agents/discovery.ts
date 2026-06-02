import { createPromptBuilder } from '@airo/ai-lib'
import { readFile, readdir } from 'fs/promises'

import type { SubAgentConfig } from '../sub-agent-runner.js'
import { resolveTemplateContext, type TemplateContextConfig } from '../template-context.js'
import { allAILibTools } from '../../tools/ai-lib-tools/index.js'
import { getModularPromptPaths } from '../../utils/prompt-utils.js'

export async function createDiscoveryConfig(appPath: string): Promise<SubAgentConfig> {
  const paths = getModularPromptPaths(import.meta.url, 2)
  const promptBuilder = createPromptBuilder()
  promptBuilder.file(paths.getAgentFile('sub-agents', 'discovery.md'))

  const config: TemplateContextConfig = { mode: 'listing' }
  const templateContext = await resolveTemplateContext(
    config,
    appPath,
    {
      readFile: async (p: string) => readFile(p, 'utf-8'),
      listDir: async (p: string) => (await readdir(p)).filter((f: string) => f.endsWith('.md')),
    }
  )
  if (templateContext) {
    promptBuilder.text(`\n\n${templateContext}`)
  }

  const system = await promptBuilder.build({})

  return {
    id: 'discovery',
    name: 'Discovery',
    system,
    tools: {
      readFile: allAILibTools['readFile']!,
      directoryListing: allAILibTools['directoryListing']!,
      grepSearch: allAILibTools['grepSearch']!,
      terminalCommand: allAILibTools['terminalCommand']!,
      websiteScraper: allAILibTools['websiteScraper']!,
    },
    model: 'claude-sonnet-4-6',
    maxSteps: 50,
    enablePromptCaching: true,
  }
}
