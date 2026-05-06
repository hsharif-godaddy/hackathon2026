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
});
