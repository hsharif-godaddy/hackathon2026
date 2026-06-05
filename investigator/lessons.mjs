// Lessons inbox — the capture half of the investigator's feedback loop.
//
// When an investigation's verdict is later judged untrustworthy (the verifier
// flags an over-claim) or an operator marks a finding a false positive, we
// persist a structured "candidate lesson" to S3 under the `lessons/` prefix.
// A human then runs scripts/investigate-distill-lessons.mjs to turn the inbox
// into proposed entries for references/aab-behaviors.md, which is merged via
// PR. The agent NEVER edits its own knowledge base — that human gate is what
// prevents memory poisoning (one wrong "fact" silently corrupting every run).
//
// This module is pure (record + key builders) so it is trivially unit-testable
// and carries no AWS/S3 dependency; the handler/route does the actual write.

export const LESSONS_PREFIX = 'lessons/';

/**
 * @typedef {Object} LessonRecord
 * @property {1} v
 * @property {string} investigationId
 * @property {string} appId
 * @property {string} customerId
 * @property {string} ts                ISO timestamp
 * @property {'verifier'|'operator'} source  what produced the candidate
 * @property {string|null} verdict
 * @property {string|null} relatesTo
 * @property {string|null} category
 * @property {string|null} rootCause
 * @property {string|null} verdictRationale
 * @property {string|null} verifierNote  set when source === 'verifier'
 * @property {number|null} score         verifier score when present
 * @property {string|null} operatorNote  set when source === 'operator'
 * @property {string|null} feedback      original customer complaint
 * @property {string|null} timeWindow
 */

function str(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Build a candidate-lesson record from an analysis sidecar + capture context.
 * Pure: the caller supplies `ts` (so this stays deterministic/testable).
 *
 * @param {{
 *   investigationId: string,
 *   appId: string,
 *   customerId: string,
 *   ts: string,
 *   source: 'verifier'|'operator',
 *   analysis?: Record<string, unknown> | null,
 *   verifierNote?: string | null,
 *   score?: number | null,
 *   operatorNote?: string | null,
 *   feedback?: string | null,
 *   timeWindow?: string | null,
 * }} input
 * @returns {LessonRecord}
 */
export function buildLessonRecord(input) {
  const a = input.analysis && typeof input.analysis === 'object' ? input.analysis : {};
  return {
    v: 1,
    investigationId: input.investigationId,
    appId: input.appId,
    customerId: input.customerId,
    ts: input.ts,
    source: input.source,
    verdict: str(a.verdict),
    relatesTo: str(a.relatesTo),
    category: str(a.category),
    rootCause: str(a.rootCause),
    verdictRationale: str(a.verdictRationale),
    verifierNote: str(input.verifierNote),
    score: num(input.score),
    operatorNote: str(input.operatorNote),
    feedback: str(input.feedback),
    timeWindow: str(input.timeWindow),
  };
}

/**
 * S3 key for a lesson record. Date-partitioned for cheap listing/pruning;
 * the investigationId + source keep it unique and idempotent per (run, source).
 *
 * @param {{ ts: string, investigationId: string, source: string }} input
 * @returns {string}
 */
export function lessonKey(input) {
  const day = input.ts.slice(0, 10); // YYYY-MM-DD
  return `${LESSONS_PREFIX}${day}/${input.investigationId}.${input.source}.json`;
}
