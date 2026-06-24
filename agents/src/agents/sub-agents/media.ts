import type { SubAgentConfig } from '../sub-agent-runner.js'
import { buildSystemPrompt, pickTools } from './sub-agent-helpers.js'
import { mediaExtractor } from './visual-output-extractors.js'

export async function createMediaConfig(): Promise<SubAgentConfig> {
  return {
    id: 'media',
    name: 'Media',
    system: await buildSystemPrompt(import.meta.url, 'media.md', {
      config: { mode: 'files', paths: ['media-slots.md'] },
      heading: '## Media Slot System Reference',
    }),
    tools: pickTools(
      'reference', 'media', 'skill',
      'readFile', 'directoryListing', 'terminalCommand',
    ),
    model: 'claude-sonnet-4-6',
    maxSteps: 30,
    enablePromptCaching: true,
    visualOutputExtractors: [mediaExtractor],
  }
}
