import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock must be declared before the vi.mock() call to avoid hoisting issues
const mockFindByAppAndPlatform = vi.fn();

vi.mock('../../../../logging/index.js', () => {
  const instance = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => instance,
  };
  return {
    logger: instance,
    Logger: { create: () => instance },
  };
});

vi.mock('../../../../database/repositories/SocialAssociationRepository.js', () => {
  return {
    SocialAssociationRepository: class {
      // Use function to avoid TDZ error - captures mockFindByAppAndPlatform at construction time
      findByAppAndPlatform(...args: unknown[]) {
        return mockFindByAppAndPlatform(...args);
      }
    },
  };
});

import { checkConnectionTool } from '../check-connection.js';

function runCheckConnection(context?: Record<string, unknown>) {
  return checkConnectionTool.execute({}, context);
}

describe('google-business-profile checkConnection tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindByAppAndPlatform.mockReset();
  });

  describe('execute', () => {
    it('returns error when appId is missing', async () => {
      const result = await runCheckConnection({ metadata: {} });

      expect(result).toMatchObject({
        success: false,
        error: 'App ID is required',
        recoverable: false,
      });
    });

    it('returns requiresConnection when no GBP associations found', async () => {
      mockFindByAppAndPlatform.mockReturnValue([]);

      const result = await runCheckConnection({
        metadata: { appId: 'test-app-123' },
      });

      expect(result).toMatchObject({
        action: 'requiresConnection',
        success: false,
        workflowPending: true,
      });
      expect(result.message).toContain('social-platform__socialConnect');
      expect(result.message).toContain('GOOGLE_BUSINESS_PROFILE');
    });

    it('returns connected when GBP association exists', async () => {
      mockFindByAppAndPlatform.mockReturnValue([{ socialId: 'gbp-123' }]);

      const result = await runCheckConnection({
        metadata: { appId: 'test-app-456' },
      });

      expect(result).toMatchObject({
        connected: true,
        success: true,
        socialId: 'gbp-123',
        locationCount: 1,
      });
    });

    it('queries for the GOOGLE_BUSINESS_PROFILE platform', async () => {
      mockFindByAppAndPlatform.mockReturnValue([{ socialId: 'gbp-123' }]);

      await runCheckConnection({ metadata: { appId: 'test-app' } });

      expect(mockFindByAppAndPlatform).toHaveBeenCalledWith(
        'test-app',
        'GOOGLE_BUSINESS_PROFILE'
      );
    });

    it('returns first association when multiple locations exist', async () => {
      mockFindByAppAndPlatform.mockReturnValue([
        { socialId: 'gbp-first' },
        { socialId: 'gbp-second' },
        { socialId: 'gbp-third' },
      ]);

      const result = await runCheckConnection({
        metadata: { appId: 'test-app' },
      });

      expect(result).toMatchObject({
        connected: true,
        socialId: 'gbp-first',
        locationCount: 3,
      });
    });

    it('returns error on repository exception', async () => {
      mockFindByAppAndPlatform.mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      const result = await runCheckConnection({
        metadata: { appId: 'test-app' },
      });

      expect(result).toMatchObject({
        success: false,
        error: 'Database connection failed',
        recoverable: true,
      });
    });
  });

  describe('computeState', () => {
    it('returns error state when output has error', () => {
      const state = checkConnectionTool.computeState?.(
        {},
        { error: 'Network timeout', recoverable: true }
      );

      expect(state).toMatchObject({
        workflowState: 'connection-check-failed',
        lastError: 'Network timeout',
        nextStep: 'retry-connection-check',
      });
      expect(state?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('returns pending state when OAuth needed', () => {
      const state = checkConnectionTool.computeState?.(
        {},
        { action: 'requiresConnection', workflowPending: true }
      );

      expect(state).toMatchObject({
        workflowState: 'pending-gbp-connection',
        nextStep: 'check-connection',
        lastError: null,
      });
      expect(state?.updatedAt).toBeDefined();
    });

    it('returns connected state with socialId', () => {
      const state = checkConnectionTool.computeState?.(
        {},
        { connected: true, socialId: 'gbp-789', locationCount: 2 }
      );

      expect(state).toMatchObject({
        workflowState: 'connected',
        socialId: 'gbp-789',
        locationCount: 2,
        nextStep: 'sync-flow',
        lastError: null,
      });
      expect(state?.updatedAt).toBeDefined();
    });

    it('returns null for unexpected output', () => {
      const state = checkConnectionTool.computeState?.(
        {},
        { unexpected: 'output' }
      );

      expect(state).toBeNull();
    });

    it('clears lastError on successful connection', () => {
      const state = checkConnectionTool.computeState?.(
        {},
        { connected: true, socialId: 'gbp-123', locationCount: 1 }
      );

      expect(state?.lastError).toBeNull();
    });

    it('clears lastError when OAuth initiated', () => {
      const state = checkConnectionTool.computeState?.(
        {},
        { workflowPending: true }
      );

      expect(state?.lastError).toBeNull();
    });
  });

  describe('parameter schema validation', () => {
    it('accepts empty parameters object', () => {
      expect(() => checkConnectionTool.parameters.parse({})).not.toThrow();
    });

    it('accepts and ignores extra parameters (passthrough)', () => {
      const result = checkConnectionTool.parameters.parse({ extra: 'param' });
      expect(result).toBeDefined();
    });
  });
});
