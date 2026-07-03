import { createSkillEval } from './create-skill-eval.js';
import { getSkillEvalBaseInjection }
  from './skill-eval-base.js';
import type { IGocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../types.js';
import type { Config }
  from '../../../config/environments/types.js';

/**
 * Reproduces the **wrong skill routing** failure mode for the inbox ↔ ai-agent
 * confusable pair (squad task 2a.ii, Brandon's #5550 gap review — flagged as
 * the optional, lower-signal addition of the three). Grounded but lower
 * priority than the email and OA↔conferencing gaps: both skills explicitly
 * cross-reference each other in their `whenToUse`, which is what makes the pair
 * genuinely confusable.
 *
 * The skills draw the line themselves: inbox is the "DEFAULT for any chat,
 * messaging, chatbot, or contact form request" and says to "only route to
 * ai-agent if the user explicitly needs a custom AI-powered solution with their
 * own API key or tool-calling capabilities." ai-agent agrees from the other
 * side: "NOT for general 'add chat' or 'add messaging' requests — those should
 * use the inbox skill instead." So a plain "add a chat widget so visitors can
 * message me" ask is unambiguously inbox's; the plausible misroute is the agent
 * pattern-matching on "chat" and reaching for ai-agent, scaffolding a custom
 * LLM chatbot (provider/API-key/streaming-route) the user never asked for.
 *
 * Detection (two independent signals):
 *  - `expectedSkills: ['inbox']` → `SkillSelectionEvaluator` skill-load check:
 *    fails if inbox never loads (e.g. ai-agent loaded instead). Needs
 *    `SKILL_DIAGNOSTICS=true`; without it the check degrades to `unknown`.
 *  - the required `no-ai-agent-skill` instruction → narrow LLM judge fails the
 *    trial if the agent routes to ai-agent / builds a custom LLM chatbot, an
 *    instrumentation-independent catch for the misroute.
 *
 * `expectedAgent` is intentionally omitted: both correct and misrouted paths
 * run under the same develop agent, so the discriminating signal is *which
 * skill* loaded, not which agent.
 *
 * Not subsumed by `skill-eval-inbox` / `wrong-skill-routing-inbox-vs-email`:
 * those test the inbox happy path and the inbox↔email misroute respectively.
 * This isolates a different misroute hypothesis — the agent over-reaching for a
 * custom AI chatbot when a managed chat widget is what was asked for — via a
 * `required` no-ai-agent-skill instruction.
 */
export function inboxVsAiAgentRoutingScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
  config?: Config,
): Scenario {
  const base = getSkillEvalBaseInjection(config);
  return createSkillEval(
    {
      name: 'wrong-skill-routing-inbox-vs-ai-agent',
      skill: 'inbox',
      userIntent:
        'Add a chat widget to my site so visitors can send me a message and '
        + 'I can get back to them.',
      goals: [
        {
          description:
            'Agent routes the chat-widget request to the inbox skill, not the '
            + 'ai-agent skill',
          assertion: 'positive',
        },
        {
          description:
            'Visitors can send a message through the widget and the owner is '
            + 'notified so they can reply',
          assertion: 'positive',
        },
      ],
      skillInstructions: [
        {
          id: 'routes-to-inbox',
          instruction:
            'The agent must handle this with the inbox skill '
            + '(inbox__discover_account then inbox__setup_widget), which '
            + 'installs the managed Airo Inbox chat widget. A plain chat / '
            + 'messaging ask is inbox\'s job by default.',
          priority: 'required',
        },
        {
          id: 'no-ai-agent-skill',
          instruction:
            'The agent must NOT load the ai-agent skill or build a custom '
            + 'LLM-powered chatbot (no provider/API-key prompt, no streaming '
            + '/api/chat route, no Vercel AI SDK). The user asked for a way for '
            + 'visitors to message them, not a custom AI assistant; reaching '
            + 'for ai-agent is the wrong-skill misroute this scenario detects. '
            + 'ai-agent is only correct when the user explicitly wants a custom '
            + 'AI chatbot with their own API key or tool-calling.',
          priority: 'required',
        },
      ],
      statefulInjection: base?.injection,
    },
    gocode,
    ctrlPlane,
    base?.seedSummary,
  );
}
