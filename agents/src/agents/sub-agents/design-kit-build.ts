import type { SubAgentConfig } from '../sub-agent-runner.js'
import { buildSystemPrompt, pickTools, GROUND_TRUTH_HEADING } from './sub-agent-helpers.js'
import { pageExtractor, docExtractor } from './visual-output-extractors.js'

/**
 * Design-Kit Build sub-agent (AIROBUILD-2871, AIROBUILD-3234). Builds one slice of a
 * website — the site chrome (shared header/footer/layout) or the homepage body — so it
 * faithfully realizes an installed design kit, rather than re-deriving a generic layout.
 * The dispatching task names the slice; the two run in parallel on disjoint files. It
 * self-loads the kit from `docs/ui-kit/` (via `loadUiKit` + reading `anchor.json`)
 * instead of receiving the kit content in its task — so the dispatch stays small and
 * the kit's authoritative spec drives the build. Distinct from the deep-build `builder`
 * (which it does not touch) so changes here can't regress the deep-build pipeline.
 */
export async function createDesignKitBuildConfig(): Promise<SubAgentConfig> {
  return {
    id: 'design-kit-build',
    name: 'Design Kit Build',
    system: await buildSystemPrompt(import.meta.url, 'design-kit-build.md', {
      config: { mode: 'summary' },
      heading: GROUND_TRUTH_HEADING,
    }),
    tools: pickTools(
      'reference', 'loadUiKit', 'str_replace_based_edit_tool', 'readFile', 'directoryListing',
      'grepSearch', 'terminalCommand', 'skill', 'serverRestart', 'viewLogs', 'showDoc',
    ),
    model: 'claude-sonnet-4-6',
    maxSteps: 100,
    // Homepage section writes are large; lift the 16k sub-agent default so a single
    // section edit has headroom and isn't truncated (finishReason: length). The prompt
    // still requires incremental section-by-section writes — this is the safety net.
    maxOutputTokens: 32000,
    enablePromptCaching: true,
    visualOutputExtractors: [pageExtractor, docExtractor],
  }
}
