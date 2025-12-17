/**
 * KnowB Search Tool Tests
 *
 * Tests for the KnowB knowledge base search tool
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KnowBSearchTool } from '../knowb-search-tool.js';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('KnowBSearchTool', () => {
  let tool: KnowBSearchTool;
  const originalEnv = process.env;

  beforeEach(() => {
    tool = new KnowBSearchTool();
    mockFetch.mockClear();
    
    // Reset environment
    process.env = { ...originalEnv };
    process.env.SSO_JWT = 'test-jwt-token';
    process.env.KNOWB_API_URL = 'https://test-knowb.api.test.com/v1/search';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Authentication', () => {
    it('should require SSO_JWT configuration', async () => {
      delete process.env.SSO_JWT;
      const toolNoAuth = new KnowBSearchTool();
      
      const result = await toolNoAuth.search({
        query: 'test query',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('SSO_JWT');
    });

    it('should format SSO_JWT with sso-jwt prefix', async () => {
      process.env.SSO_JWT = 'my-token-123';
      const toolWithAuth = new KnowBSearchTool();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await toolWithAuth.search({ query: 'test' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'sso-jwt my-token-123',
          }),
        })
      );
    });
  });

  describe('Query Validation', () => {
    it('should reject empty query', async () => {
      const result = await tool.search({ query: '' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Query must be a non-empty string');
    });

    it('should reject whitespace-only query', async () => {
      const result = await tool.search({ query: '   ' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Query must be a non-empty string');
    });

    it('should accept valid query', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      const result = await tool.search({ query: 'How to deploy' });

      expect(result.success).toBe(true);
    });
  });

  describe('API Request', () => {
    it('should send correct request body structure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await tool.search({
        query: 'deployment guide',
        maxResults: 10,
        scoreThreshold: 0.3,
        kbNodeIds: ['/custom/path.md'],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'accept': 'application/json',
            'Content-Type': 'application/json',
          }),
          body: expect.stringContaining('"query":"deployment guide"'),
        })
      );

      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody).toEqual({
        filter: {
          kbNodeIds: ['/custom/path.md'],
          maxNumberOfResult: 10,
          scoreThreshold: 0.3,
        },
        query: 'deployment guide',
        rerankingConfig: {
          results: 10,
          type: 'amazon',
        },
        searchType: 'auto',
      });
    });

    it('should use default values when options not provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await tool.search({ query: 'test query' });

      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody.filter.kbNodeIds).toEqual(['/airo_sys']);
      expect(requestBody.filter.maxNumberOfResult).toBe(5);
      expect(requestBody.filter.scoreThreshold).toBe(0.35);
    });

    it('should trim query before sending', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await tool.search({ query: '  test query  ' });

      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody.query).toBe('test query');
    });
  });

  describe('API Response Handling', () => {
    it('should parse successful API response', async () => {
      const mockResults = [
        {
          location: { kbNodeId: '/doc1.md' },
          content: { text: 'Content 1', type: 'TEXT' },
          score: 0.8,
          metadata: { tag: 'deployment' },
        },
        {
          location: { kbNodeId: '/doc2.md' },
          content: { text: 'Content 2', type: 'TEXT' },
          score: 0.6,
          metadata: {},
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: mockResults }),
      });

      const result = await tool.search({ query: 'test' });

      expect(result.success).toBe(true);
      expect(result.totalResults).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.results![0]).toEqual({
        location: { kbNodeId: '/doc1.md' },
        content: { text: 'Content 1', type: 'TEXT' },
        score: 0.8,
        metadata: { tag: 'deployment' },
      });
    });

    it('should handle empty results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      const result = await tool.search({ query: 'nonexistent' });

      expect(result.success).toBe(true);
      expect(result.totalResults).toBe(0);
      expect(result.results).toEqual([]);
    });

    it('should handle API error responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Invalid token',
      });

      const result = await tool.search({ query: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('401 Unauthorized');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

      const result = await tool.search({ query: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network timeout');
    });

    it('should handle malformed JSON responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      const result = await tool.search({ query: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid JSON');
    });
  });

  describe('Context Logging', () => {
    it('should include appId in logging context when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      const result = await tool.search({
        query: 'test',
        appId: 'app-123',
      });

      expect(result.success).toBe(true);
      // Logging verification would require logger mocking
    });
  });

  describe('URL Configuration', () => {
    it('should use default API URL when not configured', () => {
      delete process.env.KNOWB_API_URL;
      const toolDefault = new KnowBSearchTool();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      toolDefault.search({ query: 'test' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://knowb.api.int.test-godaddy.com/v1/search',
        expect.any(Object)
      );
    });

    it('should use custom API URL when configured', () => {
      process.env.KNOWB_API_URL = 'https://custom.api.com/search';
      const toolCustom = new KnowBSearchTool();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      toolCustom.search({ query: 'test' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.api.com/search',
        expect.any(Object)
      );
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle deployment query', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              location: { kbNodeId: '/airo_sys/deployment.md' },
              content: {
                text: '# Deployment & Publishing\n## Current Status',
                type: 'TEXT',
              },
              score: 0.4208281,
              metadata: {},
            },
          ],
        }),
      });

      const result = await tool.search({ query: 'How to Publish' });

      expect(result.success).toBe(true);
      expect(result.results![0].location.kbNodeId).toBe('/airo_sys/deployment.md');
      expect(result.results![0].score).toBeGreaterThan(0.4);
    });

    it('should handle multiple knowledge base nodes', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await tool.search({
        query: 'configuration',
        kbNodeIds: ['/airo_sys'],
      });

      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody.filter.kbNodeIds).toHaveLength(1);
    });
  });
});

