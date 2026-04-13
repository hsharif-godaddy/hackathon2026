import type { IRouter, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ALLOWED_OVERRIDE_MODELS } from '../../constants.js';
import type { AuthenticatedRequest } from '../../middleware/jwt-auth.js';

const { getModelInfo, isModelSupported, validateModelEnvironment } = vi.hoisted(function createAiLibMocks() {
  return {
    getModelInfo: vi.fn(),
    isModelSupported: vi.fn(),
    validateModelEnvironment: vi.fn(),
  };
});

vi.mock('@airo/ai-lib', function mockAiLib() {
  return {
    getModelInfo,
    isModelSupported,
    validateModelEnvironment,
  };
});

import modelsRouter from '../models.js';

function getGetModelsHandler(router: IRouter) {
  for (const layer of router.stack) {
    if (layer.route?.path === '/models' && layer.route.methods.get) {
      return layer.route.stack[0].handle as (
        req: AuthenticatedRequest,
        res: Response
      ) => void;
    }
  }
  throw new Error('GET /models handler not found');
}

function createMockRes() {
  const state = { status: 200, body: undefined as unknown };
  return {
    status(code: number) {
      state.status = code;
      return this;
    },
    json(payload: unknown) {
      state.body = payload;
    },
    getStatus() {
      return state.status;
    },
    getBody() {
      return state.body;
    },
  };
}

describe('@airo/agents', function packageTests() {
  describe('#getModels', function getModelsTests() {
    const handler = getGetModelsHandler(modelsRouter);

    beforeEach(function resetMocks() {
      getModelInfo.mockReset();
      isModelSupported.mockReset();
      validateModelEnvironment.mockReset();
    });

    it('returns 403 when modelSelectorEnabled is false', function returns403WhenDisabled() {
      const req = {
        agentContext: { modelSelectorEnabled: false },
      } as AuthenticatedRequest;
      const res = createMockRes();

      handler(req, res as Response);

      expect(res.getStatus()).toBe(403);
      expect(res.getBody()).toEqual({ error: 'Model selection is not enabled' });
    });

    it('returns 403 when modelSelectorEnabled is undefined', function returns403WhenUndefined() {
      const req = { agentContext: {} } as AuthenticatedRequest;
      const res = createMockRes();

      handler(req, res as Response);

      expect(res.getStatus()).toBe(403);
      expect(res.getBody()).toEqual({ error: 'Model selection is not enabled' });
    });

    it('returns model list when modelSelectorEnabled is true', function returnsModelsWhenEnabled() {
      vi.mocked(isModelSupported).mockImplementation(function supported() {
        return true;
      });
      vi.mocked(validateModelEnvironment).mockImplementation(function envValid() {
        return true;
      });
      vi.mocked(getModelInfo).mockImplementation(function info(name: string) {
        return {
          shortName: `short-${name}`,
          fullName: name,
          provider: 'anthropic' as const,
          isSupported: true,
          usingProxy: false,
        };
      });

      const req = {
        agentContext: { modelSelectorEnabled: true },
      } as AuthenticatedRequest;
      const res = createMockRes();

      handler(req, res as Response);

      expect(res.getStatus()).toBe(200);
      const body = res.getBody() as { models: { shortName: string }[] };
      expect(body.models).toBeInstanceOf(Array);
      expect(body.models).toHaveLength(ALLOWED_OVERRIDE_MODELS.size);
      expect(body.models.map((m) => m.shortName).sort()).toEqual(
        [...ALLOWED_OVERRIDE_MODELS].map((n) => `short-${n}`).sort()
      );
    });

    it('filters out alias shortNames sonnet and haiku', function filtersAliases() {
      vi.mocked(isModelSupported).mockImplementation(function supported() {
        return true;
      });
      vi.mocked(validateModelEnvironment).mockImplementation(function envValid() {
        return true;
      });
      vi.mocked(getModelInfo).mockImplementation(function info(name: string) {
        if (name === 'sonnet') {
          return {
            shortName: 'sonnet',
            fullName: 'x',
            provider: 'anthropic' as const,
            isSupported: true,
            usingProxy: false,
          };
        }
        if (name === 'haiku') {
          return {
            shortName: 'haiku',
            fullName: 'y',
            provider: 'anthropic' as const,
            isSupported: true,
            usingProxy: false,
          };
        }
        return {
          shortName: `short-${name}`,
          fullName: name,
          provider: 'anthropic' as const,
          isSupported: true,
          usingProxy: false,
        };
      });

      const req = {
        agentContext: { modelSelectorEnabled: true },
      } as AuthenticatedRequest;
      const res = createMockRes();

      handler(req, res as Response);

      const body = res.getBody() as { models: { shortName: string }[] };
      expect(body.models.some((m) => m.shortName === 'sonnet')).toBe(false);
      expect(body.models.some((m) => m.shortName === 'haiku')).toBe(false);
      expect(body.models).toHaveLength(ALLOWED_OVERRIDE_MODELS.size - 2);
    });

    it('only includes models for which isModelSupported returns true', function filtersUnsupported() {
      vi.mocked(isModelSupported).mockImplementation(function supported(name: string) {
        return name === 'claude-sonnet-4-6';
      });
      vi.mocked(validateModelEnvironment).mockImplementation(function envValid() {
        return true;
      });
      vi.mocked(getModelInfo).mockImplementation(function info(name: string) {
        return {
          shortName: name,
          fullName: name,
          provider: 'anthropic' as const,
          isSupported: true,
          usingProxy: false,
        };
      });

      const req = {
        agentContext: { modelSelectorEnabled: true },
      } as AuthenticatedRequest;
      const res = createMockRes();

      handler(req, res as Response);

      const body = res.getBody() as { models: { shortName: string }[] };
      expect(body.models).toHaveLength(1);
      expect(body.models[0].shortName).toBe('claude-sonnet-4-6');
    });

    it('deduplicates models that resolve to the same fullName', function deduplicates() {
      vi.mocked(isModelSupported).mockImplementation(function supported() {
        return true;
      });
      vi.mocked(validateModelEnvironment).mockImplementation(function envValid() {
        return true;
      });
      vi.mocked(getModelInfo).mockImplementation(function info(name: string) {
        const resolved = name === 'claude-sonnet-4-5' ? 'claude-sonnet-4-5-20250929' : name;
        return {
          shortName: resolved,
          fullName: resolved,
          provider: 'anthropic' as const,
          isSupported: true,
          usingProxy: false,
        };
      });

      const req = {
        agentContext: { modelSelectorEnabled: true },
      } as AuthenticatedRequest;
      const res = createMockRes();

      handler(req, res as Response);

      const body = res.getBody() as { models: { fullName: string }[] };
      const fullNames = body.models.map((m) => m.fullName);
      const uniqueFullNames = [...new Set(fullNames)];
      expect(fullNames).toEqual(uniqueFullNames);
    });

    it('excludes models whose provider environment is not configured', function filtersUnavailableProviders() {
      vi.mocked(isModelSupported).mockImplementation(function supported() {
        return true;
      });
      vi.mocked(validateModelEnvironment).mockImplementation(function envValid(name: string) {
        return name === 'claude-sonnet-4-6';
      });
      vi.mocked(getModelInfo).mockImplementation(function info(name: string) {
        return {
          shortName: name,
          fullName: name,
          provider: 'anthropic' as const,
          isSupported: true,
          usingProxy: false,
        };
      });

      const req = {
        agentContext: { modelSelectorEnabled: true },
      } as AuthenticatedRequest;
      const res = createMockRes();

      handler(req, res as Response);

      const body = res.getBody() as { models: { shortName: string }[] };
      expect(body.models).toHaveLength(1);
      expect(body.models[0].shortName).toBe('claude-sonnet-4-6');
    });
  });
});
