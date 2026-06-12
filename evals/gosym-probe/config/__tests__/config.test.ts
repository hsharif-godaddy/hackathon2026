import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, resolveCaptureConfig } from '../index.js';
import { createConfig as createLocalDev } from '../environments/local.dev.js';
import { CAPTURE_DEFAULTS } from '../resolve-eval-config.js';
import type { Config } from '../environments/types.js';

const ENV_VARS = [
  'GD_ENV',
  'OPENAI_BASE_URL',
  'PROBE_OPENAI_API_KEY',
  'GOCODE_USE_S2S_AUTH',
  'OPENAI_MODEL',
  'MAX_CONCURRENCY',
  'MAX_TURNS',
  'CAPTURE_CONCURRENCY',
  'MAX_CAPTURE_CONCURRENCY',
  'MAX_ROUTES',
] as const;

type EnvKey = (typeof ENV_VARS)[number];

describe('loadConfig', () => {
  const saved: Partial<Record<EnvKey, string | undefined>> = {};

  beforeEach(() => {
    for (const key of ENV_VARS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_VARS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  describe('environment selection', () => {
    it('defaults to local.dev when GD_ENV is unset', () => {
      expect(loadConfig().env).toBe('local.dev');
    });

    it('returns local.dev config', () => {
      process.env.GD_ENV = 'local.dev';
      expect(loadConfig().env).toBe('local.dev');
    });

    it('returns local.test config', () => {
      process.env.GD_ENV = 'local.test';
      expect(loadConfig().env).toBe('local.test');
    });

    it('returns local.prod config', () => {
      process.env.GD_ENV = 'local.prod';
      expect(loadConfig().env).toBe('local.prod');
    });

    it('throws on unknown GD_ENV', () => {
      process.env.GD_ENV = 'staging';
      expect(() => loadConfig()).toThrow('Unknown GD_ENV: "staging"');
    });
  });

  describe('config shape', () => {
    it('aab.socketUrl is a valid URL', () => {
      expect(() => new URL(loadConfig().aab.socketUrl)).not.toThrow();
    });

    it('aab.bffUrl is a valid URL', () => {
      expect(() => new URL(loadConfig().aab.bffUrl)).not.toThrow();
    });

    it('reads gocode.baseUrl from OPENAI_BASE_URL', () => {
      process.env.OPENAI_BASE_URL = 'https://gocode.example.com/v1';
      expect(loadConfig().gocode.baseUrl).toBe(
        'https://gocode.example.com/v1',
      );
    });

    it('reads gocode.apiKey from PROBE_OPENAI_API_KEY', () => {
      process.env.PROBE_OPENAI_API_KEY = 'sk-test-123';
      expect(loadConfig().gocode.apiKey).toBe('sk-test-123');
    });

    it('defaults gocode.baseUrl to empty string when unset', () => {
      expect(loadConfig().gocode.baseUrl).toBe('');
    });

    it('defaults gocode.apiKey to empty string when unset', () => {
      expect(loadConfig().gocode.apiKey).toBe('');
    });

    it('reads gocode.useS2S from GOCODE_USE_S2S_AUTH=true', () => {
      process.env.GOCODE_USE_S2S_AUTH = 'true';
      expect(loadConfig().gocode.useS2S).toBe(true);
    });

    it('defaults gocode.useS2S to false when GOCODE_USE_S2S_AUTH is unset', () => {
      expect(loadConfig().gocode.useS2S).toBe(false);
    });

    it('gocode.useS2S is false for any value other than "true"', () => {
      process.env.GOCODE_USE_S2S_AUTH = '1';
      expect(loadConfig().gocode.useS2S).toBe(false);
    });

    it('reads gocode.model from OPENAI_MODEL', () => {
      process.env.OPENAI_MODEL = 'claude-sonnet-4-6';
      expect(loadConfig().gocode.model).toBe('claude-sonnet-4-6');
    });

    it('defaults gocode.model to empty string when unset', () => {
      expect(loadConfig().gocode.model).toBe('');
    });

    it('reads eval.maxConcurrency from MAX_CONCURRENCY', () => {
      process.env.MAX_CONCURRENCY = '8';
      expect(loadConfig().eval.maxConcurrency).toBe(8);
    });

    it('reads eval.maxTurns from MAX_TURNS', () => {
      process.env.MAX_TURNS = '10';
      expect(loadConfig().eval.maxTurns).toBe(10);
    });

    it('eval.defaultTrials is a positive integer', () => {
      const { defaultTrials } = loadConfig().eval;
      expect(defaultTrials).toBeGreaterThan(0);
      expect(Number.isInteger(defaultTrials)).toBe(true);
    });

    it('eval.maxTurns is a positive integer', () => {
      const { maxTurns } = loadConfig().eval;
      expect(maxTurns).toBeGreaterThan(0);
      expect(Number.isInteger(maxTurns)).toBe(true);
    });

    it('regression.fallbackThresholds.defaultThreshold is between 0 and 1', () => {
      const { defaultThreshold } = loadConfig().regression.fallbackThresholds;
      expect(defaultThreshold).toBeGreaterThan(0);
      expect(defaultThreshold).toBeLessThanOrEqual(1);
    });

    it('regression.fallbackThresholds.thresholds is an object', () => {
      expect(loadConfig().regression.fallbackThresholds.thresholds).toBeTypeOf('object');
    });

    it('playwright.ignoreHttpsErrors is a boolean', () => {
      expect(
        loadConfig().playwright.ignoreHttpsErrors,
      ).toBeTypeOf('boolean');
    });
  });

  describe('capture config', () => {
    it('resolves capture defaults when unconfigured', () => {
      const { capture } = loadConfig();
      expect(capture).toEqual({
        concurrency: 2,
        maxConcurrency: 8,
        maxRoutes: 20,
        viewports: ['mobile', 'laptop'],
        gotoTimeoutMs: 30_000,
        appReadyTimeoutMs: 15_000,
      });
    });

    it('reads capture.concurrency from CAPTURE_CONCURRENCY', () => {
      process.env.CAPTURE_CONCURRENCY = '4';
      expect(loadConfig().capture.concurrency).toBe(4);
    });

    it('reads capture.maxRoutes from MAX_ROUTES', () => {
      process.env.MAX_ROUTES = '5';
      expect(loadConfig().capture.maxRoutes).toBe(5);
    });

    it('ignores a non-numeric CAPTURE_CONCURRENCY and keeps the default', () => {
      process.env.CAPTURE_CONCURRENCY = 'abc';
      expect(loadConfig().capture.concurrency).toBe(2);
    });

    it('ignores a zero MAX_ROUTES and keeps the default', () => {
      process.env.MAX_ROUTES = '0';
      expect(loadConfig().capture.maxRoutes).toBe(20);
    });

    it('decouples capture.concurrency from eval.maxConcurrency', () => {
      process.env.MAX_CONCURRENCY = '8';
      process.env.CAPTURE_CONCURRENCY = '2';
      const config = loadConfig();
      expect(config.eval.maxConcurrency).toBe(8);
      expect(config.capture.concurrency).toBe(2);
    });

    it('defaults capture.maxConcurrency to 8', () => {
      expect(loadConfig().capture.maxConcurrency).toBe(8);
    });

    it('reads capture.maxConcurrency from MAX_CAPTURE_CONCURRENCY', () => {
      process.env.MAX_CAPTURE_CONCURRENCY = '16';
      expect(loadConfig().capture.maxConcurrency).toBe(16);
    });

    it('ignores a non-numeric MAX_CAPTURE_CONCURRENCY and keeps the default', () => {
      process.env.MAX_CAPTURE_CONCURRENCY = 'abc';
      expect(loadConfig().capture.maxConcurrency).toBe(8);
    });

    it('resolves the ceiling independently of the requested concurrency', () => {
      process.env.CAPTURE_CONCURRENCY = '4';
      process.env.MAX_CAPTURE_CONCURRENCY = '6';
      const config = loadConfig();
      expect(config.capture.concurrency).toBe(4);
      expect(config.capture.maxConcurrency).toBe(6);
    });
  });

  describe('resolveCaptureConfig', () => {
    const withCapture = (capture: Config['capture']): Config => ({
      ...createLocalDev(),
      capture,
    });

    it('honors a non-empty viewports override', () => {
      const resolved = resolveCaptureConfig(withCapture({ viewports: ['mobile'] }));
      expect(resolved.viewports).toEqual(['mobile']);
    });

    it('falls back to default viewports when override is an empty array', () => {
      const resolved = resolveCaptureConfig(withCapture({ viewports: [] }));
      expect(resolved.viewports).toEqual(CAPTURE_DEFAULTS.viewports);
    });

    it('falls back to default viewports when capture block is absent', () => {
      const resolved = resolveCaptureConfig(withCapture(undefined));
      expect(resolved.viewports).toEqual(CAPTURE_DEFAULTS.viewports);
    });
  });

  describe('per-environment values', () => {
    it('local.dev has maxTurns=10', () => {
      process.env.GD_ENV = 'local.dev';
      expect(loadConfig().eval.maxTurns).toBe(10);
    });

    it('local.test has maxTurns=10', () => {
      process.env.GD_ENV = 'local.test';
      expect(loadConfig().eval.maxTurns).toBe(10);
    });

    it('local.prod has maxTurns=10', () => {
      process.env.GD_ENV = 'local.prod';
      expect(loadConfig().eval.maxTurns).toBe(10);
    });

    it('local.prod ignores https errors in playwright', () => {
      process.env.GD_ENV = 'local.prod';
      expect(loadConfig().playwright.ignoreHttpsErrors).toBe(true);
    });
  });
});
