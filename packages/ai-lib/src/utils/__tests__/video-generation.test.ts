import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreateOpenAIClient = vi.fn();
const mockVideoApiFetch = vi.fn();

vi.mock('../../providers/unified-provider.js', () => ({
  createOpenAIClient: mockCreateOpenAIClient,
}));

vi.mock('../video-api-fetch.js', () => ({
  videoApiFetch: mockVideoApiFetch,
}));

describe('video-generation', function packageTests() {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateOpenAIClient.mockResolvedValue({ baseURL: 'https://api.test/v1' });
  });

  describe('#resolveSoraResolution', function resolutionTests() {
    it('maps portrait to 720x1280', async function portrait() {
      const { resolveSoraResolution } = await import('../video-generation.js');
      expect(resolveSoraResolution('portrait')).toBe('720x1280');
    });

    it('maps landscape to 1280x720', async function landscape() {
      const { resolveSoraResolution } = await import('../video-generation.js');
      expect(resolveSoraResolution('landscape')).toBe('1280x720');
    });
  });

  describe('#generateSoraVideo', function generateTests() {
    it('submits, polls, and downloads a completed video', async function completed() {
      mockVideoApiFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'vid-123' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'completed' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => Buffer.from('video-bytes'),
        });

      const { generateSoraVideo } = await import('../video-generation.js');
      const result = await generateSoraVideo({
        prompt: 'Sunrise over mountains',
        orientation: 'landscape',
        duration: 8,
        pollIntervalMs: 1,
        maxPollMs: 1000,
      });

      expect(result.videoId).toBe('vid-123');
      expect(result.buffer.toString()).toBe('video-bytes');
      expect(mockVideoApiFetch).toHaveBeenCalledTimes(3);
    });

    it('throws when submit fails', async function submitFailed() {
      mockVideoApiFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        clone: () => ({ text: async () => 'internal server error' }),
      });

      const { generateSoraVideo } = await import('../video-generation.js');

      await expect(
        generateSoraVideo({
          prompt: 'Test',
          pollIntervalMs: 1,
          maxPollMs: 1000,
        })
      ).rejects.toThrow('Failed to submit Sora video job');
    });

    it('throws BudgetExceededError when submit returns budget exceeded', async function submitBudgetExceeded() {
      const { BudgetExceededError } = await import('@airo/ai-common');
      mockVideoApiFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        clone: () => ({
          text: async () => 'type budget_exceeded for model=sora-2',
        }),
      });

      const { generateSoraVideo } = await import('../video-generation.js');

      await expect(
        generateSoraVideo({
          prompt: 'Test',
          pollIntervalMs: 1,
          maxPollMs: 1000,
        })
      ).rejects.toSatisfy((error: unknown) => BudgetExceededError.isInstance(error));
    });

    it('throws BudgetExceededError when poll returns budget exceeded', async function pollBudgetExceeded() {
      const { BudgetExceededError } = await import('@airo/ai-common');
      mockVideoApiFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'vid-budget' }),
        })
        .mockResolvedValue({
          ok: false,
          status: 402,
          clone: () => ({
            text: async () => 'budget_exceeded',
          }),
        });

      const { generateSoraVideo } = await import('../video-generation.js');

      await expect(
        generateSoraVideo({
          prompt: 'Test',
          pollIntervalMs: 1,
          maxPollMs: 10,
        })
      ).rejects.toSatisfy((error: unknown) => BudgetExceededError.isInstance(error));
    });

    it('throws when poll returns a persistent HTTP error', async function pollHttpError() {
      mockVideoApiFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'vid-http-error' }),
        })
        .mockResolvedValue({
          ok: false,
          status: 500,
          clone: () => ({
            text: async () => 'internal server error',
          }),
        });

      const { generateSoraVideo } = await import('../video-generation.js');

      await expect(
        generateSoraVideo({
          prompt: 'Test',
          pollIntervalMs: 1,
          maxPollMs: 10,
        })
      ).rejects.toThrow('Failed to poll Sora video job');
    });

    it('throws when poll returns invalid JSON', async function pollInvalidJson() {
      mockVideoApiFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'vid-invalid-json' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => {
            throw new SyntaxError('Unexpected token < in JSON');
          },
        });

      const { generateSoraVideo } = await import('../video-generation.js');

      await expect(
        generateSoraVideo({
          prompt: 'Test',
          pollIntervalMs: 1,
          maxPollMs: 1000,
        })
      ).rejects.toThrow('Failed to parse Sora video poll response');
    });

    it('throws when generation fails', async function generationFailed() {
      mockVideoApiFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'vid-fail' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'failed' }),
        });

      const { generateSoraVideo } = await import('../video-generation.js');

      await expect(
        generateSoraVideo({
          prompt: 'Test',
          pollIntervalMs: 1,
          maxPollMs: 1000,
        })
      ).rejects.toThrow('Sora video generation failed');
    });

    it('passes grant billing headers to every Sora API call', async function billingHeaders() {
      mockVideoApiFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'vid-bill' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'completed' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => Buffer.from('video-bytes'),
        });

      const { generateSoraVideo } = await import('../video-generation.js');
      await generateSoraVideo({
        prompt: 'Billable video',
        pollIntervalMs: 1,
        maxPollMs: 1000,
        billing: { budgetUserId: 'budget-user-123' },
      });

      expect(mockVideoApiFetch).toHaveBeenCalledTimes(3);
      for (const call of mockVideoApiFetch.mock.calls) {
        expect(call[3]).toEqual({ budgetUserId: 'budget-user-123' });
      }
    });
  });
});
