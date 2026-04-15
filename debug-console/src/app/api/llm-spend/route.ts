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

export const GET = withAuth(async (request, _auth) => {
  try {
    const { searchParams } = new URL(request.url);
    const subscriptionId = searchParams.get('subscriptionId') ?? undefined;
    const rawGrantUserIds = searchParams.getAll('grantUserId').filter(Boolean);

    if (rawGrantUserIds.length === 0) {
      return NextResponse.json(
        { error: 'At least one grantUserId query parameter is required' },
        { status: 400 }
      );
    }

    // Validate each ID and cap the list to prevent oversized ES queries
    const GRANT_USER_ID_RE = /^[A-Za-z0-9:._-]{1,150}$/;
    const MAX_GRANT_IDS = 50;
    const grantUserIds = rawGrantUserIds.slice(0, MAX_GRANT_IDS).filter(id => GRANT_USER_ID_RE.test(id));
    if (grantUserIds.length === 0) {
      return NextResponse.json(
        { error: 'No valid grantUserId values provided' },
        { status: 400 }
      );
    }

    if (!ES_ENDPOINT || !ES_API_KEY) {
      return NextResponse.json(
        { error: 'Airo Builder ES credentials not configured' },
        { status: 500 }
      );
    }

    // Use terms queries to match any of the user IDs against both field variants
    // (plain field and .keyword sub-field for compatibility with different ES index mappings)
    const esQuery = {
      size: 500,
      sort: [{ date: { order: 'desc' } }],
      query: {
        bool: {
          should: [
            { terms: { 'end_user.keyword': grantUserIds } },
            { terms: { end_user: grantUserIds } }
          ],
          minimum_should_match: 1
        }
      },
      _source: [
        'date', 'end_user', 'spend', 'prompt_tokens', 'completion_tokens',
        'total_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'api_requests'
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
      console.error('[llm-spend] es.query.failed', { status: response.status, error: errorText.slice(0, 500), subscriptionId: subscriptionId ?? null, grantUserIds });
      return NextResponse.json(
        { error: `ES query failed: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const hits: ESHit[] = data.hits?.hits || [];

    // Group by end_user, then aggregate per-grant totals and daily rows
    const grantMap = new Map<string, {
      spend: number; tokens: number; requests: number;
      promptTokens: number; completionTokens: number;
      cacheReadTokens: number; cacheWriteTokens: number;
      days: {
        date: string; spend: number; promptTokens: number; completionTokens: number;
        totalTokens: number; cacheReadTokens: number; cacheWriteTokens: number; requests: number;
      }[];
    }>();

    let totalSpend = 0;
    let totalTokens = 0;
    let totalRequests = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheWriteTokens = 0;

    for (const hit of hits) {
      const s = hit._source;
      const userId = s.end_user || 'unknown';

      // Normalize date
      let dateStr = String(s.date);
      if (dateStr.includes('T')) dateStr = dateStr.split('T')[0];

      if (!grantMap.has(userId)) {
        grantMap.set(userId, { spend: 0, tokens: 0, requests: 0, promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, days: [] });
      }
      const g = grantMap.get(userId)!;

      const spend = s.spend || 0;
      const tokens = s.total_tokens || 0;
      const requests = s.api_requests || 0;
      const promptTokens = s.prompt_tokens || 0;
      const completionTokens = s.completion_tokens || 0;
      const cacheReadTokens = s.cache_read_input_tokens || 0;
      const cacheWriteTokens = s.cache_creation_input_tokens || 0;

      g.spend += spend;
      g.tokens += tokens;
      g.requests += requests;
      g.promptTokens += promptTokens;
      g.completionTokens += completionTokens;
      g.cacheReadTokens += cacheReadTokens;
      g.cacheWriteTokens += cacheWriteTokens;
      g.days.push({ date: dateStr, spend, promptTokens, completionTokens, totalTokens: tokens, cacheReadTokens, cacheWriteTokens, requests });

      totalSpend += spend;
      totalTokens += tokens;
      totalRequests += requests;
      totalPromptTokens += promptTokens;
      totalCompletionTokens += completionTokens;
      totalCacheReadTokens += cacheReadTokens;
      totalCacheWriteTokens += cacheWriteTokens;
    }

    // Build per-grant breakdowns ordered by the requested grantUserIds list
    const grantBreakdowns = grantUserIds.map(uid => {
      const g = grantMap.get(uid);
      if (!g) return { grantUserId: uid, totalSpend: 0, totalTokens: 0, totalRequests: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalCacheReadTokens: 0, totalCacheWriteTokens: 0, dailySpend: [] };
      return {
        grantUserId: uid,
        totalSpend: g.spend,
        totalTokens: g.tokens,
        totalRequests: g.requests,
        totalPromptTokens: g.promptTokens,
        totalCompletionTokens: g.completionTokens,
        totalCacheReadTokens: g.cacheReadTokens,
        totalCacheWriteTokens: g.cacheWriteTokens,
        dailySpend: g.days.sort((a, b) => b.date.localeCompare(a.date)),
      };
    });

    // Include any end_users returned by ES that weren't in the requested list (edge case)
    for (const [uid, g] of grantMap.entries()) {
      if (!grantUserIds.includes(uid)) {
        grantBreakdowns.push({ grantUserId: uid, totalSpend: g.spend, totalTokens: g.tokens, totalRequests: g.requests, totalPromptTokens: g.promptTokens, totalCompletionTokens: g.completionTokens, totalCacheReadTokens: g.cacheReadTokens, totalCacheWriteTokens: g.cacheWriteTokens, dailySpend: g.days.sort((a, b) => b.date.localeCompare(a.date)) });
      }
    }

    const totalCount: number = data.hits?.total?.value || 0;
    return NextResponse.json({
      subscriptionId,
      grantUserIds,
      totalSpend,
      totalTokens,
      totalRequests,
      totalPromptTokens,
      totalCompletionTokens,
      totalCacheReadTokens,
      totalCacheWriteTokens,
      grantBreakdowns,
      docCount: totalCount,
      truncated: hits.length < totalCount,
    });
  } catch (error) {
    console.error('[llm-spend] fetch.error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: 'Failed to fetch LLM spend data', message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
});
