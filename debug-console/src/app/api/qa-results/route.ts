import { Client } from '@elastic/elasticsearch';
import { NextResponse } from 'next/server';

import { searchRunSummaries } from '@/app/api/qa-results/run-summaries';
import { withAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

const QA_INDEX = 'agentic-qa-results';

interface QARunSource {
  scenario: string;
  success: boolean;
  timestamp: string;
  steps: number;
  durationMinutes: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costEstimateUSD: number;
  actionCount: number;
  previewUrl: string;
  runNumber: number | string;
  gitBranch: string;
  runUrl: string;
  uniquePageUrls: string[];
  finalPageUrl: string;
  message: string;
  qualityScore?: number;
  qualityGrade?: string;
  environment?: string;
  eventName?: string;
  actor?: string;
  triggerActor?: string;
  workflow?: string;
}

function getClient(): Client | null {
  const endpoint = process.env.AIRO_BUILDER_ES_ENDPOINT;
  const apiKey = process.env.AIRO_BUILDER_ES_API_KEY;
  if (!endpoint || !apiKey) return null;
  return new Client({ node: endpoint, auth: { apiKey } });
}

function utcSevenDayWindow(): { gte: string; lte: string } {
  const now = new Date();
  const lte = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  const gte = new Date(lte);
  gte.setUTCDate(gte.getUTCDate() - 6);
  gte.setUTCHours(0, 0, 0, 0);
  return { gte: gte.toISOString(), lte: lte.toISOString() };
}

function runNumberClause(runNumber: string): Record<string, unknown> {
  const clauses: Record<string, unknown>[] = [
    { term: { 'runNumber.keyword': runNumber } },
    { term: { runNumber } },
  ];
  const n = Number.parseInt(runNumber, 10);
  if (!Number.isNaN(n) && String(n) === runNumber.trim()) {
    clauses.push({ term: { runNumber: n } });
  }
  return { bool: { should: clauses, minimum_should_match: 1 } };
}

type FilterAgg = { doc_count?: number };
type DayHistBucket = {
  key: number;
  passed?: FilterAgg;
  failed?: FilterAgg;
};
type ScenarioBucket = {
  key: string;
  doc_count?: number;
  passed?: FilterAgg;
  failed?: FilterAgg;
  by_day?: { buckets?: DayHistBucket[] };
};

export const GET = withAuth(async (request, _auth) => {
  const client = getClient();
  if (!client) {
    return NextResponse.json({ error: 'ES not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'list';

  try {
    switch (action) {
      case 'list': {
        const result = await client.search({
          index: QA_INDEX,
          size: 10,
          body: {
            query: { term: { success: true } },
            sort: [{ timestamp: 'desc' }],
            _source: [
              'scenario', 'success', 'timestamp', 'steps', 'durationMinutes',
              'totalTokens', 'inputTokens', 'outputTokens', 'reasoningTokens',
              'costEstimateUSD', 'actionCount', 'previewUrl', 'runNumber',
              'gitBranch', 'runUrl', 'uniquePageUrls', 'finalPageUrl', 'message'
            ]
          }
        });

        const runs = result.hits.hits.map(hit => ({
          id: hit._id as string,
          ...(hit._source as QARunSource)
        }));

        return NextResponse.json({ runs });
      }

      case 'detail': {
        const id = searchParams.get('id');
        if (!id) {
          return NextResponse.json({ error: 'id parameter required' }, { status: 400 });
        }

        const result = await client.get({
          index: QA_INDEX,
          id,
          _source_excludes: ['screenshotsJson']
        });

        return NextResponse.json({ run: result._source });
      }

      case 'summary-7d': {
        const { gte, lte } = utcSevenDayWindow();
        const result = await client.search({
          index: QA_INDEX,
          size: 0,
          body: {
            query: {
              range: {
                timestamp: { gte, lte },
              },
            },
            aggs: {
              passed: { filter: { term: { success: true } } },
              failed: { filter: { term: { success: false } } },
            },
          },
        });
        const aggs = result.aggregations as
          | { passed?: { doc_count?: number }; failed?: { doc_count?: number } }
          | undefined;
        const passed = aggs?.passed?.doc_count ?? 0;
        const failed = aggs?.failed?.doc_count ?? 0;
        const total = passed + failed;
        return NextResponse.json({ passed, failed, total, since: gte, until: lte });
      }

      case 'analytics-7d': {
        const { gte, lte } = utcSevenDayWindow();
        const runFilter = searchParams.get('run');
        const must: Record<string, unknown>[] = [
          { range: { timestamp: { gte, lte } } },
        ];
        if (runFilter) {
          must.push(runNumberClause(runFilter));
        }

        const result = await client.search({
          index: QA_INDEX,
          size: 0,
          body: {
            query: { bool: { must } },
            aggs: {
              by_day: {
                date_histogram: {
                  field: 'timestamp',
                  calendar_interval: '1d',
                  min_doc_count: 0,
                  extended_bounds: { min: gte, max: lte },
                  time_zone: 'UTC',
                },
                aggs: {
                  passed: { filter: { term: { success: true } } },
                  failed: { filter: { term: { success: false } } },
                },
              },
              by_scenario: {
                terms: { field: 'scenario.keyword', size: 50, order: { _count: 'desc' } },
                aggs: {
                  passed: { filter: { term: { success: true } } },
                  failed: { filter: { term: { success: false } } },
                  by_day: {
                    date_histogram: {
                      field: 'timestamp',
                      calendar_interval: '1d',
                      min_doc_count: 0,
                      extended_bounds: { min: gte, max: lte },
                      time_zone: 'UTC',
                    },
                    aggs: {
                      passed: { filter: { term: { success: true } } },
                      failed: { filter: { term: { success: false } } },
                    },
                  },
                },
              },
            },
          },
        });

        const aggs = result.aggregations as
          | {
              by_day?: { buckets?: DayHistBucket[] };
              by_scenario?: { buckets?: ScenarioBucket[] };
            }
          | undefined;

        const dayBuckets = aggs?.by_day?.buckets ?? [];
        const days = dayBuckets.map(function mapDay(b) {
          return {
            ts: b.key,
            passed: b.passed?.doc_count ?? 0,
            failed: b.failed?.doc_count ?? 0,
          };
        });

        const scenarioBuckets = aggs?.by_scenario?.buckets ?? [];
        const scenarios = scenarioBuckets.map(function mapScenario(b) {
          const trend = (b.by_day?.buckets ?? []).map(function mapTrendDay(d) {
            return {
              ts: d.key,
              passed: d.passed?.doc_count ?? 0,
              failed: d.failed?.doc_count ?? 0,
            };
          });
          return {
            scenario: b.key,
            passed: b.passed?.doc_count ?? 0,
            failed: b.failed?.doc_count ?? 0,
            trend,
          };
        });

        return NextResponse.json({ gte, lte, days, scenarios });
      }

      case 'run-summaries': {
        const { gte, lte } = utcSevenDayWindow();
        const runs = await searchRunSummaries(client, gte, lte);
        return NextResponse.json({ gte, lte, runs });
      }

      case 'list-7d': {
        const { gte, lte } = utcSevenDayWindow();
        const runFilter = searchParams.get('run');
        const outcome = searchParams.get('outcome');
        const limitRaw = Number.parseInt(searchParams.get('limit') ?? '30', 10);
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 30;

        const must: Record<string, unknown>[] = [
          { range: { timestamp: { gte, lte } } },
        ];
        if (runFilter) {
          must.push(runNumberClause(runFilter));
        }
        if (outcome === 'passed') {
          must.push({ term: { success: true } });
        } else if (outcome === 'failed') {
          must.push({ term: { success: false } });
        }

        const result = await client.search({
          index: QA_INDEX,
          size: limit,
          body: {
            query: { bool: { must } },
            sort: [{ timestamp: 'desc' }],
            _source: [
              'scenario',
              'success',
              'timestamp',
              'durationMinutes',
              'totalTokens',
              'costEstimateUSD',
              'runUrl',
              'runNumber',
              'qualityScore',
              'qualityGrade',
              'environment',
              'eventName',
              'triggerActor',
              'actor',
            ],
          },
        });

        const runs = result.hits.hits.map(hit => ({
          id: hit._id as string,
          ...(hit._source as QARunSource),
        }));

        return NextResponse.json({ runs, gte, lte });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error('[qa-results] Error:', error);
    const err = error as { meta?: { statusCode?: number }; message?: string };
    if (err.meta?.statusCode === 404) {
      return NextResponse.json({ error: 'QA results index not found' }, { status: 404 });
    }
    if (err.message?.includes('ECONNREFUSED') || err.message?.includes('ENOTFOUND')) {
      return NextResponse.json({ error: 'Elasticsearch connection failed' }, { status: 503 });
    }
    return NextResponse.json({ error: 'Failed to fetch QA results' }, { status: 500 });
  }
});
