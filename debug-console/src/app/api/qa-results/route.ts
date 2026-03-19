import { Client } from '@elastic/elasticsearch';
import { NextResponse } from 'next/server';

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
  runNumber: number;
  gitBranch: string;
  runUrl: string;
  uniquePageUrls: string[];
  finalPageUrl: string;
  message: string;
}

function getClient(): Client | null {
  const endpoint = process.env.AIRO_BUILDER_ES_ENDPOINT;
  const apiKey = process.env.AIRO_BUILDER_ES_API_KEY;
  if (!endpoint || !apiKey) {return null;}
  return new Client({ node: endpoint, auth: { apiKey } });
}

export const GET = withAuth(async (request) => {
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
