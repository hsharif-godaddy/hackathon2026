import { GetObjectCommand, PutObjectCommand, S3Client, NoSuchKey } from '@aws-sdk/client-s3';

import { INVESTIGATE_CONFIG } from './config';

// Operator capture half of the investigator feedback loop. Mirrors the Lambda's
// investigator/lessons.mjs schema + key scheme so a single distill script
// (investigator/scripts/investigate-distill-lessons.mjs) reads both the
// verifier-sourced and operator-sourced candidate lessons from one prefix.
//
// When a dev/support operator marks an investigation finding a false positive,
// we persist a candidate lesson here. A human later curates it into
// references/aab-behaviors.md via PR — the knowledge base is never machine-
// edited (that gate prevents memory poisoning).

export const LESSONS_PREFIX = 'lessons/';

const s3 = new S3Client({ region: INVESTIGATE_CONFIG.region });

export interface LessonRecord {
  v: 1;
  investigationId: string;
  appId: string;
  customerId: string;
  ts: string;
  source: 'verifier' | 'operator';
  verdict: string | null;
  relatesTo: string | null;
  category: string | null;
  rootCause: string | null;
  verdictRationale: string | null;
  verifierNote: string | null;
  score: number | null;
  operatorNote: string | null;
  feedback: string | null;
  timeWindow: string | null;
}

// Date-partitioned, unique per (investigation, source) — matches lessons.mjs.
export function lessonKey(ts: string, investigationId: string, source: LessonRecord['source']): string {
  const day = ts.slice(0, 10);
  return `${LESSONS_PREFIX}${day}/${investigationId}.${source}.json`;
}

function analysisKey(customerId: string, appId: string, investigationId: string): string {
  return `analysis/${encodeURIComponent(customerId)}/${encodeURIComponent(appId)}/${investigationId}.json`;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function readAnalysis(
  customerId: string,
  appId: string,
  investigationId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await s3.send(
      new GetObjectCommand({
        Bucket: INVESTIGATE_CONFIG.bucket,
        Key: analysisKey(customerId, appId, investigationId),
      }),
    );
    const text = await (res.Body as { transformToString(): Promise<string> }).transformToString();
    return JSON.parse(text) as Record<string, unknown>;
  } catch (err: unknown) {
    // Best-effort: a lesson without verdict fields is still useful (the note
    // carries the signal). Don't fail the capture if the sidecar is absent.
    if (err instanceof NoSuchKey) return null;
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null;
    return null;
  }
}

/**
 * Persist an operator-sourced candidate lesson for an investigation.
 * Pulls verdict fields from the analysis sidecar (best-effort) and tags the
 * record with the operator's note.
 */
export async function captureOperatorLesson(input: {
  investigationId: string;
  appId: string;
  customerId: string;
  note: string;
}): Promise<{ key: string }> {
  const analysis = await readAnalysis(input.customerId, input.appId, input.investigationId);
  const a = analysis ?? {};
  const ts = new Date().toISOString();
  const record: LessonRecord = {
    v: 1,
    investigationId: input.investigationId,
    appId: input.appId,
    customerId: input.customerId,
    ts,
    source: 'operator',
    verdict: str(a.verdict),
    relatesTo: str(a.relatesTo),
    category: str(a.category),
    rootCause: str(a.rootCause),
    verdictRationale: str(a.verdictRationale),
    verifierNote: null,
    score: null,
    operatorNote: str(input.note),
    feedback: null,
    timeWindow: null,
  };
  const key = lessonKey(ts, input.investigationId, 'operator');
  await s3.send(
    new PutObjectCommand({
      Bucket: INVESTIGATE_CONFIG.bucket,
      Key: key,
      Body: JSON.stringify(record, null, 2),
      ContentType: 'application/json',
      CacheControl: 'no-store',
    }),
  );
  return { key };
}
