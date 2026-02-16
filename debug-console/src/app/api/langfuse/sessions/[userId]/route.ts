import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';

const LANGFUSE_BASE_URL = process.env.LANGFUSE_BASE_URL;
const LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
const LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;

// Cache auth header at module level to avoid exposing in error responses
const langfuseAuthHeader = LANGFUSE_PUBLIC_KEY && LANGFUSE_SECRET_KEY
  ? `Basic ${Buffer.from(`${LANGFUSE_PUBLIC_KEY}:${LANGFUSE_SECRET_KEY}`).toString('base64')}`
  : null;

interface Observation {
  id: string;
  name: string;
  type: string;
  model?: string;
  input?: unknown;
  output?: unknown;
  statusMessage?: string;
  level?: string;
  startTime?: string;
  endTime?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  calculatedInputCost?: number;
  calculatedOutputCost?: number;
  calculatedTotalCost?: number;
  metadata?: {
    attributes?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

interface TraceWithObservations {
  id: string;
  name: string;
  timestamp: string;
  input: unknown;
  output: unknown;
  metadata: unknown;
  tags: string[];
  observations: Observation[];
}

export const GET = withAuth<{ userId: string }>(async (request, _auth, context) => {
  try {
    if (!LANGFUSE_BASE_URL || !langfuseAuthHeader) {
      return NextResponse.json(
        { error: 'Langfuse credentials not configured' },
        { status: 500 }
      );
    }

    const { userId } = await context.params;
    const searchParams = request.nextUrl.searchParams;
    const fromTimestamp = searchParams.get('fromTimestamp');
    const toTimestamp = searchParams.get('toTimestamp');
    const requestedPage = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = 10; // Small page size for fast initial render

    // Fetch one page of traces
    const tracesParams = new URLSearchParams({
      page: String(requestedPage),
      limit: String(pageSize),
      userId,
    });
    if (fromTimestamp) {
      tracesParams.append('fromTimestamp', fromTimestamp);
    }
    if (toTimestamp) {
      tracesParams.append('toTimestamp', toTimestamp);
    }

    const tracesResponse = await fetch(`${LANGFUSE_BASE_URL}/api/public/traces?${tracesParams}`, {
      headers: {
        'Authorization': langfuseAuthHeader,
        'Content-Type': 'application/json',
      },
    });

    if (!tracesResponse.ok) {
      const errorText = await tracesResponse.text();
      return NextResponse.json(
        { error: `Langfuse API error: ${tracesResponse.status}`, message: errorText },
        { status: tracesResponse.status }
      );
    }

    const tracesData = await tracesResponse.json();
    const traceIds = (tracesData.data || []).map((t: { id: string }) => t.id);
    const totalPages = tracesData.meta?.totalPages || 1;
    const hasMore = requestedPage < totalPages;

    // Fetch full trace details including observations
    // With pageSize=10 and BATCH_SIZE=10, all fetches run in parallel via Promise.all (not sequential)
    const BATCH_SIZE = 10;
    const fullTraces: TraceWithObservations[] = [];
    let failedFetches = 0;

    for (let i = 0; i < traceIds.length; i += BATCH_SIZE) {
      const batch = traceIds.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (traceId: string) => {
          try {
            const traceResponse = await fetch(`${LANGFUSE_BASE_URL}/api/public/traces/${traceId}`, {
              headers: {
                'Authorization': langfuseAuthHeader,
                'Content-Type': 'application/json',
              },
            });
            if (!traceResponse.ok) {
              failedFetches++;
              return null;
            }
            return traceResponse.json();
          } catch {
            failedFetches++;
            return null;
          }
        })
      );
      fullTraces.push(...batchResults.filter(Boolean));
    }

    // Group traces by sessionId
    const sessionMap = new Map<string, {
      sessionId: string;
      traces: TraceWithObservations[];
      firstTrace: string;
      lastTrace: string;
      traceCount: number;
    }>();

    for (const trace of fullTraces) {
      const sessionId = (trace as { sessionId?: string }).sessionId || 'no-session';
      if (!sessionMap.has(sessionId)) {
        sessionMap.set(sessionId, {
          sessionId,
          traces: [],
          firstTrace: trace.timestamp,
          lastTrace: trace.timestamp,
          traceCount: 0,
        });
      }
      const session = sessionMap.get(sessionId)!;
      session.traces.push({
        id: trace.id,
        name: trace.name,
        timestamp: trace.timestamp,
        input: trace.input,
        output: trace.output,
        metadata: trace.metadata,
        tags: trace.tags || [],
        observations: (trace.observations || []).map((obs: Observation) => ({
          id: obs.id,
          name: obs.name,
          type: obs.type,
          model: obs.model,
          input: obs.input,
          output: obs.output,
          statusMessage: obs.statusMessage,
          level: obs.level,
          startTime: obs.startTime,
          endTime: obs.endTime,
          promptTokens: obs.promptTokens,
          completionTokens: obs.completionTokens,
          totalTokens: obs.totalTokens,
          calculatedInputCost: obs.calculatedInputCost,
          calculatedOutputCost: obs.calculatedOutputCost,
          calculatedTotalCost: obs.calculatedTotalCost,
          metadata: obs.metadata,
        })),
      });
      session.traceCount++;
      if (new Date(trace.timestamp) < new Date(session.firstTrace)) {
        session.firstTrace = trace.timestamp;
      }
      if (new Date(trace.timestamp) > new Date(session.lastTrace)) {
        session.lastTrace = trace.timestamp;
      }
    }

    // Sort traces within each session by timestamp
    for (const session of sessionMap.values()) {
      session.traces.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }

    // Convert to array and sort sessions by lastTrace (most recent first)
    const sessions = Array.from(sessionMap.values())
      .sort((a, b) => new Date(b.lastTrace).getTime() - new Date(a.lastTrace).getTime());

    const warnings: string[] = [];
    if (failedFetches > 0) {
      warnings.push(`Failed to fetch ${failedFetches} of ${traceIds.length} traces`);
    }

    return NextResponse.json({
      userId,
      sessions,
      totalTraces: fullTraces.length,
      pagination: {
        page: requestedPage,
        totalPages,
        hasMore,
      },
      ...(warnings.length > 0 && { warnings }),
    });
  } catch (error) {
    console.error('Langfuse sessions by user fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Langfuse sessions', message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
});
