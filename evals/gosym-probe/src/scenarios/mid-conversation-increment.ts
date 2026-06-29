import { createGoldenLightScenario }
  from './golden-light/create-golden-light-scenario.js';
import { AABAgentsApiClient }
  from '../clients/aab-agents-api-client.js';
import type { SeedSummaryInput }
  from '../clients/aab-agents-api-client.js';
import type { IGocodeClient }
  from '../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../clients/aab-ctrl-plane-client.js';
import type { Config } from '../../config/environments/types.js';
import type { Scenario } from './types.js';

export const MID_CONVERSATION_SUITE = 'mid-conversation-variance';

/**
 * The increment task the agent performs each trial against the fixed base. Kept
 * small and unambiguous so trial-to-trial variance reflects the agent loop, not
 * task interpretation — the whole point of the 1b.ii variance measurement.
 */
const INCREMENT_PROMPT =
  'Add a "Frequently Asked Questions" section to the homepage with three ' +
  'question-and-answer pairs about the business. Keep the existing design.';

/**
 * Prefabricated mid-conversation state: an app that was already built up over a
 * prior (summarized) conversation, with a short tail of recent raw turns. The
 * priorTurns are the recent exchanges the live summarizer would not yet have
 * compacted. Together they make the trial start mid-conversation rather than
 * from turn 0 — so the agent does not re-read the whole site every trial.
 *
 * IMPORTANT — base/summary mismatch: the summaryText below describes a built-up
 * marketing site, but the committed pinned base is the bare template, so the
 * seeded summary does NOT match the actual file state at
 * EVAL_INCREMENT_RESET_COMMIT. This mismatch is the known source of the mixed
 * jtbd verdicts in the live n=12 result (see docs/stateful-injection.md
 * caveats); it does not affect the variance/no-op mechanism being measured.
 * Author this to match YOUR pinned base build before relying on jtbd verdicts —
 * the values below are a portfolio/landing illustration, not a matched pair.
 */
const SEEDED_SUMMARY: SeedSummaryInput = {
  summaryText: [
    '## State',
    'A small business marketing site exists: a hero section with headline and',
    'subheadline, an about section, a services section, and a contact section',
    'with an email link. Clean, modern single-page design.',
    '',
    '## Completed',
    '- Built the hero, about, services, and contact sections',
    '- Applied a consistent modern theme and spacing',
    '',
    '## Decisions',
    '- Single-page layout; sections anchor-linked from a top nav',
    '- Contact uses a mailto link (no backend form yet)',
    '',
    '## Pending',
    '- The user may want additional informational sections',
  ].join('\n'),
  // The recent un-summarized tail. The agent reads these verbatim as history.
  priorTurns: [
    { sender: 'user', content: 'The contact section looks good, thanks.' },
    {
      sender: 'agent',
      content:
        'Great! The contact section is wired up with a mailto link. Anything ' +
        'else you would like to add to the site?',
    },
  ],
  // Synthetic provenance: this stands in for a longer prior conversation.
  messageCount: 12,
  originalTokenCount: 8000,
};

/**
 * The 1b.ii variance scenario: one pre-built app, reset to a pinned commit AND
 * re-seeded with mid-conversation state before every trial, then asked to do
 * the same increment. Measures the agent's per-trial variance from a genuine
 * mid-state (filesystem + conversation) rather than a cold from-scratch build.
 *
 * Operator-provisioned inputs (the harness does not build the base itself, so
 * the base build's own variance never leaks into the measurement):
 *   EVAL_INCREMENT_APP_ID       — id of the pre-built app to reuse
 *   EVAL_INCREMENT_PREVIEW_URL  — that app's preview URL
 *   EVAL_INCREMENT_RESET_COMMIT — commit the base build sits at (reset target)
 *
 * Returns null when the inputs are absent so normal eval runs are unaffected;
 * the registry filters it out.
 */
export function midConversationIncrementScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
  config?: Config,
): Scenario | null {
  const appId = process.env.EVAL_INCREMENT_APP_ID;
  const previewUrl = process.env.EVAL_INCREMENT_PREVIEW_URL;
  const resetCommit = process.env.EVAL_INCREMENT_RESET_COMMIT;
  if (!appId || !previewUrl || !resetCommit) {
    return null;
  }

  const agentsUrl = config?.aab.agentsUrl;
  if (!agentsUrl) {
    throw new Error(
      'midConversationIncrementScenario requires config.aab.agentsUrl to seed ' +
      'conversation state; none resolved',
    );
  }
  const agentsApi = new AABAgentsApiClient(agentsUrl);
  // The seeded summaryId is unused by the lifecycle, so the seeder is void —
  // await the write (propagating failures) and discard the id.
  const seedSummary = async (id: string, summary: SeedSummaryInput): Promise<void> => {
    await agentsApi.seedSummary(id, summary);
  };

  return createGoldenLightScenario(
    {
      name: 'mid-conversation-increment',
      suite: MID_CONVERSATION_SUITE,
      staticFirstMessage: INCREMENT_PROMPT,
      goals: [
        {
          description:
            'The agent adds an FAQ section with three Q&A pairs while ' +
            'preserving the existing site',
          assertion: 'positive',
        },
      ],
      // Fixed pre-built base, reset to the pinned commit AND re-seeded with
      // mid-conversation state before every trial (including the first).
      statefulInjection: {
        existingApp: { appId, previewUrl },
        resetCommit,
        seededSummary: SEEDED_SUMMARY,
      },
    },
    gocode,
    ctrlPlane,
    seedSummary,
  );
}
