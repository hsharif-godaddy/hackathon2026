import { z } from 'zod';
import { Logger } from '../logging/index.js';

/**
 * Campaign-level plan rationale (RUBICON-504) — the agent's reasoning behind a generated
 * plan, captured once per campaign for the measurement / feedback loop to read back later.
 *
 * Stored as a single JSON `plan_rationale` column (not separate typed columns) so the shape
 * can evolve without a schema migration — adding a dimension is a code-only change to the
 * schema below. It is a JSON object with a VALIDATED shape, not a free-form bag: a feedback
 * loop that compares rationale across campaigns depends on a stable contract, so writes are
 * validated and reads tolerate (skip) anything malformed.
 */
export const planRationaleSchema = z.object({
  /** 3-4 short assumptions the agent inferred about the business (audience, goal, focus). */
  assumptions: z.array(z.string()),
  /** Why this channel mix serves the goal. */
  mixRationale: z.string(),
  /** Rough, directional expectation (never a precise guarantee). */
  expectedOutcome: z.string(),
});

export type PlanRationale = z.infer<typeof planRationaleSchema>;

const logger = Logger.create({ component: 'plan-rationale' });

/** Validate then serialize for storage — strict on write so a bad shape never persists. */
export function serializePlanRationale(rationale: PlanRationale): string {
  return JSON.stringify(planRationaleSchema.parse(rationale));
}

/**
 * Parse a stored value back to a typed object — lenient on read: a null/empty column is
 * null, and a malformed blob is logged and treated as null rather than failing the whole
 * campaign load (plan rationale is non-critical context, not a load-bearing field).
 */
export function parsePlanRationale(raw: string | null): PlanRationale | null {
  if (raw === null || raw.trim() === '') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn('planRationale.parse.invalidJson', {});
    return null;
  }
  const result: ReturnType<typeof planRationaleSchema.safeParse> = planRationaleSchema.safeParse(parsed);
  if (!result.success) {
    logger.warn('planRationale.parse.invalidShape', {});
    return null;
  }
  return result.data;
}
