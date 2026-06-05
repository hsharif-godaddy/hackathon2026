import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  withAuth: (handler: unknown) => handler as (req: NextRequest, auth: unknown) => Promise<Response>,
}));

const getAgentUrlMock = vi.fn();
vi.mock('@/lib/mgmt-control-plane-adapter', () => ({
  default: {
    getAgentUrl: (...args: unknown[]) => getAgentUrlMock(...args),
  },
}));

const acquireLockMock = vi.fn();
vi.mock('@/lib/investigate/lock', () => ({
  acquireLock: (...args: unknown[]) => acquireLockMock(...args),
}));

const invokeInvestigatorMock = vi.fn();
vi.mock('@/lib/investigate/lambda-client', () => ({
  invokeInvestigator: (...args: unknown[]) => invokeInvestigatorMock(...args),
}));

const auth = { user: { email: 'tester@godaddy.com' } };

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('https://localhost/api/investigate', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

async function callPost(body: Record<string, unknown>): Promise<Response> {
  const { POST } = await import('../route');
  return (POST as unknown as (req: NextRequest, auth: unknown) => Promise<Response>)(
    makeRequest(body),
    auth,
  );
}

const validBody = {
  appId: 'app1',
  customerId: 'cust1',
  feedback: 'something is broken',
  source: 'console',
};

describe('POST /api/investigate', () => {
  beforeEach(() => {
    getAgentUrlMock.mockReset();
    acquireLockMock.mockReset();
    invokeInvestigatorMock.mockReset();
    acquireLockMock.mockResolvedValue({ acquired: true });
    invokeInvestigatorMock.mockResolvedValue(undefined);
  });

  it('resolves agentUrl and passes it (with source:console) to the lambda, without jomax/fullstory', async () => {
    getAgentUrlMock.mockResolvedValueOnce('https://agent.example/app1');

    const response = await callPost(validBody);

    expect(response.status).toBe(202);
    expect(getAgentUrlMock).toHaveBeenCalledWith('app1');
    expect(invokeInvestigatorMock).toHaveBeenCalledTimes(1);

    const payload = invokeInvestigatorMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.agentUrl).toBe('https://agent.example/app1');
    expect(payload.source).toBe('console');
    expect(payload).not.toHaveProperty('jomaxToken');
    expect(payload).not.toHaveProperty('fullstoryUrl');
  });

  it('returns 502 agent_url_unresolved and does not lock or invoke when getAgentUrl rejects', async () => {
    getAgentUrlMock.mockRejectedValueOnce(new Error('no agent_url'));

    const response = await callPost(validBody);

    expect(response.status).toBe(502);
    const errBody = (await response.json()) as Record<string, unknown>;
    expect(errBody.error).toBe('agent_url_unresolved');
    expect(acquireLockMock).not.toHaveBeenCalled();
    expect(invokeInvestigatorMock).not.toHaveBeenCalled();
  });
});
