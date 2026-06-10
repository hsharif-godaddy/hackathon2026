import { createPromptBuilder } from '@airo/ai-lib'
import { readFile, readdir } from 'fs/promises'

import type { SubAgentConfig } from '../sub-agent-runner.js'
import { resolveTemplateContext, type TemplateContextConfig } from '../template-context.js'
import { allAILibTools } from '../../tools/ai-lib-tools/index.js'
import { getModularPromptPaths } from '../../utils/prompt-utils.js'
import { mediaExtractor } from './visual-output-extractors.js'

export async function createMediaConfig(appPath: string): Promise<SubAgentConfig> {
  const paths = getModularPromptPaths(import.meta.url, 2)
  const promptBuilder = createPromptBuilder()
  promptBuilder.file(paths.getAgentFile('sub-agents', 'media.md'))

  const config: TemplateContextConfig = { mode: 'files', paths: ['docs/reference/media-slots.md'] }
  const templateContext = await resolveTemplateContext(
    config,
    appPath,
    {
      readFile: async (p: string) => readFile(p, 'utf-8'),
      listDir: async (p: string) => (await readdir(p)).filter((f: string) => f.endsWith('.md')),
    }
  )
  if (templateContext) {
    promptBuilder.text(`\n\n## Media Slot System Reference\n\n${templateContext}`)
  }

  const system = await promptBuilder.build({})

  return {
    id: 'media',
    name: 'Media',
    system,
    tools: {
      media: allAILibTools['media']!,
      skill: allAILibTools['skill']!,
      readFile: allAILibTools['readFile']!,
      directoryListing: allAILibTools['directoryListing']!,
      terminalCommand: allAILibTools['terminalCommand']!,
    },
    model: 'claude-sonnet-4-6',
    maxSteps: 30,
    enablePromptCaching: true,
    visualOutputExtractors: [mediaExtractor],
  }
}
