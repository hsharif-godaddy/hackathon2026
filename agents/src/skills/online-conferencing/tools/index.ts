/**
 * Online Conferencing Skill Tools
 *
 * Provides a single tool that the LLM calls once the customer has confirmed
 * which video-conferencing provider(s) to set up and (if multiple) the wiring
 * pattern. The tool itself has no external side effects — its purpose is to
 * make the customer's decision durable via computeState, so that on re-entry
 * the agent immediately knows which providers are already configured without
 * having to re-ask or rely on summarisation.
 *
 *   online_conferencing__confirmProviders — record confirmed provider plan
 *
 * Called at Step 2c (after the customer confirms the plan, before any code
 * generation begins). See skill.md for the exact invocation point.
 */

import { z } from 'zod';
import type { SkillToolDefinition } from '@airo/ai-skills';

const PROVIDERS = ['google', 'zoom', 'teams'] as const;
const WIRING_PATTERNS = ['single-default', 'per-feature', 'user-picks', 'fallback-chain'] as const;

export type Provider = (typeof PROVIDERS)[number];
export type WiringPattern = (typeof WIRING_PATTERNS)[number];

export const confirmProvidersTool: SkillToolDefinition = {
  name: 'confirmProviders',
  description:
    'Call this after the create-meeting.ts dispatcher has been written, ' +
    'with the providers actually implemented in the dispatcher and the wiring pattern used (only required when 2+ providers). ' +
    'Records the completed configuration so the agent knows what is already set up in future conversations.',

  parameters: z.object({
    providers: z
      .array(z.enum(PROVIDERS))
      .min(1)
      .describe('Provider(s) the customer confirmed: google, zoom, and/or teams'),
    wiringPattern: z
      .enum(WIRING_PATTERNS)
      .optional()
      .describe(
        'Multi-provider wiring pattern — only required when 2+ providers chosen. ' +
        'single-default | per-feature | user-picks | fallback-chain',
      ),
  }),

  execute(input) {
    return {
      confirmed: true,
      providers: input.providers,
      ...(input.wiringPattern ? { wiringPattern: input.wiringPattern } : {}),
    };
  },

  // Lightweight: only what the LLM needs to avoid re-asking on re-entry.
  // Shallow-merged into .airo/skills/online-conferencing/state.json.
  computeState(input, output) {
    if (!output.confirmed) return null;
    return {
      providers: input.providers,
      ...(input.wiringPattern ? { wiringPattern: input.wiringPattern } : {}),
    };
  },
};
