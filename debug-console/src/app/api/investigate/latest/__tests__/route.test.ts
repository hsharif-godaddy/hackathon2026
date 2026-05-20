import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  withAuth: (handler: unknown) => handler as (req: NextRequest) => Promise<Response>,
}));

const readStateMock = vi.fn();
const headResultMock = vi.fn();

vi.mock('@/lib/investigate/state', async () => {
  const actual = await vi.importActual<typeof import('@/lib/investigate/state')>(
    '@/lib/investigate/state',
  );
  return {
    ...actual,
    readState: (...args: unknown[]) => readStateMock(...args),
    headResult: (...args: unknown[]) => headResultMock(...args),
  };
});

vi.mock('@/lib/investigate/summaries', () => ({
  ensureSummaryAfterTerminal: vi.fn(),
}));

function makeRequest(): NextRequest {
  return new NextRequest('https://localhost/api/investigate/latest?appId=app1&customerId=cust1');
}

describe('GET /api/investigate/latest', () => {
  it('includes cost and evidence fields in the response payload', async () => {
    readStateMock.mockResolvedValueOnce({
      investigationId: 'inv-2026-05-14-deadbeef',
      appId: 'app1',
      customerId: 'cust1',
      status: 'completed',
      startedAt: '2026-05-14T00:00:00Z',
      heartbeatAt: '2026-05-14T00:01:00Z',
      completedAt: '2026-05-14T00:02:00Z',
      durationMs: 120000,
      phase: 'done',
      lastEvent: null,
      input: { feedback: 'x' },
      resultKey: 'history/cust1/app1/result.md',
      reportFilename: 'report.md',
      lambdaRequestId: 'r1',
      evidence: { status: 'uploaded', artifactCount: 4, uploadedCount: 4 },
      cost: { totalUsd: 0.0123, inputTokens: 1234, outputTokens: 567 },
      error: null,
      updatedAt: '2026-05-14T00:02:00Z',
      startedBy: 'tester',
    });
    headResultMock.mockResolvedValueOnce({ size: 1024, etag: '"abc"' });

    const { GET } = await import('../route');
    const response = await (GET as unknown as (req: NextRequest) => Promise<Response>)(makeRequest());

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.cost).toEqual({ totalUsd: 0.0123, inputTokens: 1234, outputTokens: 567 });
    expect(body.evidence).toMatchObject({ artifactCount: 4, uploadedCount: 4 });
  });

  it('returns cost: null when state.cost is missing', async () => {
    readStateMock.mockResolvedValueOnce({
      investigationId: 'inv-2026-05-14-deadbeef',
      appId: 'app1',
      customerId: 'cust1',
      status: 'failed',
      startedAt: '2026-05-14T00:00:00Z',
      heartbeatAt: '2026-05-14T00:01:00Z',
      completedAt: '2026-05-14T00:02:00Z',
      durationMs: 60000,
      phase: null,
      lastEvent: null,
      input: { feedback: 'x' },
      resultKey: null,
      reportFilename: null,
      lambdaRequestId: 'r1',
      error: 'boom',
      updatedAt: '2026-05-14T00:02:00Z',
      startedBy: 'tester',
    });

    const { GET } = await import('../route');
    const response = await (GET as unknown as (req: NextRequest) => Promise<Response>)(makeRequest());

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.cost).toBeNull();
    expect(body.evidence).toBeNull();
  });
});
