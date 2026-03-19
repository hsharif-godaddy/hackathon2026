import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

const SOURCE_INDEX = 'airo-agents-prod';

interface PublishEvent {
  id: string;
  timestamp: string;
  appId: string;
  event: string;
  eventType: 'begin' | 'success' | 'build_failed' | 'archive_failed';
  success: boolean;
  commitHash?: string;
  errorMessage?: string;
  raw: Record<string, unknown>;
}

interface ESSearchResponse {
  hits: {
    total: { value: number };
    hits: Array<{
      _id: string;
      _source: Record<string, unknown>;
    }>;
  };
}

export const GET = withAuth(async (request) => {
  try {
    const endpoint = process.env.PIONEER_ES_ENDPOINT;
    const apiKey = process.env.PIONEER_ES_API_KEY;

    if (!endpoint || !apiKey) {
      return NextResponse.json({
        events: [],
        summary: {},
        total: 0,
        warning: 'PIONEER_ES_ENDPOINT or PIONEER_ES_API_KEY not configured'
      });
    }

    const { searchParams } = request.nextUrl;
    const appId = searchParams.get('appId');
    const days = Math.min(Math.max(parseInt(searchParams.get('days') || '7', 10), 1), 365);
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100', 10), 1), 500);

    const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const must: unknown[] = [
      { wildcard: { 'event.keyword': 'route.publish*' } }
    ];

    if (appId) {
      must.push({ match: { 'app_id': appId } });
    }

    const esQuery = {
      size: limit,
      sort: [{ '@timestamp': 'desc' }],
      query: {
        bool: {
          must,
          filter: [
            { range: { '@timestamp': { gte: startTime.toISOString() } } }
          ]
        }
      }
    };

    const response = await fetch(
      `${endpoint}/${SOURCE_INDEX}/_search`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `ApiKey ${apiKey}`
        },
        body: JSON.stringify(esQuery)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Publish events ES error:', { status: response.status, error: errorText.slice(0, 500) });
      return NextResponse.json(
        { error: 'Failed to fetch publish events', details: errorText },
        { status: response.status }
      );
    }

    const data: ESSearchResponse = await response.json();

    const events: PublishEvent[] = data.hits.hits.map((hit) => {
      const source = hit._source;
      const event = source.event as string;
      const eventData = source.data as Record<string, unknown> | undefined;

      let eventType: PublishEvent['eventType'] = 'begin';
      let success = true;
      let errorMessage: string | undefined;

      if (event === 'route.publish.success') {
        eventType = 'success';
      } else if (event === 'route.publish.build.failed') {
        eventType = 'build_failed';
        success = false;
        errorMessage = eventData?.stderr as string | undefined;
      } else if (event === 'route.publish.archive.failed' || event === 'route.publish.git-archive.failed') {
        eventType = 'archive_failed';
        success = false;
        errorMessage = eventData?.error as string | undefined;
      }

      return {
        id: hit._id,
        timestamp: source['@timestamp'] as string,
        appId: source.app_id as string,
        event,
        eventType,
        success,
        commitHash: eventData?.commitHash as string | undefined,
        errorMessage,
        raw: source
      };
    });

    // Group by appId for summary
    const byApp = new Map<string, { total: number; success: number; failed: number; lastPublish?: string }>();
    for (const e of events) {
      const stats = byApp.get(e.appId) || { total: 0, success: 0, failed: 0 };
      if (e.eventType !== 'begin') {
        stats.total++;
        if (e.success) {stats.success++;}
        else {stats.failed++;}
      }
      if (!stats.lastPublish || e.timestamp > stats.lastPublish) {
        stats.lastPublish = e.timestamp;
      }
      byApp.set(e.appId, stats);
    }

    return NextResponse.json({
      events,
      summary: Object.fromEntries(byApp),
      total: data.hits.total?.value ?? events.length
    });
  } catch (error) {
    console.error('Publish events fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch publish events', details: String(error) },
      { status: 500 }
    );
  }
});
