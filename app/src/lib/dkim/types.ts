import { z } from 'zod';

// Mirror of DkimOnboardingStatus in agents DkimOnboardingRepository — keep in sync (separate services, no shared type pkg).
export type DkimOnboardingStatus = 'pending' | 'active' | 'failed';

export const DkimApiActivateResponseSchema = z.object({
  executionArn: z.string(),
});
export type DkimApiActivateResponse = z.infer<typeof DkimApiActivateResponseSchema>;

export const DkimApiDeactivateResponseSchema = z.object({
  executionArn: z.string(),
});
export type DkimApiDeactivateResponse = z.infer<typeof DkimApiDeactivateResponseSchema>;

export const DkimRecordExpectedSchema = z.object({
  cnames: z.array(z.string()),
});

export const DkimRecordDetectedSchema = z.object({
  cnames: z.array(z.string()),
  txts: z.array(z.string()).optional(),
});

export type DkimRecordExpected = z.infer<typeof DkimRecordExpectedSchema>;
export type DkimRecordDetected = z.infer<typeof DkimRecordDetectedSchema>;

export const DkimStatusResponseSchema = z.object({
  dkimValid: z.boolean(),
  dkimResult: z.string(),
  dkimRecordDetected: DkimRecordDetectedSchema.optional(),
  dkimRecordExpected: DkimRecordExpectedSchema.optional(),
  dmarcValid: z.boolean().optional(),
  dmarcResult: z.string().optional(),
  dmarcRecordDetected: z.string().optional(),
  dmarcRecordExpected: z.string().optional(),
  /**
   * ISO timestamp of the dkim_onboarding row's poll_started_at from agents SQLite.
   * Populated only when the durable-state flag is on and agent_url is present.
   * Used by useDkimStatusQueryExternal to enforce the 30-day polling wall-clock
   * limit without relying on localStorage — making tracking app-scoped and
   * persistent across devices and browser sessions.
   */
  pollStartedAt: z.string().nullable().optional(),
  /**
   * ISO timestamp for the next durable external-DKIM poll. The agents service
   * computes this from pollStartedAt using fast, exponential, then daily phases.
   */
  nextPollAt: z.string().nullable().optional(),
  lastPolledAt: z.string().nullable().optional(),
  pollingExpired: z.boolean().optional(),
});
export type DkimStatusResponse = z.infer<typeof DkimStatusResponseSchema>;

export type DkimActivateOutcome =
  | { result: 'accepted'; executionArn: string }
  | { result: 'skipped'; reason: 'feature_flag_off' }
  | { result: 'failed'; error: string };

export type DkimOnboardOutcome =
  | DkimActivateOutcome
  | { result: 'noop'; reason: 'already_active' | 'in_progress' }
  | { result: 'skipped'; reason: 'no_agent_url' };

export type DkimDeactivateOutcome =
  | { result: 'deactivated'; executionArn: string }
  | { result: 'skipped'; reason: 'feature_flag_off' }
  | { result: 'failed'; error: string };
