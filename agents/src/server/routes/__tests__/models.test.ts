import type { IRouter, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ALLOWED_OVERRIDE_MODELS } from '../../constants.js';
import type { AuthenticatedRequest } from '../../middleware/jwt-auth.js';

const { getCanonicalModelKey, getModelInfo, isModelSupported, validateModelEnvironment } = vi.hoisted(
  function createAiLibMocks() {
    // Mirrors the alias subset of the real ALIASES table that appears in
    // ALLOWED_OVERRIDE_MODELS, so dedup-by-canonical-key behaves faithfully.
    const ALIAS_TO_CANONICAL: Record<string, string> = {
      'claude-sonnet-4-5-20250929': 'claude-sonnet-4-5',
      'claude-haiku-4-5-20251001': 'claude-haiku-4-5',
      sonnet: 'claude-sonnet-4-6',
      haiku: 'claude-haiku-4-5',
    };
    return {
      getCanonicalModelKey: vi.fn(function canonical(name: string) {
        const lower = name.trim().toLowerCase();
        return ALIAS_TO_CANONICAL[lower] ?? lower;
      }),
      getModelInfo: vi.fn(),
      isModelSupported: vi.fn(),
      validateModelEnvironment: vi.fn(),
    };
  }
);

vi.mock('@airo/ai-lib', function mockAiLib() {
  return {
    getCanonicalModelKey,
    getModelInfo,
    isModelSupported,
    validateModelEnvironment,
  };
});

/**
 * Recomputes the canonical-key dedup the route performs, so expectations stay
 * decoupled from the exact allowlist contents while remaining faithful.
 */
function expectedSurvivors(): string[] {
  const seen = new Set<string>();
  return [...ALLOWED_OVERRIDE_MODELS].filter((name) => {
    const lower = name.trim().toLowerCase();
    const key =
      ({
        'claude-sonnet-4-5-20250929': 'claude-sonnet-4-5',
        'claude-haiku-4-5-20251001': 'claude-haiku-4-5',
        sonnet: 'claude-sonnet-4-6',
        haiku: 'claude-haiku-4-5',
      } as Record<string, string>)[lower] ?? lower;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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
      const survivors = expectedSurvivors();
      expect(body.models).toHaveLength(survivors.length);
      expect(body.models.map((m) => m.shortName).sort()).toEqual(
        survivors.map((n) => `short-${n}`).sort()
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
      // The `sonnet`/`haiku` aliases collapse into their canonical models
      // (claude-sonnet-4-6 / claude-haiku-4-5) rather than being dropped by a
      // dedicated filter, so the surviving count is the deduped allowlist.
      expect(body.models).toHaveLength(expectedSurvivors().length);
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

    it('deduplicates aliases that resolve to the same canonical model', function deduplicates() {
      vi.mocked(isModelSupported).mockImplementation(function supported() {
        return true;
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
      const shortNames = body.models.map((m) => m.shortName);

      // claude-sonnet-4-5 and its date-pinned alias claude-sonnet-4-5-20250929
      // share a canonical key, so only the first (the friendly name) survives.
      expect(shortNames).toContain('claude-sonnet-4-5');
      expect(shortNames).not.toContain('claude-sonnet-4-5-20250929');
      // No canonical key appears twice.
      const canonicalKeys = shortNames.map((n) => getCanonicalModelKey(n));
      expect(canonicalKeys).toEqual([...new Set(canonicalKeys)]);
    });

    it('keeps Kimi variants with the same fullName but different shortNames', function keepsKimiVariants() {
      vi.mocked(isModelSupported).mockImplementation(function supported() {
        return true;
      });
      vi.mocked(validateModelEnvironment).mockImplementation(function envValid() {
        return true;
      });
      vi.mocked(getModelInfo).mockImplementation(function info(name: string) {
        if (name === 'azure/Kimi-K2.6' || name === 'azure/Kimi-K2.6-thinking') {
          return {
            shortName: name,
            fullName: 'azure/Kimi-K2.6',
            provider: 'openai' as const,
            isSupported: true,
            usingProxy: false,
          };
        }
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
      expect(body.models.some((m) => m.shortName === 'azure/Kimi-K2.6')).toBe(true);
      expect(body.models.some((m) => m.shortName === 'azure/Kimi-K2.6-thinking')).toBe(true);
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
