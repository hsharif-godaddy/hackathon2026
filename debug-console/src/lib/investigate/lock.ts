import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { INVESTIGATE_CONFIG } from './config';
import { isStaleHeartbeat, isTerminal, readState, writeState } from './state';
import type { AcquireLockResult, InvestigationState } from './types';

const s3 = new S3Client({ region: INVESTIGATE_CONFIG.region });

/**
 * Try to claim an investigation slot at `stateKey`.
 *
 * Returns `{ acquired: true }` if we took ownership (either the slot was empty
 * or held a terminal / zombie investigation we overwrote). Returns
 * `{ acquired: false, existing }` if an active investigation owns it.
 */
export async function acquireLock(
  stateKey: string,
  newState: InvestigationState,
): Promise<AcquireLockResult> {
  // Fast path: nothing there — conditional put wins.
  try {
    await s3.send(new PutObjectCommand({
      Bucket: INVESTIGATE_CONFIG.bucket,
      Key: stateKey,
      Body: JSON.stringify(newState, null, 2),
      ContentType: 'application/json',
      CacheControl: 'no-store',
      IfNoneMatch: '*',
    }));
    return { acquired: true };
  } catch (err: unknown) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    const status = e.$metadata?.httpStatusCode;
    if (status !== 412 && e.name !== 'PreconditionFailed') {
      throw err;
    }
  }

  // Slot exists — inspect it.
  const existing = await readState(stateKey);
  if (!existing) {
    // Object vanished between our failed put and the read. Retry unconditional.
    await writeState(stateKey, newState);
    return { acquired: true };
  }

  // NOTE on concurrency: the takeover branches below (terminal + zombie)
  // do an UNCONDITIONAL writeState. Two callers that both observe the same
  // terminal/zombie state will both succeed and both invoke Lambda. The
  // status route reconciles this for the UI — the caller whose
  // investigationId isn't the latest in state.json gets a 410 superseded.
  // For the current dev-team audience (~10-20 engineers manually clicking
  // Investigate) this is acceptable; if we ever see real concurrent
  // collisions, carry the S3 ETag from the GetObject here and issue a
  // conditional PutObject with `IfMatch: <etag>` — but that requires
  // propagating ETag out of readState, which we've resisted adding until
  // the race is observable.

  if (isTerminal(existing.status)) {
    await writeState(stateKey, newState);
    return { acquired: true };
  }

  if (isStaleHeartbeat(existing)) {
    await writeState(stateKey, newState);
    return { acquired: true, tookOverZombie: true };
  }

  return { acquired: false, existing };
}
