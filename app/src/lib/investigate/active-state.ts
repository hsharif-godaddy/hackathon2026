/**
 * BFF-side reader for the investigator's active-investigation state.
 *
 * Mirrors the lock pattern the debug-console uses: when an investigation
 * is already running for a given (customerId, appId) tuple, return the
 * existing investigationId instead of spawning a new one. State lives at
 *   s3://airo-investigations-{env}/active/{customerId}/{appId}/state.json
 * and is the single source of truth — the Lambda updates it as it runs;
 * heartbeats refresh `lastHeartbeatAt`.
 *
 * Best-effort: any read failure (missing object, IAM denied, transport
 * error) returns null and the caller proceeds as if no investigation is
 * active. We deliberately don't throw — a stale-bucket-read race must
 * never block a feedback submission.
 */

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { logger } from '@/lib/request-context';

const LOG_DOMAIN = 'feedback.fanout.active-state';
// Paired constant: investigator/handler.mjs:MAX_RUN_MS = 14 * 60_000.
// The Lambda kills its own run at 14min; this BFF window is 15min so a
// run that just terminated isn't flagged stale before its terminal
// `status` flip lands in S3. Keep the 60s slack in lockstep — bump both
// sides together if Lambda's MAX_RUN_MS ever changes.
const ACTIVE_RUN_MAX_AGE_MS = 15 * 60 * 1000;

// Eager singleton: AWS SDK clients are stateless beyond region, and
// constructing once at module load avoids the module-level `let` /
// null-then-assign pattern flagged by the engineering guidelines.
const s3Client: S3Client = new S3Client({ region: process.env.AWS_REGION || 'us-west-2' });

function getBucketName(): string | null {
  // INVESTIGATE_BUCKET is the same env var the debug-console reads — set
  // by CDK output of AiroInvestigatorStack. When it isn't set (e.g. local
  // dev without CDK deployed) we skip the lock check entirely.
  return process.env.INVESTIGATE_BUCKET ?? null;
}

type SnapshotStatus = 'queued' | 'running' | 'completed' | 'failed' | 'unknown';

const ALLOWED_STATUSES: ReadonlySet<SnapshotStatus> = new Set<SnapshotStatus>([
  'queued', 'running', 'completed', 'failed', 'unknown',
]);

function isAllowedStatus(value: unknown): value is SnapshotStatus {
  return typeof value === 'string' && ALLOWED_STATUSES.has(value as SnapshotStatus);
}

export interface ActiveInvestigationSnapshot {
  investigationId: string;
  status: SnapshotStatus;
  /**
   * Epoch ms. Lambda + console both write `startedAt` as an ISO 8601
   * string in state.json; we parse it here so the staleness arithmetic
   * stays numeric. `null` when the field is missing — `isInvestigationActive`
   * falls back to `lastHeartbeatAt` for snapshots written before the first
   * heartbeat fires. The previous "0 as sentinel for missing" convention
   * collided with the parallel `lastHeartbeatAt: number | undefined` shape
   * (review S-12); both fields now use `number | null` for the missing
   * case so callers don't have to remember which sentinel is which.
   */
  startedAt: number | null;
  /** Epoch ms of the most recent heartbeat write. `null` when the field
   *  is missing; matches `startedAt`'s sentinel convention. */
  lastHeartbeatAt: number | null;
  crmCaseId?: string | null;
  crmCaseNumber?: string | null;
}

interface RawState {
  investigationId?: unknown;
  status?: unknown;
  startedAt?: unknown;
  // The Lambda's mergeState writes this name; older callers may still set
  // `lastHeartbeatAt`. Accept either to stay forward/backward compatible.
  heartbeatAt?: unknown;
  lastHeartbeatAt?: unknown;
  crmCaseId?: unknown;
  crmCaseNumber?: unknown;
}

function toEpochMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseState(
  raw: string,
  context: { customerId: string; appId: string; key: string },
): ActiveInvestigationSnapshot | null {
  let parsed: RawState;
  try {
    parsed = JSON.parse(raw) as RawState;
  } catch (err) {
    // Distinct from NoSuchKey: a corrupted/truncated state.json (mid-write
    // race during the 14-min Lambda run) would otherwise look identical to
    // "no investigation" and cause the BFF to fire a fresh Lambda alongside
    // the running one — defeats the dedup lock entirely. Warn so a real
    // race surfaces in Loki (review F-4 / dedup-lock concern).
    logger.warn(`${LOG_DOMAIN}.parse.failed`, {
      customerId: context.customerId,
      appId: context.appId,
      key: context.key,
      error: err instanceof Error ? err.message : String(err),
      rawSnippet: raw.slice(0, 200),
    });
    return null;
  }
  if (typeof parsed.investigationId !== 'string' || !parsed.investigationId) return null;
  const status: SnapshotStatus = isAllowedStatus(parsed.status) ? parsed.status : 'unknown';
  const startedAt = toEpochMs(parsed.startedAt) ?? null;
  const lastHeartbeatAt = toEpochMs(parsed.heartbeatAt) ?? toEpochMs(parsed.lastHeartbeatAt) ?? null;
  const crmCaseId = typeof parsed.crmCaseId === 'string' ? parsed.crmCaseId : null;
  const crmCaseNumber = typeof parsed.crmCaseNumber === 'string' ? parsed.crmCaseNumber : null;
  return {
    investigationId: parsed.investigationId,
    status,
    startedAt,
    lastHeartbeatAt,
    crmCaseId,
    crmCaseNumber,
  };
}

async function streamToString(body: unknown): Promise<string> {
  if (!body) return '';
  if (typeof (body as { transformToString?: () => Promise<string> }).transformToString === 'function') {
    return (body as { transformToString: () => Promise<string> }).transformToString();
  }
  // Fallback: collect ReadableStream chunks. Defensive — current SDK
  // exposes transformToString on the response Body.
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | Uint8Array>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Reads the active-investigation snapshot for a given (customerId, appId).
 * Returns null when:
 * - INVESTIGATE_BUCKET is unset (local dev / not deployed)
 * - The state.json key does not exist
 * - The S3 read fails for any reason
 * - The body is not parseable as the expected schema
 *
 * Callers must treat null as "no active investigation" and proceed.
 */
export async function readActiveState(
  customerId: string,
  appId: string,
): Promise<ActiveInvestigationSnapshot | null> {
  const bucket = getBucketName();
  if (!bucket) return null;

  const key = `active/${encodeURIComponent(customerId)}/${encodeURIComponent(appId)}/state.json`;
  try {
    const res = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const raw = await streamToString(res.Body);
    if (!raw) return null;
    return parseState(raw, { customerId, appId, key });
  } catch (err) {
    const errName = (err as { name?: string }).name;
    // NoSuchKey is the dominant case — never logged at warn so the BFF
    // doesn't spam on every first-time submission for a customer/app.
    if (errName === 'NoSuchKey' || errName === 'NotFound') return null;
    logger.warn(`${LOG_DOMAIN}.read.failed`, {
      customerId,
      appId,
      key,
      error: err instanceof Error ? err.message : String(err),
      errorName: errName,
    });
    return null;
  }
}

/**
 * True when the snapshot represents an investigation that is still in
 * flight. Used by the fanout route to decide whether to short-circuit
 * a duplicate submission. We treat queued+running as active and require
 * a recent timestamp because the Lambda crashes silently leave stale
 * `running` markers that should not block a fresh investigation.
 */
export function isInvestigationActive(
  snapshot: ActiveInvestigationSnapshot | null,
): snapshot is ActiveInvestigationSnapshot {
  if (!snapshot) return false;
  if (snapshot.status !== 'queued' && snapshot.status !== 'running') return false;
  // Prefer lastHeartbeatAt (refreshed every 10s by the Lambda) but fall
  // back to startedAt for snapshots written before the heartbeat fires.
  // Both sentinels are now `null` for missing — a snapshot with neither
  // is treated as "can't tell when it started" → not active.
  const reference = snapshot.lastHeartbeatAt ?? snapshot.startedAt;
  if (reference === null) return false;
  return Date.now() - reference < ACTIVE_RUN_MAX_AGE_MS;
}
