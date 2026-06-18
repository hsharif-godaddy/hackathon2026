import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAgentFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/agent-fetch', () => ({ agentFetch: mockAgentFetch }));
vi.mock('@/lib/request-context', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { DkimAgentClient } from '../dkim-agent-client';

const AGENT_URL = 'https://agent.example.com';
const APP = 'aaaaaaaaaa';

function okJson(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('DkimAgentClient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('claim posts to the claim endpoint and returns the parsed result', async () => {
    mockAgentFetch.mockResolvedValue(okJson({ claimed: true, status: 'pending' }));
    const client = new DkimAgentClient(AGENT_URL, APP);
    const result = await client.claim('acme.com');
    expect(result).toEqual({ claimed: true, status: 'pending' });
    expect(mockAgentFetch).toHaveBeenCalledWith(
      `${AGENT_URL}/apps/${APP}/dkim/claim`,
      { siteId: APP, method: 'POST', body: JSON.stringify({ domain: 'acme.com' }) },
    );
  });

  it('claim throws on a non-ok response', async () => {
    mockAgentFetch.mockResolvedValue({ ok: false, status: 500 } as Response);
    const client = new DkimAgentClient(AGENT_URL, APP);
    await expect(client.claim('acme.com')).rejects.toThrow();
  });

  it('markActive posts to the active endpoint', async () => {
    mockAgentFetch.mockResolvedValue(okJson({ ok: true }));
    await new DkimAgentClient(AGENT_URL, APP).markActive('acme.com');
    expect(mockAgentFetch).toHaveBeenCalledWith(
      `${AGENT_URL}/apps/${APP}/dkim/active`,
      { siteId: APP, method: 'POST', body: JSON.stringify({ domain: 'acme.com' }) },
    );
  });

  it('setAccepted posts domain + executionArn', async () => {
    mockAgentFetch.mockResolvedValue(okJson({ ok: true }));
    await new DkimAgentClient(AGENT_URL, APP).setAccepted('acme.com', 'arn:1');
    expect(mockAgentFetch).toHaveBeenCalledWith(
      `${AGENT_URL}/apps/${APP}/dkim/accepted`,
      { siteId: APP, method: 'POST', body: JSON.stringify({ domain: 'acme.com', executionArn: 'arn:1' }) },
    );
  });

  it('setFailed posts domain + error', async () => {
    mockAgentFetch.mockResolvedValue(okJson({ ok: true }));
    await new DkimAgentClient(AGENT_URL, APP).setFailed('acme.com', 'boom');
    expect(mockAgentFetch).toHaveBeenCalledWith(
      `${AGENT_URL}/apps/${APP}/dkim/failed`,
      { siteId: APP, method: 'POST', body: JSON.stringify({ domain: 'acme.com', error: 'boom' }) },
    );
  });

  it('getRow GETs and returns createdAt from the agents row', async () => {
    mockAgentFetch.mockResolvedValue(okJson({
      createdAt: '2026-01-01T00:00:00.000Z',
      pollStartedAt: '2026-01-01T00:00:00.000Z',
      nextPollAt: '2026-01-01T00:00:30.000Z',
      lastPolledAt: null,
    }));
    const result = await new DkimAgentClient(AGENT_URL, APP).getRow('acme.com');
    expect(result).toEqual({
      createdAt: '2026-01-01T00:00:00.000Z',
      pollStartedAt: '2026-01-01T00:00:00.000Z',
      nextPollAt: '2026-01-01T00:00:30.000Z',
      lastPolledAt: null,
    });
    expect(mockAgentFetch).toHaveBeenCalledWith(
      `${AGENT_URL}/apps/${APP}/dkim?domain=acme.com`,
      { siteId: APP, method: 'GET' },
    );
  });

  it('getRow returns { createdAt: null } when no row exists', async () => {
    mockAgentFetch.mockResolvedValue(okJson({ createdAt: null }));
    const result = await new DkimAgentClient(AGENT_URL, APP).getRow('acme.com');
    expect(result).toEqual({ createdAt: null });
  });

  it('getRow throws on a non-ok response', async () => {
    mockAgentFetch.mockResolvedValue({ ok: false, status: 503, text: async () => 'down' } as unknown as Response);
    await expect(new DkimAgentClient(AGENT_URL, APP).getRow('acme.com')).rejects.toThrow('DkimAgentClient.getRow failed');
  });

  it('claimDuePoll posts to the poll claim endpoint', async () => {
    mockAgentFetch.mockResolvedValue(okJson({
      shouldPoll: false,
      expired: false,
      status: 'pending',
      pollStartedAt: '2026-06-17T10:00:00.000Z',
      nextPollAt: '2026-06-17T10:00:30.000Z',
      lastPolledAt: '2026-06-17T10:00:00.000Z',
    }));

    const result = await new DkimAgentClient(AGENT_URL, APP).claimDuePoll('acme.com');

    expect(result).toEqual({
      shouldPoll: false,
      expired: false,
      status: 'pending',
      pollStartedAt: '2026-06-17T10:00:00.000Z',
      nextPollAt: '2026-06-17T10:00:30.000Z',
      lastPolledAt: '2026-06-17T10:00:00.000Z',
    });
    expect(mockAgentFetch).toHaveBeenCalledWith(
      `${AGENT_URL}/apps/${APP}/dkim/poll/claim`,
      { siteId: APP, method: 'POST', body: JSON.stringify({ domain: 'acme.com' }) },
    );
  });

  it('completeDuePoll posts to the poll complete endpoint', async () => {
    mockAgentFetch.mockResolvedValue(okJson({ ok: true }));

    await new DkimAgentClient(AGENT_URL, APP).completeDuePoll('acme.com');

    expect(mockAgentFetch).toHaveBeenCalledWith(
      `${AGENT_URL}/apps/${APP}/dkim/poll/complete`,
      { siteId: APP, method: 'POST', body: JSON.stringify({ domain: 'acme.com' }) },
    );
  });

  it('deleteRow DELETEs with the domain query param', async () => {
    mockAgentFetch.mockResolvedValue(okJson({ ok: true }));
    await new DkimAgentClient(AGENT_URL, APP).deleteRow('acme.com');
    expect(mockAgentFetch).toHaveBeenCalledWith(
      `${AGENT_URL}/apps/${APP}/dkim?domain=acme.com`,
      { siteId: APP, method: 'DELETE' },
    );
  });

  it('markActive throws on a non-ok response', async () => {
    mockAgentFetch.mockResolvedValue({ ok: false, status: 500 } as Response);
    await expect(new DkimAgentClient(AGENT_URL, APP).markActive('acme.com')).rejects.toThrow();
  });

  it('deleteRow encodes reserved characters in the domain', async () => {
    mockAgentFetch.mockResolvedValue(okJson({ ok: true }));
    await new DkimAgentClient(AGENT_URL, APP).deleteRow('ac+me.com');
    expect(mockAgentFetch).toHaveBeenCalledWith(
      `${AGENT_URL}/apps/${APP}/dkim?domain=ac%2Bme.com`,
      { siteId: APP, method: 'DELETE' },
    );
  });

  it('setAccepted throws on non-ok', async () => {
    mockAgentFetch.mockResolvedValue({ ok: false, status: 500 } as Response);
    await expect(new DkimAgentClient(AGENT_URL, APP).setAccepted('acme.com', 'arn:1')).rejects.toThrow();
  });

  it('setFailed throws on non-ok', async () => {
    mockAgentFetch.mockResolvedValue({ ok: false, status: 500 } as Response);
    await expect(new DkimAgentClient(AGENT_URL, APP).setFailed('acme.com', 'boom')).rejects.toThrow();
  });

  it('deleteRow throws on non-ok', async () => {
    mockAgentFetch.mockResolvedValue({ ok: false, status: 500 } as Response);
    await expect(new DkimAgentClient(AGENT_URL, APP).deleteRow('acme.com')).rejects.toThrow();
  });
});
