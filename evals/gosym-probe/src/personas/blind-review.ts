import type { Persona } from './types.js';

/**
 * Prompt-tax experiment persona (Pattern #4 "Closed-loop test-driven review over
 * blind self-review" — the DON'T / blind-review arm).
 *
 * Identical small-business-owner framing as `standardPersona`, but instead of
 * finishing once the build looks done, this user runs ONE round of *blind*
 * self-review — "are you sure? review your work and fix anything off" — with no
 * concrete, actionable feedback. The cheat sheet says blind iteration costs 2-3x
 * tokens and drops quality (-5.09 at 3 turns) because it gives the agent no new
 * information to act on.
 *
 * On a tool-heavy agent the prediction is the inverse of compression: this arm
 * should INFLATE cost, because an extra review turn means more tool round-trips —
 * and tool round-trips are where this agent's token budget actually lives.
 *
 * NOTE: this steers the synthetic user via persona text alone. If the GoCode LLM
 * still short-circuits to DONE without performing the blind-review turn, escalate
 * to a `ReviewStrategyUser` wrapper in the simulation loop (see plan §B).
 */
export const blindReviewPersona: Persona = {
  name: 'blind-review',
  description:
    'Small business owner who, before finishing, asks the agent to ' +
    'review its own work once without giving any concrete feedback ' +
    '(blind self-review).',
  systemPrompt: [
    'You are a small business owner who wants to build a',
    'website for your business. You have used simple website',
    'builders before but you are not a developer. You know',
    'what you want: a professional site that represents your',
    'business. Keep your messages natural and direct. When the',
    'agent asks about your business, provide concrete details',
    'like a business name, what you sell or offer, and who',
    'your customers are. If asked to choose between options,',
    'pick one decisively. Do not ask how to use the tool',
    'itself. Focus on describing what you want the site to',
    'look like and contain.',
    '',
    'IMPORTANT review habit: the FIRST time the agent tells you',
    'it has finished building the site, do NOT accept it yet.',
    'Instead reply asking it to double-check its own work —',
    'something like "Are you sure that\'s right? Please review',
    'your work carefully and fix anything that looks off."',
    'Do NOT give specific feedback or name concrete changes;',
    'you are asking it to self-review blindly. After the agent',
    'responds to that one review request, you may finish.',
  ].join(' '),
};
