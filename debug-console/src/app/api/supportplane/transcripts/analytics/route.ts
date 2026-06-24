/**
 * /api/supportplane/transcripts/analytics
 * Get analytics and aggregated stats for L1 transcripts.
 *
 * Uses getAllTranscriptsCached() so every route shares the same module-level
 * full-scan cache (15-min TTL, in-flight dedup). Date filtering is done in JS
 * rather than as a DynamoDB FilterExpression — this avoids bypassing the cache.
 *
 * A second result-level cache stores the computed aggregations per date window
 * for another 5 minutes, making repeated dashboard loads instant.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getAllTranscriptsCached } from '@/lib/supportplane/db/transcript-cache';
import type { TranscriptRow } from '@/lib/supportplane/db/l1-transcript-db';

// ── Result-level cache (keyed by start_date|end_date) ────────────────
const RESULT_CACHE_TTL_MS = 300_000; // 5 min

interface ResultCacheEntry {
  expiresAt: number;
  data: unknown;
}

const resultCache = new Map<string, ResultCacheEntry>();

// ── Helper types ──────────────────────────────────────────────────────

type RawDataObj = Record<string, unknown>;

function parseRawData(row: TranscriptRow): RawDataObj | null {
  try {
    if (!row.raw_data) return null;
    return (typeof row.raw_data === 'string' ? JSON.parse(row.raw_data) : row.raw_data) as RawDataObj;
  } catch {
    return null;
  }
}

function str(v: unknown): string {
  if (!v || v === 'N/A' || v === '') return '';
  return String(v);
}

function increment(map: Record<string, number>, key: string): void {
  if (!key) return;
  map[key] = (map[key] ?? 0) + 1;
}

function buildHeatmap(
  rows: Array<{ category: string; raw: RawDataObj }>,
  rowField: string,
  colField: string,
): Array<{ row_label: string; by_column: Record<string, number> }> {
  const matrix: Record<string, Record<string, number>> = {};
  for (const { category, raw } of rows) {
    const rv: string = str(rowField === 'category' ? category : raw[rowField]);
    const cv: string = str(colField === 'category' ? category : raw[colField]);
    if (!rv || !cv) continue;
    (matrix[rv] ??= {})[cv] = ((matrix[rv]?.[cv]) ?? 0) + 1;
  }
  return Object.entries(matrix).map(([row_label, by_column]) => ({ row_label, by_column }));
}

// ── Route handler ─────────────────────────────────────────────────────

async function handler(request: NextRequest): Promise<NextResponse> {
  if (request.method !== 'GET') {
    return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const { searchParams } = new URL(request.url);
  const startDate: string | undefined = searchParams.get('start_date') ?? undefined;
  const endDate: string | undefined = searchParams.get('end_date') ?? undefined;

  const cacheKey = `${startDate ?? ''}|${endDate ?? ''}`;
  const cached = resultCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data);
  }

  try {
    // Use the shared module-level full-scan cache — avoids a FilterExpression
    // that would bypass caching and trigger a fresh 6-minute scan each call.
    const allRows: TranscriptRow[] = await getAllTranscriptsCached();

    // Apply date filter in JS
    const rows: TranscriptRow[] = allRows.filter((row: TranscriptRow) => {
      const ts: string = row.created_at ?? '';
      if (startDate && ts < startDate) return false;
      if (endDate && ts > endDate) return false;
      return true;
    });

    const total: number = rows.length;

    const categoryCounts: Record<string, number> = {};
    const sentimentCounts: Record<string, number> = {};
    const tagCounts: Record<string, number> = {};
    const resolutionMap: Record<string, number> = {};
    const subIntentCounts: Record<string, number> = {};
    const frictionPointCounts: Record<string, number> = {};
    const productLineCounts: Record<string, number> = {};
    const issueResolutionCounts: Record<string, number> = {};
    const inboundDriverCounts: Record<string, number> = {};
    const timelineMap: Record<string, number> = {};
    const heatmapRows: Array<{ category: string; raw: RawDataObj }> = [];

    for (const row of rows) {
      increment(categoryCounts, str(row.category));

      if (typeof row.sentiment_score === 'number') {
        const bucket: string = row.sentiment_score >= 0.7 ? 'Positive' : row.sentiment_score >= 0.4 ? 'Neutral' : 'Negative';
        sentimentCounts[bucket] = (sentimentCounts[bucket] ?? 0) + 1;
      }

      try {
        const tags: unknown[] = Array.isArray(row.tags)
          ? row.tags
          : typeof row.tags === 'string'
            ? (JSON.parse(row.tags) as unknown[])
            : [];
        for (const tag of tags) {
          increment(tagCounts, str(tag));
        }
      } catch { /* ignore */ }

      if (row.interaction_status) {
        increment(resolutionMap, row.interaction_status);
      }

      if (row.created_at) {
        increment(timelineMap, row.created_at.slice(0, 10));
      }

      const raw: RawDataObj | null = parseRawData(row);
      if (raw) {
        increment(subIntentCounts, str(raw['sub_intent']));
        increment(frictionPointCounts, str(raw['friction_point']));
        increment(productLineCounts, str(raw['airo_product_line']));
        increment(issueResolutionCounts, str(raw['issue_resolution']));
        increment(inboundDriverCounts, str(raw['inbound_volume_driver']));
        if (row.category) {
          heatmapRows.push({ category: row.category, raw });
        }
      }
    }

    const topN = <T extends { count: number }>(arr: T[], n: number): T[] =>
      arr.sort((a: T, b: T) => b.count - a.count).slice(0, n);

    const analytics = {
      total,
      by_category: topN(
        Object.entries(categoryCounts).map(([category, count]) => ({ category, count })), 10,
      ),
      by_sentiment: Object.entries(sentimentCounts).map(([sentiment, count]) => ({ sentiment, count })),
      top_tags: topN(
        Object.entries(tagCounts).map(([tag, count]) => ({ tag, count })), 15,
      ),
      timeline: Object.entries(timelineMap)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      by_resolution: Object.entries(resolutionMap).map(([interaction_status, count]) => ({ interaction_status, count })),
      by_sub_intent: topN(
        Object.entries(subIntentCounts).map(([name, count]) => ({ name, count })), 10,
      ),
      by_friction_point: topN(
        Object.entries(frictionPointCounts).map(([name, count]) => ({ name, count })), 10,
      ),
      by_product_line: Object.entries(productLineCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      by_issue_resolution: Object.entries(issueResolutionCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      by_inbound_driver: topN(
        Object.entries(inboundDriverCounts).map(([name, count]) => ({ name, count })), 10,
      ),
      friction_category_heatmap: buildHeatmap(heatmapRows, 'friction_point', 'category'),
      friction_resolution_heatmap: buildHeatmap(heatmapRows, 'friction_point', 'issue_resolution'),
      friction_intent_heatmap: buildHeatmap(heatmapRows, 'friction_point', 'sub_intent'),
    };

    const result = { success: true, analytics };
    resultCache.set(cacheKey, { expiresAt: Date.now() + RESULT_CACHE_TTL_MS, data: result });
    return NextResponse.json(result);
  } catch (error: unknown) {
    logger.error('supportplane.transcripts.analytics.error', { error: String(error) });
    return NextResponse.json(
      { error: 'Failed to fetch analytics', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

export const GET = withAuth(handler);
