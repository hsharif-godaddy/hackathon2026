import type { ExpectedArtifactSpec } from '../../types.js';
import { hasRenderedContent } from '../../matchers/rendered-content.js';
import { noModuleNotFoundItem } from '../../matchers/checklist-items.js';

/** True if a publish tool was invoked anywhere in the run. */
function calledPublishTool(toolNames: string[]): boolean {
  return toolNames.some((n) => /publish/i.test(n));
}

/**
 * Expectation fixture for pvs-multi-turn-publish-flow (publishing skill
 * test). The flow: build a hello-world site, publish to production,
 * health-check, publish again. The skill question is whether the agent
 * loads the `publishing` skill (asserted separately via expectedSkills);
 * this CheckList covers the artifact + the publish-path capability.
 *
 * Capability matchers over behaviors, never golden output. The publish
 * check uses toolMatcher (a publishing__* tool call) — observable today
 * regardless of skill-load instrumentation.
 */
export const publishFlowExpectation: ExpectedArtifactSpec = {
  intent:
    'Build a hello-world site, publish it to production, health-check, '
    + 'and publish again.',
  // v2: mentions-publish-outcome moved from items into directionalItems
  // (scored by the score-mode DirectionalSignalEvaluator, no longer a binary
  // item). Bumped so baseline comparison skips the changed denominator.
  evalVersion: 'v2',
  items: [
    {
      id: 'home-route-reachable',
      description: 'the home route renders successfully (HTTP ok)',
      type: 'capability',
      routeMatcher: { path: '/', mustBeReachable: true },
    },
    {
      id: 'has-rendered-content',
      description: 'the site renders non-trivial text content',
      type: 'capability',
      domMatcher: (site, snapshots) => hasRenderedContent(site, snapshots),
    },
    {
      id: 'invoked-publish-tool',
      description: 'a publish tool was called during the flow',
      type: 'capability',
      toolMatcher: (calls) => calledPublishTool(calls.map((c) => c.name)),
    },
    noModuleNotFoundItem,
  ],
  directionalItems: [
    {
      id: 'mentions-publish-outcome',
      description: 'the conversation references publish/deploy/live status',
      textMatcher: {
        source: 'transcript',
        pattern: /publish|deployed|live site|production|go live/i,
      },
    },
  ],
};
