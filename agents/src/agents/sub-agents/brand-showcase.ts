import type { SubAgentConfig } from '../sub-agent-runner.js'
import { buildSystemPrompt, pickTools } from './sub-agent-helpers.js'
import { docExtractor } from './visual-output-extractors.js'

/**
 * Brand Showcase sub-agent (AIROBUILD-3234). Writes the single standalone
 * `public/brand-showcase.html` brand-specimen page from brand content inlined in its task.
 *
 * Dedicated (not the generic task-worker) because it needs specific, tailored instructions —
 * static HTML only, style from `/brand-tokens.css` variables, and REFERENCE the already-generated
 * logo/mood slots by URL rather than re-creating them. Its toolset is fixed to file + showDoc
 * tools ONLY, with NO `media`/`skill`: this is a programmatic guarantee (not a caller-supplied
 * allow-list the orchestrator might forget) that it can't re-run media search or logo generation
 * — the regression seen when the showcase ran on a media-capable generic worker. No
 * template-context injection: the showcase is plain HTML, so template conventions don't apply.
 */
export async function createBrandShowcaseConfig(): Promise<SubAgentConfig> {
  return {
    id: 'brand-showcase',
    name: 'Brand Showcase',
    system: await buildSystemPrompt(import.meta.url, 'brand-showcase.md'),
    tools: pickTools('str_replace_based_edit_tool', 'readFile', 'directoryListing', 'showDoc'),
    model: 'claude-sonnet-4-6',
    maxSteps: 40,
    // The showcase is one HTML file that can be large; lift the 16k default so a single section
    // write isn't truncated (finishReason: length). The prompt still requires incremental writes.
    maxOutputTokens: 32000,
    enablePromptCaching: true,
    visualOutputExtractors: [docExtractor],
  }
}
