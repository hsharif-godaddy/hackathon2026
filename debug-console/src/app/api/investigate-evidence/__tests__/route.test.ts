import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  withAuth: (handler: unknown) => handler as (req: NextRequest) => Promise<Response>,
}));

const collectInvestigateEvidenceMock = vi.fn();

vi.mock('@/lib/investigate/evidence', async () => {
  const actual = await vi.importActual<typeof import('@/lib/investigate/evidence')>(
    '@/lib/investigate/evidence',
  );
  return {
    ...actual,
    collectInvestigateEvidence: (...args: unknown[]) => collectInvestigateEvidenceMock(...args),
  };
});

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('https://localhost/api/investigate-evidence', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('investigate-evidence route POST', () => {
  it('returns structured JSON when evidence collection fails unexpectedly', async () => {
    collectInvestigateEvidenceMock.mockRejectedValueOnce(new Error('index build failed'));

    const { POST } = await import('../route');
    const response = await (POST as unknown as (req: NextRequest) => Promise<Response>)(
      makeRequest({ appId: 'app123', timeWindow: '24h', sources: ['airo-app'] }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toMatchObject({
      error: 'Evidence collection failed',
      details: 'index build failed',
    });
  });
});
