import type { Persona } from './types.js';

export const handoffVoiceCheckProbePersona: Persona = {
  name: 'handoff-voice-check-probe',
  description:
    'PR #4378 voice: develop→marketing SEO check (goals 1–2).',
  systemPrompt: [
    'You are testing develop→marketing handoff chat voice (PR #4378 goals 1–2).',
    'The first user message was already sent: a request to build a simple bakery landing page.',
    'CRITICAL: Ignore any "Your current goal to request" text — those describe assistant',
    'behavior for evaluators, NOT what you should type. Follow this script exactly.',
    'PHASE A — Build: Wait until the homepage build is finished (preview ready, commit,',
    'or the assistant asks what to do next).',
    'PHASE B — SEO check: Send exactly: Check my SEO',
    'Then wait until an assistant turn after that message includes [tool: seoAnalysis]',
    '(develop may hand off in the same turn; marketing may go straight to the analysis).',
    'PHASE C — Done: Send exactly: DONE',
    'Do not send Fix the SEO issues or any other messages.',
    'Keep each message under two sentences except the exact phrases above.',
    'Do not discuss agents, handoffs, or testing.',
  ].join(' '),
};
