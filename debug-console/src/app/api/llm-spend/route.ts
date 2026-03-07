import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ES_ENDPOINT = process.env.AIRO_BUILDER_ES_ENDPOINT;
const ES_API_KEY = process.env.AIRO_BUILDER_ES_API_KEY;

interface ESHit {
  _source: {
    date: string;
    end_user: string;
    spend: number;
    prompt_tokens: number;
    completion_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
    total_tokens: number;
    successful_requests: number;
    failed_requests: number;
    api_requests: number;
  };
}

export const GET = withAuth(async (request) => {
  try {
    const { searchParams } = new URL(request.url);
    const subscriptionId = searchParams.get('subscriptionId');
    const grantUserIds = searchParams.getAll('grantUserId').filter(Boolean);

    if (!subscriptionId) {
      return NextResponse.json(
        { error: 'subscriptionId query parameter is required' },
        { status: 400 }
      );
    }

    if (!ES_ENDPOINT || !ES_API_KEY) {
      return NextResponse.json(
        { error: 'Airo Builder ES credentials not configured' },
        { status: 500 }
      );
    }

    // Query all user IDs: the billing SID plus any grant llmBudgetUserIds
    const allUserIds = [subscriptionId, ...grantUserIds];

    // Use terms queries to match any of the user IDs against both field variants
    // (plain field and .keyword sub-field for compatibility with different ES index mappings)
    const esQuery = {
      size: 500,
      sort: [{ date: { order: 'desc' } }],
      query: {
        bool: {
          should: [
            { terms: { 'end_user.keyword': allUserIds } },
            { terms: { end_user: allUserIds } }
          ],
          minimum_should_match: 1
        }
      },
      _source: [
        'date', 'end_user', 'spend', 'prompt_tokens', 'completion_tokens',
        'total_tokens', 'cache_read_input_tokens', 'api_requests'
      ]
    };

    const response = await fetch(
      `${ES_ENDPOINT}/llm_spend_enduser_daily/_search`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `ApiKey ${ES_API_KEY}`
        },
        body: JSON.stringify(esQuery)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[llm-spend] es.query.failed', { status: response.status, error: errorText.slice(0, 500), subscriptionId, grantUserIds });
      return NextResponse.json(
        { error: `ES query failed: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const hits: ESHit[] = data.hits?.hits || [];

    // Aggregate client-side from raw docs
    let totalSpend = 0;
    let totalTokens = 0;
    let totalRequests = 0;

    const dailySpend = hits.map((hit) => {
      const s = hit._source;
      totalSpend += s.spend || 0;
      totalTokens += s.total_tokens || 0;
      totalRequests += s.api_requests || 0;

      // Normalize date — ES may return ISO date or yyyy-MM-dd string
      let dateStr = String(s.date);
      if (dateStr.includes('T')) {
        dateStr = dateStr.split('T')[0];
      }

      return {
        date: dateStr,
        spend: s.spend || 0,
        promptTokens: s.prompt_tokens || 0,
        completionTokens: s.completion_tokens || 0,
        totalTokens: s.total_tokens || 0,
        cacheReadTokens: s.cache_read_input_tokens || 0,
        requests: s.api_requests || 0
      };
    });

    return NextResponse.json({
      subscriptionId,
      grantUserIds,
      totalSpend,
      totalTokens,
      totalRequests,
      dailySpend,
      docCount: data.hits?.total?.value || 0
    });
  } catch (error) {
    console.error('[llm-spend] fetch.error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: 'Failed to fetch LLM spend data', message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
});
