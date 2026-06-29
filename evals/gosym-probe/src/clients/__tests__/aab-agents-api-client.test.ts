import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { AABAgentsApiClient } from '../aab-agents-api-client.js';

describe('AABAgentsApiClient', () => {
  let client: AABAgentsApiClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new AABAgentsApiClient('http://localhost:4000');
  });

  describe('registerApp()', () => {
    it('POSTs to /apps/register with siteId and name', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          app: { id: 'eval-abc' },
          created: true,
        }),
      });

      const id = await client.registerApp('eval-abc');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4000/apps/register',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            siteId: 'eval-abc',
            name: 'eval-eval-abc',
          }),
        },
      );
      expect(id).toBe('eval-abc');
    });

    it('returns the app id from the response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ app: { id: 'my-app' } }),
      });

      const id = await client.registerApp('my-app');
      expect(id).toBe('my-app');
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ error: 'Internal server error' }),
      });

      await expect(client.registerApp('bad-id')).rejects.toThrow(
        /register app.*bad-id.*500/i,
      );
    });
  });

  describe('deleteApp()', () => {
    it('DELETEs /apps/:id', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      await client.deleteApp('eval-abc');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4000/apps/eval-abc',
        { method: 'DELETE' },
      );
    });

    it('resolves silently on 404 (already deleted)', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      await expect(client.deleteApp('missing')).resolves.toBeUndefined();
    });

    it('throws on server error', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      await expect(client.deleteApp('bad-id')).rejects.toThrow(
        /delete app.*bad-id.*500/i,
      );
    });
  });

  describe('seedSummary()', () => {
    it('POSTs the summary to the debug seed endpoint with a bearer token', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true, summaryId: 'sum-1' }),
      });

      const id = await client.seedSummary('app-1', {
        summaryText: '## State\nLanding page built.',
        messageCount: 6,
      });

      expect(id).toBe('sum-1');
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:4000/debug/app-1/seed-summary');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toMatch(/^Bearer /);
      expect(JSON.parse(init.body)).toEqual({
        summaryText: '## State\nLanding page built.',
        messageCount: 6,
      });
    });

    it('forwards raw priorTurns for higher-fidelity seeding', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ summaryId: 'sum-3', conversationId: 'conv-1' }),
      });

      await client.seedSummary('app-1', {
        summaryText: 'state',
        priorTurns: [
          { sender: 'user', content: 'add a contact form' },
          { sender: 'agent', content: 'done' },
        ],
      });

      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        summaryText: 'state',
        priorTurns: [
          { sender: 'user', content: 'add a contact form' },
          { sender: 'agent', content: 'done' },
        ],
      });
    });

    it('omits optional fields that were not provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ summaryId: 'sum-2' }),
      });

      await client.seedSummary('app-1', { summaryText: 'hi' });

      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        summaryText: 'hi',
      });
    });

    it('throws on non-ok response, surfacing the server error body', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('{"error":"Failed to seed conversation summary"}'),
      });

      await expect(
        client.seedSummary('bad-app', { summaryText: 'x' }),
      ).rejects.toThrow(/seed summary.*bad-app.*500.*Failed to seed conversation summary/i);
    });
  });
});
