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
});
export type DkimStatusResponse = z.infer<typeof DkimStatusResponseSchema>;

export type DkimActivateOutcome =
  | { result: 'accepted'; executionArn: string }
  | { result: 'skipped'; reason: 'feature_flag_off' | 'unsupported_origin' }
  | { result: 'failed'; error: string };

export type DkimOnboardOutcome =
  | DkimActivateOutcome
  | { result: 'noop'; reason: 'already_active' | 'in_progress' }
  | { result: 'skipped'; reason: 'not_internal' | 'no_agent_url' };

export type DkimDeactivateOutcome =
  | { result: 'deactivated'; executionArn: string }
  | { result: 'skipped'; reason: 'feature_flag_off' }
  | { result: 'failed'; error: string };
