import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  withAuth: (handler: unknown) => handler as (req: NextRequest, auth: unknown, ctx: unknown) => Promise<Response>,
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

const readAnalysisMock = vi.fn();

vi.mock('@/lib/investigate/summaries', () => ({
  ensureSummaryAfterTerminal: vi.fn(),
  readAnalysis: (...args: unknown[]) => readAnalysisMock(...args),
}));

const INVESTIGATION_ID = 'inv-2026-05-14-deadbeef';

function makeRequest(): NextRequest {
  return new NextRequest(
    `https://localhost/api/investigate/${INVESTIGATION_ID}/status?appId=app1&customerId=cust1`,
  );
}

function makeContext(): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: INVESTIGATION_ID }) };
}

type Handler = (req: NextRequest, auth: unknown, ctx: unknown) => Promise<Response>;

function completedState(): Record<string, unknown> {
  return {
    investigationId: INVESTIGATION_ID,
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
    error: null,
    updatedAt: '2026-05-14T00:02:00Z',
    startedBy: 'tester',
  };
}

describe('GET /api/investigate/[id]/status', () => {
  it('includes verdict + fix fields from the analysis sidecar for completed runs', async () => {
    readStateMock.mockResolvedValueOnce(completedState());
    headResultMock.mockResolvedValueOnce({ size: 1024, etag: '"abc"' });
    readAnalysisMock.mockResolvedValueOnce({
      verdict: 'platform-bug',
      relatesTo: 'publish pipeline',
      verdictConfidence: 'medium',
      verdictRationale: 'Publish step 503s intermittently.',
      verifierNote: 'No log template cited for the 503 claim.',
      fixKind: 'eng-note',
      fixPrompt: null,
      engNote: 'File a ticket against the publish service for 503 retries.',
    });

    const { GET } = await import('../route');
    const response = await (GET as unknown as Handler)(makeRequest(), undefined, makeContext());

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.verdict).toBe('platform-bug');
    expect(body.relatesTo).toBe('publish pipeline');
    expect(body.verdictConfidence).toBe('medium');
    expect(body.verdictRationale).toBe('Publish step 503s intermittently.');
    expect(body.verifierNote).toBe('No log template cited for the 503 claim.');
    expect(body.fixKind).toBe('eng-note');
    expect(body.fixPrompt).toBeNull();
    expect(body.engNote).toBe('File a ticket against the publish service for 503 retries.');
  });

  it('returns null verdict + fix fields when no sidecar exists', async () => {
    readStateMock.mockResolvedValueOnce(completedState());
    headResultMock.mockResolvedValueOnce({ size: 1024, etag: '"abc"' });
    readAnalysisMock.mockResolvedValueOnce(null);

    const { GET } = await import('../route');
    const response = await (GET as unknown as Handler)(makeRequest(), undefined, makeContext());

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.verdict).toBeNull();
    expect(body.fixKind).toBeNull();
    expect(body.fixPrompt).toBeNull();
    expect(body.engNote).toBeNull();
  });

  it('does not read the sidecar for non-completed runs', async () => {
    readStateMock.mockResolvedValueOnce({
      ...completedState(),
      status: 'failed',
      resultKey: null,
      error: 'boom',
    });

    const { GET } = await import('../route');
    const response = await (GET as unknown as Handler)(makeRequest(), undefined, makeContext());

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(readAnalysisMock).not.toHaveBeenCalled();
    expect(body.verdict).toBeNull();
    expect(body.fixKind).toBeNull();
  });
});
