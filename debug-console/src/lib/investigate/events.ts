import {
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  S3Client,
} from '@aws-sdk/client-s3';

import { logger } from '@/lib/logger';

import { INVESTIGATE_CONFIG } from './config';
import { type InvestigationEvent, seqFromKey } from './types';

// Exported for test injection only.
export interface S3Like {
  send: (cmd: unknown) => Promise<unknown>;
}

const defaultS3: S3Like = new S3Client({ region: INVESTIGATE_CONFIG.region }) as unknown as S3Like;

async function readAll(body: AsyncIterable<Uint8Array> | null | undefined): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

interface ListResult {
  seqs: number[];
  truncated: boolean;
}

export async function listEventSeqs(
  eventsPrefix: string,
  sinceSeq = 0,
  s3: S3Like = defaultS3,
): Promise<ListResult> {
  const seqs: number[] = [];
  let continuationToken: string | undefined;
  let iterations = 0;
  const MAX_ITER = 10;

  do {
    const res = (await s3.send(
      new ListObjectsV2Command({
        Bucket: INVESTIGATE_CONFIG.bucket,
        Prefix: eventsPrefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }) as unknown,
    )) as { Contents?: Array<{ Key?: string }>; IsTruncated?: boolean; NextContinuationToken?: string };
    for (const obj of res.Contents ?? []) {
      if (!obj.Key) continue;
      const seq = seqFromKey(obj.Key);
      if (seq === null) continue;
      if (seq > sinceSeq) seqs.push(seq);
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    iterations += 1;
  } while (continuationToken && iterations < MAX_ITER);

  seqs.sort((a, b) => a - b);
  return { seqs, truncated: iterations >= MAX_ITER };
}

export async function readEvent(
  eventsPrefix: string,
  seq: number,
  s3: S3Like = defaultS3,
): Promise<InvestigationEvent | null> {
  const key = `${eventsPrefix}${String(seq).padStart(6, '0')}.json`;
  try {
    const res = (await s3.send(
      new GetObjectCommand({
        Bucket: INVESTIGATE_CONFIG.bucket,
        Key: key,
      }) as unknown,
    )) as { Body?: AsyncIterable<Uint8Array> };
    const buf = await readAll(res.Body);
    return JSON.parse(buf.toString('utf-8')) as InvestigationEvent;
  } catch (err: unknown) {
    if (err instanceof NoSuchKey) return null;
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

/**
 * Return events strictly contiguous from sinceSeq+1. Stops at the first gap
 * so a later seq doesn't get filtered out when the earlier one lands. Also
 * stops on transient read errors so one bad GetObject doesn't tear down the
 * whole stream — the next poll retries.
 */
export async function readEventsSince(
  eventsPrefix: string,
  sinceSeq: number,
  s3: S3Like = defaultS3,
): Promise<InvestigationEvent[]> {
  const { seqs } = await listEventSeqs(eventsPrefix, sinceSeq, s3);
  if (seqs.length === 0) return [];

  const out: InvestigationEvent[] = [];
  let expected = sinceSeq + 1;
  for (const seq of seqs) {
    if (seq !== expected) break;
    let evt: InvestigationEvent | null = null;
    try {
      evt = await readEvent(eventsPrefix, seq, s3);
    } catch (err) {
      // Log once so a genuinely-stuck stream is distinguishable from a
      // healthy "no events yet" idle in CloudWatch/console devtools.
      logger.warn(
        'investigate.events.read.transient',
        { eventsPrefix, seq },
        { error: err as Error },
      );
      break;
    }
    if (evt === null) break;
    out.push(evt);
    expected += 1;
  }
  return out;
}
