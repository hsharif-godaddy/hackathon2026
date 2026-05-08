import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  NoSuchKey,
} from '@aws-sdk/client-s3';

import { INVESTIGATE_CONFIG } from './config';
import type { InvestigationState } from './types';

const s3 = new S3Client({ region: INVESTIGATE_CONFIG.region });

async function readAll(body: AsyncIterable<Uint8Array> | null | undefined): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function readState(stateKey: string): Promise<InvestigationState | null> {
  try {
    const res = await s3.send(new GetObjectCommand({
      Bucket: INVESTIGATE_CONFIG.bucket,
      Key: stateKey,
    }));
    const buf = await readAll(res.Body as AsyncIterable<Uint8Array>);
    return JSON.parse(buf.toString('utf-8')) as InvestigationState;
  } catch (err: unknown) {
    if (err instanceof NoSuchKey) return null;
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

export async function writeState(stateKey: string, state: InvestigationState): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: INVESTIGATE_CONFIG.bucket,
    Key: stateKey,
    Body: JSON.stringify(state, null, 2),
    ContentType: 'application/json',
    CacheControl: 'no-store',
  }));
}

export async function readResult(resultKey: string, maxBytes: number): Promise<string | null> {
  try {
    const head = await s3.send(new HeadObjectCommand({
      Bucket: INVESTIGATE_CONFIG.bucket,
      Key: resultKey,
    }));
    if ((head.ContentLength ?? 0) > maxBytes) return null;
    const res = await s3.send(new GetObjectCommand({
      Bucket: INVESTIGATE_CONFIG.bucket,
      Key: resultKey,
    }));
    const buf = await readAll(res.Body as AsyncIterable<Uint8Array>);
    return buf.toString('utf-8');
  } catch (err: unknown) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    // HeadObject returns NotFound; GetObject returns NoSuchKey. The object
    // can also be deleted between the two calls (race with history prune),
    // so both names have to collapse to null — otherwise the status route
    // 500s instead of serving a stale-but-present state row.
    if (
      e.name === 'NotFound' ||
      e.name === 'NoSuchKey' ||
      e.$metadata?.httpStatusCode === 404
    ) {
      return null;
    }
    throw err;
  }
}

export function isTerminal(status: InvestigationState['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'killed';
}

export function isStaleHeartbeat(state: InvestigationState): boolean {
  if (!state.heartbeatAt) return true;
  const ts = Date.parse(state.heartbeatAt);
  if (Number.isNaN(ts)) return true;
  return Date.now() - ts > INVESTIGATE_CONFIG.staleHeartbeatMs;
}
