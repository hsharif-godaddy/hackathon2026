import type { SubAgentConfig } from '../sub-agent-runner.js'
import { buildSystemPrompt, pickTools } from './sub-agent-helpers.js'
import { mediaExtractor } from './visual-output-extractors.js'

/**
 * Media/asset Task Worker sub-agent (AIROBUILD-3234). A neutral background worker with NO
 * opinionated, pipeline-specific system prompt — the dispatching agent drives all behavior
 * through the task string. Used by the design-kit wizard for its self-contained media
 * side-tasks (search mood imagery into slots, run the media-logo skill) instead of the
 * deep-build `media` agent, whose prompt assumes a plan + `docs/design.md` and would have to
 * be fought with task-side negations when reused outside deep-build.
 *
 * Toolset is fixed to `media` + `skill` ONLY — programmatically, not via a caller-supplied
 * allow-list (which would depend on the orchestrator remembering to pass it). It structurally
 * CANNOT write source files or run builds, so a media task can never wander into editing the
 * app or re-generating assets a different dispatch already produced. File-writing work (e.g.
 * the brand showcase) goes to a dedicated file-only agent instead. No template-context
 * injection, so no framework/template convention biases a media task.
 */
export async function createTaskWorkerConfig(): Promise<SubAgentConfig> {
  return {
    id: 'task-worker',
    name: 'Task Worker',
    system: await buildSystemPrompt(import.meta.url, 'task-worker.md'),
    tools: pickTools('media', 'skill'),
    model: 'claude-sonnet-4-6',
    maxSteps: 40,
    enablePromptCaching: true,
    visualOutputExtractors: [mediaExtractor],
  }
}
