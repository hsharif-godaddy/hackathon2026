import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import { logger } from '@/lib/logger';

import { INVESTIGATE_CONFIG } from './config';
import { keysForLatestSummary, keysForSummary, keysForSummaryPointer, type SummaryPointer } from './types';
import type { InvestigationState, InvestigationSummary } from './types';

export const FEEDBACK_EXCERPT_MAX = 200;

export interface AnalysisOverlay {
  sentiment?: 'positive' | 'neutral' | 'negative' | null;
  confidence?: number | null;
  rootCause?: string | null;
  category?: string | null;
}

export interface BuildSummaryOptions {
  reportSize?: number | null;
  reportEtag?: string | null;
  analysis?: AnalysisOverlay | null;
}

function pickDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  return new Date(ts).toISOString().slice(0, 10);
}

export function partitionDateFor(state: InvestigationState): string {
  const isTerminal = state.status === 'completed' || state.status === 'failed' || state.status === 'killed';
  const candidate =
    (isTerminal ? pickDate(state.completedAt) : null) ??
    pickDate(state.startedAt) ??
    pickDate(state.heartbeatAt) ??
    new Date().toISOString().slice(0, 10);
  return candidate;
}

export function buildSummary(state: InvestigationState, opts: BuildSummaryOptions): InvestigationSummary {
  if (state.status !== 'completed' && state.status !== 'failed' && state.status !== 'killed') {
    throw new Error(`buildSummary: refusing to build for non-terminal status "${state.status}"`);
  }
  const feedback = state.input?.feedback ?? '';
  const excerpt = feedback.length > FEEDBACK_EXCERPT_MAX ? feedback.slice(0, FEEDBACK_EXCERPT_MAX) : feedback;
  const reportAvailable = state.status === 'completed' && !!state.resultKey;
  const analysis = opts.analysis ?? null;
  const schemaCompleted = !!(
    analysis &&
    analysis.sentiment != null &&
    analysis.confidence != null &&
    analysis.rootCause != null
  );

  return {
    v: 1,
    investigationId: state.investigationId,
    appId: state.appId,
    customerId: state.customerId,
    status: state.status,
    startedAt: state.startedAt,
    completedAt: state.completedAt ?? state.heartbeatAt ?? state.startedAt,
    durationMs: state.durationMs,
    startedBy: state.startedBy,
    feedbackExcerpt: excerpt,
    fullstoryUrl: state.input?.fullstoryUrl ?? null,
    reportAvailable,
    reportSize: reportAvailable ? opts.reportSize ?? null : null,
    reportEtag: reportAvailable ? opts.reportEtag ?? null : null,
    evidence: state.evidence
      ? {
          artifactCount: state.evidence.artifactCount ?? null,
          uploadedCount: state.evidence.uploadedCount ?? null,
          failedCount: state.evidence.stats?.failedCount ?? null,
        }
      : null,
    cost: state.cost ?? null,
    sentiment: analysis?.sentiment ?? null,
    confidence: analysis?.confidence ?? null,
    rootCause: analysis?.rootCause ?? null,
    category: analysis?.category ?? null,
    error: state.error,
    schemaCompleted,
  };
}

export interface S3Like {
  send: (cmd: unknown) => Promise<unknown>;
}

const defaultS3: S3Like = new S3Client({ region: INVESTIGATE_CONFIG.region }) as unknown as S3Like;

interface S3Opts {
  s3?: S3Like;
  bucket?: string;
}

function resolved(opts: S3Opts): { s3: S3Like; bucket: string } {
  return { s3: opts.s3 ?? defaultS3, bucket: opts.bucket ?? INVESTIGATE_CONFIG.bucket };
}

async function readAll(body: AsyncIterable<Uint8Array> | null | undefined): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function isPreconditionFailed(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'PreconditionFailed' || e?.$metadata?.httpStatusCode === 412;
}

export interface WriteSummaryResult {
  wrote: boolean;
  date: string;
}

export async function writeSummaryIdempotent(
  summary: InvestigationSummary,
  opts: S3Opts = {},
): Promise<WriteSummaryResult> {
  const { s3, bucket } = resolved(opts);
  const date =
    pickDate(summary.completedAt) ??
    pickDate(summary.startedAt) ??
    new Date().toISOString().slice(0, 10);
  const summaryKey = keysForSummary(date, summary.investigationId);
  const pointerKey = keysForSummaryPointer(summary.investigationId);

  const body = JSON.stringify(summary, null, 2);
  let wroteSummary = true;
  try {
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: summaryKey,
      Body: body,
      ContentType: 'application/json',
      CacheControl: 'no-store',
      IfNoneMatch: '*',
    }));
  } catch (err) {
    if (!isPreconditionFailed(err)) throw err;
    wroteSummary = false;
  }

  const pointer: SummaryPointer = {
    v: 1,
    investigationId: summary.investigationId,
    date,
    appId: summary.appId,
    customerId: summary.customerId,
  };
  try {
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: pointerKey,
      Body: JSON.stringify(pointer),
      ContentType: 'application/json',
      IfNoneMatch: '*',
    }));
  } catch (err) {
    if (!isPreconditionFailed(err)) {
      logger.warn('investigate.summary.pointer.write.failed', { investigationId: summary.investigationId }, { error: err as Error });
    }
  }

  // Unconditional overwrite — latest investigation for this (date, appId)
  // always wins. Powers the scalable listing path (1 object per app per day).
  const latestKey = keysForLatestSummary(date, summary.appId);
  try {
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: latestKey,
      Body: body,
      ContentType: 'application/json',
      CacheControl: 'no-store',
    }));
  } catch (err) {
    logger.warn('investigate.summary.latest.write.failed', { investigationId: summary.investigationId, appId: summary.appId }, { error: err as Error });
  }

  return { wrote: wroteSummary, date };
}

export async function readAnalysis(
  customerId: string,
  appId: string,
  investigationId: string,
  opts: S3Opts = {},
): Promise<AnalysisOverlay | null> {
  const { s3, bucket } = resolved(opts);
  const key = `analysis/${encodeURIComponent(customerId)}/${encodeURIComponent(appId)}/${investigationId}.json`;
  try {
    const res = (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))) as { Body: AsyncIterable<Uint8Array> };
    const buf = await readAll(res.Body);
    const parsed = JSON.parse(buf.toString('utf-8')) as {
      v?: number;
      sentiment?: string;
      confidence?: number;
      rootCause?: string;
      category?: string;
    };
    return {
      sentiment: (['positive', 'neutral', 'negative'] as string[]).includes(parsed.sentiment ?? '')
        ? (parsed.sentiment as AnalysisOverlay['sentiment'])
        : null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
      rootCause: typeof parsed.rootCause === 'string' ? parsed.rootCause : null,
      category: typeof parsed.category === 'string' ? parsed.category : null,
    };
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null;
    logger.warn('investigate.analysis.read.failed', { customerId, appId, investigationId }, { error: err as Error });
    return null;
  }
}

export async function ensureSummary(
  state: InvestigationState,
  opts: S3Opts & {
    reportSize?: number | null;
    reportEtag?: string | null;
    analysis?: AnalysisOverlay | null;
  } = {},
): Promise<WriteSummaryResult> {
  if (state.status !== 'completed' && state.status !== 'failed' && state.status !== 'killed') {
    throw new Error(`ensureSummary: refusing to write summary for non-terminal status "${state.status}"`);
  }
  const { s3: s3Inst, bucket } = resolved(opts);

  // Skip the entire pipeline if the summary already exists. This prevents
  // repeated S3 writes (analysis GET + 3 PUTs) on every status/report poll
  // against a terminal investigation. The lazy-write description is only true
  // when we actually skip; without this check every poll pays the full cost.
  const previewDate =
    pickDate(state.completedAt) ??
    pickDate(state.startedAt) ??
    new Date().toISOString().slice(0, 10);
  const existingKey = keysForSummary(previewDate, state.investigationId);
  try {
    await s3Inst.send(new HeadObjectCommand({ Bucket: bucket, Key: existingKey }));
    return { wrote: false, date: previewDate };
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e?.name !== 'NotFound' && e?.name !== 'NoSuchKey' && e?.$metadata?.httpStatusCode !== 404) {
      throw err;
    }
    // 404 = doesn't exist yet, proceed to write.
  }

  // Only attempt to read analysis sidecar for completed investigations where
  // the caller hasn't already supplied an overlay (avoids redundant S3 reads
  // from the lazy-write path in status/latest/report routes).
  let analysis = opts.analysis ?? null;
  if (analysis === null && state.status === 'completed') {
    analysis = await readAnalysis(state.customerId, state.appId, state.investigationId, opts);
  }
  const summary = buildSummary(state, {
    reportSize: opts.reportSize ?? null,
    reportEtag: opts.reportEtag ?? null,
    analysis,
  });
  return writeSummaryIdempotent(summary, opts);
}

export interface ListSummariesPage {
  items: InvestigationSummary[];
  nextToken: string | null;
}

// Scalable listing: reads summaries/latest/{date}/ — 1 object per app per day,
// regardless of how many investigations ran for that app. S3 pagination maps
// 1:1 to unique apps, so pageSize = unique-apps-per-page (no dedup needed).
const LATEST_KEY_RE = /^summaries\/latest\/\d{4}-\d{2}-\d{2}\/.+\.json$/;

export async function listLatestSummariesByDate(
  date: string,
  opts: S3Opts & { pageSize?: number; continuationToken?: string } = {},
): Promise<ListSummariesPage> {
  const { s3, bucket } = resolved(opts);
  const pageSize = Math.max(1, Math.min(opts.pageSize ?? 50, 200));
  const prefix = `summaries/latest/${date}/`;
  const list = (await s3.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
    MaxKeys: pageSize,
    ContinuationToken: opts.continuationToken,
  }))) as { Contents?: { Key?: string }[]; IsTruncated?: boolean; NextContinuationToken?: string };

  const keys = (list.Contents ?? [])
    .map((o) => o.Key ?? '')
    .filter((k) => LATEST_KEY_RE.test(k));

  const items = await Promise.all(
    keys.map(async (Key) => {
      try {
        const res = (await s3.send(new GetObjectCommand({ Bucket: bucket, Key }))) as { Body: AsyncIterable<Uint8Array> };
        const buf = await readAll(res.Body);
        return JSON.parse(buf.toString('utf-8')) as InvestigationSummary;
      } catch (err) {
        logger.warn('investigate.summary.latest.read.failed', { Key }, { error: err as Error });
        return null;
      }
    }),
  );

  return {
    items: items.filter((x): x is InvestigationSummary => x !== null),
    nextToken: list.IsTruncated && list.NextContinuationToken ? list.NextContinuationToken : null,
  };
}

export async function getSummaryById(
  investigationId: string,
  opts: S3Opts = {},
): Promise<InvestigationSummary | null> {
  const { s3, bucket } = resolved(opts);
  const pointerKey = keysForSummaryPointer(investigationId);
  let pointer: SummaryPointer;
  try {
    const res = (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: pointerKey }))) as { Body: AsyncIterable<Uint8Array> };
    const buf = await readAll(res.Body);
    pointer = JSON.parse(buf.toString('utf-8')) as SummaryPointer;
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }

  const key = keysForSummary(pointer.date, investigationId);
  try {
    const res = (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))) as { Body: AsyncIterable<Uint8Array> };
    const buf = await readAll(res.Body);
    return JSON.parse(buf.toString('utf-8')) as InvestigationSummary;
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

export function ensureSummaryAfterTerminal(
  state: InvestigationState,
  opts: S3Opts & { reportSize?: number | null; reportEtag?: string | null } = {},
): void {
  if (state.status !== 'completed' && state.status !== 'failed' && state.status !== 'killed') return;
  ensureSummary(state, opts).catch((err) => {
    logger.warn(
      'investigate.summary.ensure.failed',
      { investigationId: state.investigationId, appId: state.appId },
      { error: err as Error },
    );
  });
}
