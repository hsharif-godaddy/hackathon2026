import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockFindByAppAndPlatform = vi.fn();
const mockMetadataGet = vi.fn();

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
      findByAppAndPlatform(...args: unknown[]) {
        return mockFindByAppAndPlatform(...args);
      }
    },
  };
});

vi.mock('../../../../database/repositories/AppMetadataRepository.js', () => {
  return {
    AppMetadataRepository: class {
      get(...args: unknown[]) {
        return mockMetadataGet(...args);
      }
    },
  };
});

import { checkGscConnectionTool } from '../index.js';

function runCheckGscConnection(context?: Record<string, unknown>) {
  return checkGscConnectionTool.execute({}, context);
}

describe('google-search-console tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindByAppAndPlatform.mockReset();
    mockMetadataGet.mockReset();
    mockMetadataGet.mockReturnValue({});
  });

  describe('#checkGscConnectionTool', () => {
    describe('execute', () => {
      it('returns error when appId is missing', async () => {
        const result = await runCheckGscConnection({ metadata: {} });

        expect(result).toMatchObject({
          success: false,
          error: 'App ID is required',
          recoverable: false,
        });
      });

      it('returns requiresConnection when no GSC association and no pending token', async () => {
        mockFindByAppAndPlatform.mockReturnValue([]);
        mockMetadataGet.mockReturnValue({});

        const result = await runCheckGscConnection({
          metadata: { appId: 'test-app-123' },
        });

        expect(result).toMatchObject({
          action: 'requiresConnection',
          success: false,
          workflowPending: true,
        });
        expect(result.message).toContain('social-platform__socialConnect');
        expect(result.message).toContain('GOOGLE_SEARCH_CONSOLE');
      });

      it('returns pendingVerification when tag is injected but association not yet created', async () => {
        mockFindByAppAndPlatform.mockReturnValue([]);
        mockMetadataGet.mockReturnValue({ googleVerificationToken: 'abc123-token' });

        const result = await runCheckGscConnection({
          metadata: { appId: 'test-app-pending' },
        });

        expect(result).toMatchObject({
          action: 'pendingVerification',
          success: false,
          workflowPending: true,
        });
        expect(result.message).toContain('chat widget');
      });

      it('does not return pendingVerification when token is empty string', async () => {
        mockFindByAppAndPlatform.mockReturnValue([]);
        mockMetadataGet.mockReturnValue({ googleVerificationToken: '' });

        const result = await runCheckGscConnection({
          metadata: { appId: 'test-app-empty' },
        });

        expect(result).toMatchObject({ action: 'requiresConnection' });
      });

      it('returns connected when GSC association exists', async () => {
        mockFindByAppAndPlatform.mockReturnValue([
          { socialId: 'gsc-social-456' },
        ]);

        const result = await runCheckGscConnection({
          metadata: { appId: 'test-app-456' },
        });

        expect(result).toMatchObject({
          connected: true,
          success: true,
          socialId: 'gsc-social-456',
        });
      });

      it('returns connected without reading metadata when association exists', async () => {
        mockFindByAppAndPlatform.mockReturnValue([{ socialId: 'gsc-123' }]);

        await runCheckGscConnection({ metadata: { appId: 'test-app' } });

        expect(mockMetadataGet).not.toHaveBeenCalled();
      });

      it('returns error on repository exception', async () => {
        mockFindByAppAndPlatform.mockImplementation(() => {
          throw new Error('Database connection failed');
        });

        const result = await runCheckGscConnection({
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
        const state = checkGscConnectionTool.computeState?.(
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

      it('returns pending-verification state when tag injected but not verified', () => {
        const state = checkGscConnectionTool.computeState?.(
          {},
          { action: 'pendingVerification', workflowPending: true, success: false, message: 'tag injected' }
        );

        expect(state).toMatchObject({
          workflowState: 'pending-verification',
          nextStep: 'guide-verify-in-chat',
          lastError: null,
        });
        expect(state?.updatedAt).toBeDefined();
      });

      it('returns pending-gsc-connection state when OAuth needed', () => {
        const state = checkGscConnectionTool.computeState?.(
          {},
          { action: 'requiresConnection', workflowPending: true, success: false, message: 'no connection' }
        );

        expect(state).toMatchObject({
          workflowState: 'pending-gsc-connection',
          nextStep: 'guide-publish-and-verify',
          lastError: null,
        });
        expect(state?.updatedAt).toBeDefined();
      });

      it('returns connected state with socialId', () => {
        const state = checkGscConnectionTool.computeState?.(
          {},
          { connected: true, socialId: 'gsc-789', success: true }
        );

        expect(state).toMatchObject({
          workflowState: 'connected',
          socialId: 'gsc-789',
          nextStep: 'inform-user',
          lastError: null,
        });
        expect(state?.updatedAt).toBeDefined();
      });

      it('returns null for unexpected output', () => {
        const state = checkGscConnectionTool.computeState?.(
          {},
          { unexpected: 'output' }
        );

        expect(state).toBeNull();
      });

      it('clears lastError on successful connection', () => {
        const state = checkGscConnectionTool.computeState?.(
          {},
          { connected: true, socialId: 'gsc-123', success: true }
        );

        expect(state?.lastError).toBeNull();
      });

      it('clears lastError when OAuth initiated', () => {
        const state = checkGscConnectionTool.computeState?.(
          {},
          { action: 'requiresConnection', workflowPending: true, success: false, message: '' }
        );

        expect(state?.lastError).toBeNull();
      });
    });

    describe('parameter schema validation', () => {
      it('accepts empty parameters object', () => {
        expect(() => checkGscConnectionTool.parameters.parse({})).not.toThrow();
      });
    });
  });
});
