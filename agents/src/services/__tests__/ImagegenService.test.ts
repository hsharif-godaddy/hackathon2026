import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the ai-lib S2S auth
vi.mock('@airo/ai-lib', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getS2SToken: vi.fn().mockResolvedValue('mock-s2s-token'),
    isS2SAuthEnabled: vi.fn().mockReturnValue(true),
  };
});

// Mock logger
vi.mock('../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock fetch
const mockFetch = vi.fn();

describe('ImagegenService', () => {
  let originalFetch: typeof global.fetch;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = global.fetch;
    global.fetch = mockFetch;
    originalEnv = { ...process.env };
    process.env.IMAGEGEN_API_URL = 'https://imagegen-agent.mvci.api.dev-godaddy.com';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
    vi.resetModules();
  });

  describe('generateImages', () => {
    it('should call POST /v2/api/images with correct headers and body', async () => {
      const { imagegenService } = await import('../ImagegenService.js');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            sessionId: 'sess-123',
            entitled: true,
            images: [
              { id: 'img-1', url: 'https://cdn/img1.png' },
              { id: 'img-2', url: 'https://cdn/img2.png' },
            ],
          }),
      });

      const result = await imagegenService.generateImages({
        description: 'A professional business team',
        orientation: 'landscape',
        count: 2,
        customerId: 'cust-123',
        budgetUserId: 'budget-user-456',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://imagegen-agent.mvci.api.dev-godaddy.com/v2/api/images',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'x-app-key': 'airo-app-builder',
            'x-customer-id': 'cust-123',
            'x-budget-user-id': 'budget-user-456',
            Authorization: 'Bearer mock-s2s-token',
          }),
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toEqual({
        description: 'A professional business team',
        orientation: 'landscape',
        count: 2,
      });

      expect(result).toEqual({
        sessionId: 'sess-123',
        images: [
          { id: 'img-1', url: 'https://cdn/img1.png' },
          { id: 'img-2', url: 'https://cdn/img2.png' },
        ],
      });
    });

    it('should send optional style when provided', async () => {
      const { imagegenService } = await import('../ImagegenService.js');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sessionId: 'sess-1', images: [] }),
      });

      await imagegenService.generateImages({
        description: 'test',
        orientation: 'square',
        style: 'cinematic',
        customerId: 'cust-1',
        budgetUserId: 'budget-1',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.style).toBe('cinematic');
    });

    it('should always include budget headers', async () => {
      const { imagegenService } = await import('../ImagegenService.js');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sessionId: 'sess-1', images: [] }),
      });

      await imagegenService.generateImages({
        description: 'test',
        orientation: 'landscape',
        customerId: 'cust-123',
        budgetUserId: 'budget-user-abc',
      });

      const callHeaders = mockFetch.mock.calls[0][1].headers;
      expect(callHeaders['x-budget-user-id']).toBe('budget-user-abc');
      expect(callHeaders['x-customer-id']).toBe('cust-123');
    });

    it('should throw BudgetExceededError on HTTP 402', async () => {
      const { imagegenService } = await import('../ImagegenService.js');
      const { BudgetExceededError } = await import('@airo/ai-common');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 402,
        text: () => Promise.resolve('Budget exceeded'),
      });

      await expect(
        imagegenService.generateImages({
          description: 'test',
          orientation: 'landscape',
          customerId: 'cust-123',
          budgetUserId: 'budget-1',
        })
      ).rejects.toSatisfy((error: unknown) => BudgetExceededError.isInstance(error));
    });

    it('should throw on API failure', async () => {
      const { imagegenService } = await import('../ImagegenService.js');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      await expect(
        imagegenService.generateImages({
          description: 'test',
          orientation: 'landscape',
          customerId: 'cust-123',
          budgetUserId: 'budget-1',
        })
      ).rejects.toThrow('Imagegen API error (image.generate): 500 Internal Server Error');
    });

    it('should throw on network error', async () => {
      const { imagegenService } = await import('../ImagegenService.js');

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        imagegenService.generateImages({
          description: 'test',
          orientation: 'landscape',
          customerId: 'cust-123',
          budgetUserId: 'budget-1',
        })
      ).rejects.toThrow('Network error');
    });
  });

  describe('editImage', () => {
    it('should call POST /v2/api/images/edit with correct headers and body', async () => {
      const { imagegenService } = await import('../ImagegenService.js');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            sessionId: 'sess-edit-1',
            entitled: true,
            url: 'https://cdn/edited.png',
          }),
      });

      const result = await imagegenService.editImage({
        description: 'Remove the background',
        imageUrl: 'https://example.com/original.png',
        customerId: 'cust-123',
        budgetUserId: 'budget-456',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://imagegen-agent.mvci.api.dev-godaddy.com/v2/api/images/edit',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-s2s-token',
            'x-customer-id': 'cust-123',
            'x-budget-user-id': 'budget-456',
          }),
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toEqual({
        description: 'Remove the background',
        imageUrl: 'https://example.com/original.png',
      });

      expect(result).toEqual({
        sessionId: 'sess-edit-1',
        url: 'https://cdn/edited.png',
      });
    });

    it('should throw BudgetExceededError on HTTP 402', async () => {
      const { imagegenService } = await import('../ImagegenService.js');
      const { BudgetExceededError } = await import('@airo/ai-common');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 402,
        text: () => Promise.resolve('Budget exceeded'),
      });

      await expect(
        imagegenService.editImage({
          description: 'test edit',
          imageUrl: 'https://example.com/img.png',
          customerId: 'cust-123',
          budgetUserId: 'budget-1',
        })
      ).rejects.toSatisfy((error: unknown) => BudgetExceededError.isInstance(error));
    });

    it('should throw on API failure', async () => {
      const { imagegenService } = await import('../ImagegenService.js');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server Error'),
      });

      await expect(
        imagegenService.editImage({
          description: 'test',
          imageUrl: 'https://example.com/img.png',
          customerId: 'cust-123',
          budgetUserId: 'budget-1',
        })
      ).rejects.toThrow('Imagegen API error (image.edit): 500 Server Error');
    });
  });

  describe('generateVideo', () => {
    it('should POST then poll until completed', async () => {
      const { imagegenService } = await import('../ImagegenService.js');

      // POST /v2/api/videos -> 202
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sessionId: 'vid-123', status: 'processing' }),
      });

      // First poll -> processing
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sessionId: 'vid-123', status: 'processing' }),
      });

      // Second poll -> completed
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            sessionId: 'vid-123',
            status: 'completed',
            entitled: true,
            url: 'https://cdn/video.mp4',
          }),
      });

      const result = await imagegenService.generateVideo({
        description: 'Sunrise over mountains',
        orientation: 'landscape',
        duration: 8,
        customerId: 'cust-123',
        budgetUserId: 'budget-456',
      });

      // Verify POST call
      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://imagegen-agent.mvci.api.dev-godaddy.com/v2/api/videos'
      );
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toEqual({
        description: 'Sunrise over mountains',
        orientation: 'landscape',
        duration: 8,
      });

      // Verify poll calls
      expect(mockFetch.mock.calls[1][0]).toBe(
        'https://imagegen-agent.mvci.api.dev-godaddy.com/v2/api/videos/vid-123'
      );
      expect(mockFetch.mock.calls[1][1].method).toBe('GET');

      expect(result).toEqual({
        sessionId: 'vid-123',
        url: 'https://cdn/video.mp4',
      });
    }, 30_000);

    it('should throw when video generation fails', async () => {
      const { imagegenService } = await import('../ImagegenService.js');

      // POST -> 202
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sessionId: 'vid-fail', status: 'processing' }),
      });

      // Poll -> failed
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            sessionId: 'vid-fail',
            status: 'failed',
            error: 'Content policy violation',
          }),
      });

      await expect(
        imagegenService.generateVideo({
          description: 'test',
          orientation: 'landscape',
          duration: 5,
          customerId: 'cust-123',
          budgetUserId: 'budget-1',
        })
      ).rejects.toThrow('Video generation failed: Content policy violation');
    }, 30_000);

    it('should throw BudgetExceededError on HTTP 402 from initial POST', async () => {
      const { imagegenService } = await import('../ImagegenService.js');
      const { BudgetExceededError } = await import('@airo/ai-common');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 402,
        text: () => Promise.resolve('Budget exceeded'),
      });

      await expect(
        imagegenService.generateVideo({
          description: 'test',
          orientation: 'landscape',
          duration: 5,
          customerId: 'cust-123',
          budgetUserId: 'budget-1',
        })
      ).rejects.toSatisfy((error: unknown) => BudgetExceededError.isInstance(error));
    });

    it('should throw BudgetExceededError on HTTP 402 from status poll', async () => {
      const { imagegenService } = await import('../ImagegenService.js');
      const { BudgetExceededError } = await import('@airo/ai-common');

      // POST -> 202 accepted
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sessionId: 'vid-poll-402', status: 'processing' }),
      });

      // First poll -> 402 budget exceeded
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 402,
        text: () => Promise.resolve('Budget exceeded during generation'),
      });

      await expect(
        imagegenService.generateVideo({
          description: 'test',
          orientation: 'landscape',
          duration: 5,
          customerId: 'cust-123',
          budgetUserId: 'budget-1',
        })
      ).rejects.toSatisfy((error: unknown) => BudgetExceededError.isInstance(error));
    }, 30_000);

    it('should complete immediately if first poll returns completed', async () => {
      const { imagegenService } = await import('../ImagegenService.js');

      // POST -> 202
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sessionId: 'vid-fast', status: 'processing' }),
      });

      // First poll -> completed
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            sessionId: 'vid-fast',
            status: 'completed',
            entitled: true,
            url: 'https://cdn/fast-video.mp4',
          }),
      });

      const result = await imagegenService.generateVideo({
        description: 'test',
        orientation: 'landscape',
        duration: 5,
        customerId: 'cust-123',
        budgetUserId: 'budget-1',
      });

      expect(result.url).toBe('https://cdn/fast-video.mp4');
      expect(mockFetch).toHaveBeenCalledTimes(2); // POST + 1 poll
    }, 30_000);
  });

  describe('URL resolution', () => {
    it('should use IMAGEGEN_API_URL when set', async () => {
      process.env.IMAGEGEN_API_URL = 'https://custom-imagegen.example.com';

      const { imagegenService } = await import('../ImagegenService.js');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sessionId: 's1', images: [] }),
      });

      await imagegenService.generateImages({
        description: 'test',
        orientation: 'landscape',
        customerId: 'cust-1',
        budgetUserId: 'budget-1',
      });

      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://custom-imagegen.example.com/v2/api/images'
      );
    });

    it('should derive dev URL from GODADDY_API_BASE_URL', async () => {
      delete process.env.IMAGEGEN_API_URL;
      process.env.GODADDY_API_BASE_URL = 'https://api.dev-godaddy.com';

      const { imagegenService } = await import('../ImagegenService.js');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sessionId: 's1', images: [] }),
      });

      await imagegenService.generateImages({
        description: 'test',
        orientation: 'landscape',
        customerId: 'cust-1',
        budgetUserId: 'budget-1',
      });

      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://imagegen-agent.mvci.api.dev-godaddy.com/v2/api/images'
      );
    });

    it('should derive test URL from GODADDY_API_BASE_URL', async () => {
      delete process.env.IMAGEGEN_API_URL;
      process.env.GODADDY_API_BASE_URL = 'https://api.test-godaddy.com';

      const { imagegenService } = await import('../ImagegenService.js');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sessionId: 's1', images: [] }),
      });

      await imagegenService.generateImages({
        description: 'test',
        orientation: 'landscape',
        customerId: 'cust-1',
        budgetUserId: 'budget-1',
      });

      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://imagegen-agent.mvci.api.test-godaddy.com/v2/api/images'
      );
    });

    it('should default to production URL', async () => {
      delete process.env.IMAGEGEN_API_URL;
      delete process.env.GODADDY_API_BASE_URL;

      const { imagegenService } = await import('../ImagegenService.js');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sessionId: 's1', images: [] }),
      });

      await imagegenService.generateImages({
        description: 'test',
        orientation: 'landscape',
        customerId: 'cust-1',
        budgetUserId: 'budget-1',
      });

      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://imagegen-agent.mvci.api.godaddy.com/v2/api/images'
      );
    });
  });
});
