import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PublishErrorCode } from '@airo/shared/publish';

import * as postAgentPublish from '@/lib/post-agent-publish';

describe('post-agent-publish', function packageTests() {
  beforeEach(function reset() {
    vi.restoreAllMocks();
  });

  describe('#body', function bodyTests() {
    it('serializes publishedUrl when provided', function withUrl() {
      expect(postAgentPublish.body('https://live.example.com')).toBe(
        JSON.stringify({ publishedUrl: 'https://live.example.com' }),
      );
    });

    it('serializes null when publishedUrl is missing', function withoutUrl() {
      expect(postAgentPublish.body(undefined)).toBe(JSON.stringify({ publishedUrl: null }));
    });
  });

  describe('#post', function postTests() {
    it('POSTs to agent publish with JSON body', async function publish() {
      vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

      await postAgentPublish.post(
        'https://agent.test',
        'app-123',
        'jwt-token',
        'https://live.example.com',
      );

      expect(global.fetch).toHaveBeenCalledWith(
        'https://agent.test/apps/app-123/publish',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer jwt-token',
          },
          body: JSON.stringify({ publishedUrl: 'https://live.example.com' }),
        }),
      );
    });
  });

  describe('#postWithStaleRetry', function retryTests() {
    it('retries once with a fresh token on TOKEN_STALE', async function tokenStale() {
      vi.spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: async () => ({ code: PublishErrorCode.TokenStale }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ commitHash: 'abc' }),
        } as Response);

      const refreshToken = vi.fn().mockResolvedValue({ token: 'fresh-token' });

      const { response } = await postAgentPublish.postWithStaleRetry({
        agentUrl: 'https://agent.test',
        appId: 'app-123',
        token: 'stale-token',
        publishedUrl: 'https://live.example.com',
        refreshToken,
      });

      expect(refreshToken).toHaveBeenCalledOnce();
      expect(response.ok).toBe(true);
      expect(global.fetch).toHaveBeenLastCalledWith(
        'https://agent.test/apps/app-123/publish',
        expect.objectContaining({
          body: JSON.stringify({ publishedUrl: 'https://live.example.com' }),
          headers: expect.objectContaining({
            'Authorization': 'Bearer fresh-token',
          }),
        }),
      );
    });
  });
});
