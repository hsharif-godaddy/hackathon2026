import { createPromptBuilder } from '@airo/ai-lib'
import { readFile, readdir } from 'fs/promises'

import type { SubAgentConfig } from '../sub-agent-runner.js'
import { resolveTemplateContext, type TemplateContextConfig } from '../template-context.js'
import { allAILibTools } from '../../tools/ai-lib-tools/index.js'
import { getModularPromptPaths } from '../../utils/prompt-utils.js'
import { docExtractor } from './visual-output-extractors.js'

export async function createPlanningConfig(appPath: string): Promise<SubAgentConfig> {
  const paths = getModularPromptPaths(import.meta.url, 2)
  const promptBuilder = createPromptBuilder()
  promptBuilder.file(paths.getAgentFile('sub-agents', 'planning.md'))

  const config: TemplateContextConfig = { mode: 'summary' }
  const templateContext = await resolveTemplateContext(
    config,
    appPath,
    {
      readFile: async (p: string) => readFile(p, 'utf-8'),
      listDir: async (p: string) => (await readdir(p)).filter((f: string) => f.endsWith('.md')),
    }
  )
  if (templateContext) {
    promptBuilder.text(`\n\n## Reference Documentation (Ground Truth)\n\nThe following describes the actual tech stack and conventions of this project. Never contradict this information — it takes precedence over any assumptions.\n\n${templateContext}`)
  }

  const system = await promptBuilder.build({})

  return {
    id: 'planning',
    name: 'Planning',
    system,
    tools: {
      readFile: allAILibTools['readFile']!,
      directoryListing: allAILibTools['directoryListing']!,
      grepSearch: allAILibTools['grepSearch']!,
      str_replace_based_edit_tool: allAILibTools['str_replace_based_edit_tool']!,
      skill: allAILibTools['skill']!,
      showDoc: allAILibTools['showDoc']!,
    },
    model: 'claude-opus-4-7',
    maxSteps: 50,
    enablePromptCaching: true,
    visualOutputExtractors: [docExtractor],
  }
}
