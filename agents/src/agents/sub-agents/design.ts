import { createPromptBuilder } from '@airo/ai-lib'
import { readFile, readdir } from 'fs/promises'

import type { SubAgentConfig } from '../sub-agent-runner.js'
import { resolveTemplateContext, type TemplateContextConfig } from '../template-context.js'
import { allAILibTools } from '../../tools/ai-lib-tools/index.js'
import { getModularPromptPaths } from '../../utils/prompt-utils.js'
import { docExtractor } from './visual-output-extractors.js'

export async function createDesignConfig(appPath: string): Promise<SubAgentConfig> {
  const paths = getModularPromptPaths(import.meta.url, 2)
  const promptBuilder = createPromptBuilder()
  promptBuilder.file(paths.getAgentFile('sub-agents', 'design.md'))

  const config: TemplateContextConfig = { mode: 'none' }
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
    id: 'design',
    name: 'Design',
    system,
    tools: {
      readFile: allAILibTools['readFile']!,
      str_replace_based_edit_tool: allAILibTools['str_replace_based_edit_tool']!,
      directoryListing: allAILibTools['directoryListing']!,
      websiteScraper: allAILibTools['websiteScraper']!,
      showDoc: allAILibTools['showDoc']!,
      skill: allAILibTools['skill']!,
    },
    model: 'claude-opus-4-7',
    maxSteps: 30,
    enablePromptCaching: true,
    visualOutputExtractors: [docExtractor],
  }
}
