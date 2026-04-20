import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DefaultPublishStrategy } from '../DefaultPublishStrategy.js';
import type { PublishRequest, PublishResponse } from '../../../../../services/DevSupervisorClient.js';

describe('DefaultPublishStrategy', () => {
  let strategy: DefaultPublishStrategy;

  beforeEach(() => {
    strategy = new DefaultPublishStrategy();
  });

  describe('key property', () => {
    it('should have key "default"', () => {
      expect(strategy.key).toBe('default');
    });
  });

  describe('deploy', () => {
    it('should call publishSupervisor.publish and return its response', async () => {
      const mockPublishSupervisor = {
        publish: vi.fn(),
      };

      const mockLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const request: PublishRequest = {
        commitHash: 'abc1234567890',
        force: false,
        waitForHealthy: true,
        healthTimeoutSeconds: 120,
      };

      const expectedResponse: PublishResponse = {
        status: 'success',
        version: 'abc1234567890',
        healthStatus: 'healthy',
      };

      mockPublishSupervisor.publish.mockResolvedValue(expectedResponse);

      const result = await strategy.deploy(
        mockPublishSupervisor as any,
        request,
        mockLogger as any
      );

      expect(mockPublishSupervisor.publish).toHaveBeenCalledWith(request);
      expect(mockPublishSupervisor.publish).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expectedResponse);
    });
  });
});
