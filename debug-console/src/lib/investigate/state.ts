import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  NoSuchKey,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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

export async function headResult(resultKey: string): Promise<{ size: number; etag: string | null } | null> {
  try {
    const head = await s3.send(new HeadObjectCommand({
      Bucket: INVESTIGATE_CONFIG.bucket,
      Key: resultKey,
    }));
    return { size: head.ContentLength ?? 0, etag: head.ETag ?? null };
  } catch (err: unknown) {
    // HeadObject errors come back with name === 'NotFound' (not NoSuchKey —
    // that's the GetObject flavour exposed as the NoSuchKey class on the
    // client). The SDK does not export a NotFound error class to do an
    // instanceof check against, so match by name and by HTTP status as a
    // belt-and-braces. Checking for NoSuchKey too keeps this helper happy
    // if HEAD is ever switched to GET in a future refactor.
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw err;
  }
}

export async function presignResultUrl(resultKey: string, ttlSec: number): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: INVESTIGATE_CONFIG.bucket,
    Key: resultKey,
    ResponseContentType: 'text/markdown; charset=utf-8',
  });
  return getSignedUrl(s3, cmd, { expiresIn: ttlSec });
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
