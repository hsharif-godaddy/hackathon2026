import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CustomerAuthContext } from '@/lib/customer-auth';
import { fetchSocialPostsFromAgents } from './social-posts';

// Mock dependencies
vi.mock('@/lib/jwt-service', () => ({
  getJWTService: vi.fn(() => ({
    createToken: vi.fn().mockResolvedValue({
      token: 'mock-jwt-token',
      expires: new Date('2026-01-01').toISOString(),
    }),
  })),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/errors', () => ({
  getErrorMessage: vi.fn((error) => error instanceof Error ? error.message : String(error)),
}));

describe('social-posts', () => {
  const mockAppId = 'test-app-id';
  const mockMonth = new Date('2026-02-01T12:00:00Z');
  const mockAuthContext: CustomerAuthContext = {
    user: {
      customerId: "test-customer",
      accountId: "test-account",
      authType: "basic",
      isE2S: false,
      shopperId: "123",
    },
    jwt: "test-jwt",
    isAuthenticated: true,
  };

  const mockAgentUrl = 'http://localhost:4000';

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  describe('fetchSocialPostsFromAgents', () => {
    it('should fetch and transform social posts successfully', async () => {
      const mockApiResponse = {
        posts: [
          {
            id: 'post-1',
            platform: 'FACEBOOK',
            state: 'SCHEDULED',
            scheduledAt: '2026-02-15T10:00:00Z',
            payload: JSON.stringify({
              message: 'Test post message',
              imageUrls: ['https://example.com/image.jpg'],
            }),
          },
          {
            id: 'post-2',
            platform: 'INSTAGRAM',
            state: 'PUBLISHED',
            completedAt: '2026-02-20T14:30:00Z',
            payload: JSON.stringify({
              message: 'Published post',
              imageUrls: [],
            }),
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockApiResponse,
      });

      const result = await fetchSocialPostsFromAgents(mockAppId, mockMonth, mockAuthContext, mockAgentUrl);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        slug: 'post-1',
        title: 'FACEBOOK post',
        publishedAt: '2026-02-15T10:00:00Z',
        status: 'scheduled',
        type: 'social',
        platform: 'facebook',
        postId: 'post-1',
        message: 'Test post message',
        imageUrls: ['https://example.com/image.jpg'],
      });
      expect(result[1]).toEqual({
        slug: 'post-2',
        title: 'INSTAGRAM post',
        publishedAt: '2026-02-20T14:30:00Z',
        status: 'published',
        type: 'social',
        platform: 'instagram',
        postId: 'post-2',
        message: 'Published post',
        imageUrls: [],
      });
    });

    it('should filter posts by month', async () => {
      const mockApiResponse = {
        posts: [
          {
            id: 'post-1',
            platform: 'FACEBOOK',
            state: 'SCHEDULED',
            scheduledAt: '2026-02-15T10:00:00Z', // February - should be included
            payload: '{}',
          },
          {
            id: 'post-2',
            platform: 'INSTAGRAM',
            state: 'SCHEDULED',
            scheduledAt: '2026-03-15T10:00:00Z', // March - should be excluded
            payload: '{}',
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockApiResponse,
      });

      const result = await fetchSocialPostsFromAgents(mockAppId, mockMonth, mockAuthContext, mockAgentUrl);

      expect(result).toHaveLength(1);
      expect(result[0].slug).toBe('post-1');
    });

    it('should filter out non-scheduled and non-published posts', async () => {
      const mockApiResponse = {
        posts: [
          {
            id: 'post-1',
            platform: 'FACEBOOK',
            state: 'SCHEDULED',
            scheduledAt: '2026-02-15T10:00:00Z',
            payload: '{}',
          },
          {
            id: 'post-2',
            platform: 'INSTAGRAM',
            state: 'FAILED',
            scheduledAt: '2026-02-20T10:00:00Z',
            payload: '{}',
          },
          {
            id: 'post-3',
            platform: 'FACEBOOK',
            state: 'PENDING',
            scheduledAt: '2026-02-25T10:00:00Z',
            payload: '{}',
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockApiResponse,
      });

      const result = await fetchSocialPostsFromAgents(mockAppId, mockMonth, mockAuthContext, mockAgentUrl);

      expect(result).toHaveLength(1);
      expect(result[0].slug).toBe('post-1');
    });

    it('should truncate long messages to 100 characters', async () => {
      const longMessage = 'a'.repeat(150);
      const mockApiResponse = {
        posts: [
          {
            id: 'post-1',
            platform: 'FACEBOOK',
            state: 'SCHEDULED',
            scheduledAt: '2026-02-15T10:00:00Z',
            payload: JSON.stringify({ message: longMessage }),
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockApiResponse,
      });

      const result = await fetchSocialPostsFromAgents(mockAppId, mockMonth, mockAuthContext, mockAgentUrl);

      // Truncation adds '...' to 100 chars
      expect(result[0].message?.length).toBeLessThanOrEqual(103);
      expect(result[0].message).toContain('...');
    });

    it('should return empty array when API call fails', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const result = await fetchSocialPostsFromAgents(mockAppId, mockMonth, mockAuthContext, mockAgentUrl);

      expect(result).toEqual([]);
    });

    it('should return empty array when fetch throws error', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      const result = await fetchSocialPostsFromAgents(mockAppId, mockMonth, mockAuthContext, mockAgentUrl);

      expect(result).toEqual([]);
    });

    it('should handle posts with no payload gracefully', async () => {
      const mockApiResponse = {
        posts: [
          {
            id: 'post-1',
            platform: 'FACEBOOK',
            state: 'SCHEDULED',
            scheduledAt: '2026-02-15T10:00:00Z',
            payload: null,
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockApiResponse,
      });

      const result = await fetchSocialPostsFromAgents(mockAppId, mockMonth, mockAuthContext, mockAgentUrl);

      expect(result).toHaveLength(1);
      expect(result[0].message).toBeUndefined();
      expect(result[0].imageUrls).toEqual([]);
    });

    it('should use the provided agent URL', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ posts: [] }),
      });

      await fetchSocialPostsFromAgents(mockAppId, mockMonth, mockAuthContext, 'https://agent.example.com');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://agent.example.com/apps/test-app-id/social/posts',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer mock-jwt-token',
          }),
        })
      );
    });

    it('should authenticate with agent token', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ posts: [] }),
      });

      await fetchSocialPostsFromAgents(mockAppId, mockMonth, mockAuthContext, mockAgentUrl);

      // Verify fetch was called with Bearer token
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/apps/test-app-id/social/posts'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer mock-jwt-token',
          }),
        })
      );
    });
  });
});
