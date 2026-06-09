import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// vi.hoisted makes the factory available when vi.mock() calls are hoisted to the top
const { mockLoggerFactory } = vi.hoisted(() => ({
  mockLoggerFactory: () => ({
    Logger: {
      create: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    },
  }),
}));

// Mock the logger to break circular dependency
vi.mock('../../logging/index.js', mockLoggerFactory);

describe('nomad-config', () => {
  let testDir: string;
  let originalNomadAllocDir: string | undefined;

  beforeEach(() => {
    // Create temp directory for test config files
    testDir = mkdtempSync(join(tmpdir(), 'nomad-config-test-'));

    // Store original env and set test directory
    originalNomadAllocDir = process.env.NOMAD_ALLOC_DIR;
    process.env.NOMAD_ALLOC_DIR = testDir;
  });

  afterEach(() => {
    // Restore original env
    if (originalNomadAllocDir !== undefined) {
      process.env.NOMAD_ALLOC_DIR = originalNomadAllocDir;
    } else {
      delete process.env.NOMAD_ALLOC_DIR;
    }

    // Clean up temp directory
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('getNomadAllocConfigValue', () => {
    it('should return value when key exists', async () => {
      vi.resetModules();
      vi.mock('../../logging/index.js', mockLoggerFactory);

      const configPath = join(testDir, 'config.json');
      const config = { PRODUCT_ID: { VALUE: 'my-product' } };
      writeFileSync(configPath, JSON.stringify(config));

      const { getNomadAllocConfigValue: getValue } = await import('../nomad-config.js');
      const result = getValue('PRODUCT_ID', 'default');

      expect(result).toBe('my-product');
    });

    it('should return default when key does not exist', async () => {
      vi.resetModules();
      vi.mock('../../logging/index.js', mockLoggerFactory);

      const configPath = join(testDir, 'config.json');
      const config = { OTHER_KEY: { VALUE: 'other-value' } };
      writeFileSync(configPath, JSON.stringify(config));

      const { getNomadAllocConfigValue: getValue } = await import('../nomad-config.js');
      const result = getValue('PRODUCT_ID', 'my-default');

      expect(result).toBe('my-default');
    });

    it('should return default when config file does not exist', async () => {
      vi.resetModules();
      vi.mock('../../logging/index.js', mockLoggerFactory);

      const { getNomadAllocConfigValue: getValue } = await import('../nomad-config.js');
      const result = getValue('PRODUCT_ID', 'fallback-value');

      expect(result).toBe('fallback-value');
    });

    it('should return default when VALUE is empty string (consistent with Go)', async () => {
      vi.resetModules();
      vi.mock('../../logging/index.js', mockLoggerFactory);

      const configPath = join(testDir, 'config.json');
      const config = { PRODUCT_ID: { VALUE: '' } };
      writeFileSync(configPath, JSON.stringify(config));

      const { getNomadAllocConfigValue: getValue } = await import('../nomad-config.js');
      const result = getValue('PRODUCT_ID', 'default-for-empty');

      // Empty strings are treated as missing (consistent with Go implementation)
      expect(result).toBe('default-for-empty');
    });

    it('should return default when key exists but VALUE property is missing', async () => {
      vi.resetModules();
      vi.mock('../../logging/index.js', mockLoggerFactory);

      const configPath = join(testDir, 'config.json');
      const config = { PRODUCT_ID: { OTHER_PROP: 'something' } };
      writeFileSync(configPath, JSON.stringify(config));

      const { getNomadAllocConfigValue: getValue } = await import('../nomad-config.js');
      const result = getValue('PRODUCT_ID', 'default-no-value');

      expect(result).toBe('default-no-value');
    });

    it('should return default when key exists but value is null', async () => {
      vi.resetModules();
      vi.mock('../../logging/index.js', mockLoggerFactory);

      const configPath = join(testDir, 'config.json');
      const config = { PRODUCT_ID: { VALUE: null } };
      writeFileSync(configPath, JSON.stringify(config));

      const { getNomadAllocConfigValue: getValue } = await import('../nomad-config.js');
      const result = getValue('PRODUCT_ID', 'default-for-null');

      expect(result).toBe('default-for-null');
    });

    it('should work with various key names', async () => {
      vi.resetModules();
      vi.mock('../../logging/index.js', mockLoggerFactory);

      const configPath = join(testDir, 'config.json');
      const config = {
        PRODUCT_ID: { VALUE: 'product-123' },
        DATABASE_URL: { VALUE: 'postgres://localhost' },
        API_KEY: { VALUE: 'secret-key' },
      };
      writeFileSync(configPath, JSON.stringify(config));

      const { getNomadAllocConfigValue: getValue } = await import('../nomad-config.js');
      expect(getValue('PRODUCT_ID', 'default')).toBe('product-123');
      expect(getValue('DATABASE_URL', 'default')).toBe('postgres://localhost');
      expect(getValue('API_KEY', 'default')).toBe('secret-key');
    });

    it('should handle special characters in VALUE', async () => {
      vi.resetModules();
      vi.mock('../../logging/index.js', mockLoggerFactory);

      const configPath = join(testDir, 'config.json');
      const config = {
        SPECIAL: { VALUE: 'value with spaces & special chars!@#$%' },
        UNICODE: { VALUE: 'Unicode: 日本語 中文 한국어' },
      };
      writeFileSync(configPath, JSON.stringify(config));

      const { getNomadAllocConfigValue: getValue } = await import('../nomad-config.js');
      expect(getValue('SPECIAL', 'default')).toBe('value with spaces & special chars!@#$%');
      expect(getValue('UNICODE', 'default')).toBe('Unicode: 日本語 中文 한국어');
    });
  });

  describe('getNomadAllocConfig', () => {
    it('should return null when config file does not exist', async () => {
      vi.resetModules();
      vi.mock('../../logging/index.js', mockLoggerFactory);

      const { getNomadAllocConfig: getConfig } = await import('../nomad-config.js');
      const result = getConfig();
      expect(result).toBeNull();
    });

    it('should return parsed config when file exists with valid JSON', async () => {
      vi.resetModules();
      vi.mock('../../logging/index.js', mockLoggerFactory);

      const configPath = join(testDir, 'config.json');
      const config = {
        PRODUCT_ID: { VALUE: 'test-product' },
        DATABASE: { VALUE: 'test-db' },
      };
      writeFileSync(configPath, JSON.stringify(config));

      const { getNomadAllocConfig: getConfig } = await import('../nomad-config.js');
      const result = getConfig();

      expect(result).not.toBeNull();
      expect(result?.PRODUCT_ID?.VALUE).toBe('test-product');
      expect(result?.DATABASE?.VALUE).toBe('test-db');
    });

    it('should return null for invalid JSON', async () => {
      vi.resetModules();
      vi.mock('../../logging/index.js', mockLoggerFactory);

      const configPath = join(testDir, 'config.json');
      writeFileSync(configPath, 'not valid json {{{');

      const { getNomadAllocConfig: getConfig } = await import('../nomad-config.js');
      const result = getConfig();

      expect(result).toBeNull();
    });

    it('should reject array JSON config', async () => {
      vi.resetModules();
      vi.mock('../../logging/index.js', mockLoggerFactory);

      const configPath = join(testDir, 'config.json');
      writeFileSync(configPath, '["not", "an", "object"]');

      const { getNomadAllocConfig: getConfig } = await import('../nomad-config.js');
      const result = getConfig();

      expect(result).toBeNull();
    });

    it('should return null for null JSON', async () => {
      vi.resetModules();
      vi.mock('../../logging/index.js', mockLoggerFactory);

      const configPath = join(testDir, 'config.json');
      writeFileSync(configPath, 'null');

      const { getNomadAllocConfig: getConfig } = await import('../nomad-config.js');
      const result = getConfig();

      expect(result).toBeNull();
    });

    it('should handle empty config object', async () => {
      vi.resetModules();
      vi.mock('../../logging/index.js', mockLoggerFactory);

      const configPath = join(testDir, 'config.json');
      writeFileSync(configPath, '{}');

      const { getNomadAllocConfig: getConfig } = await import('../nomad-config.js');
      const result = getConfig();

      expect(result).not.toBeNull();
      expect(result).toEqual({});
    });

    it('should memoize results on subsequent calls', async () => {
      vi.resetModules();
      vi.mock('../../logging/index.js', mockLoggerFactory);

      const configPath = join(testDir, 'config.json');
      const config = { PRODUCT_ID: { VALUE: 'memoized-value' } };
      writeFileSync(configPath, JSON.stringify(config));

      const { getNomadAllocConfig: getConfig } = await import('../nomad-config.js');
      const result1 = getConfig();
      const result2 = getConfig();

      expect(result1).toBe(result2); // Same reference (memoized)
      expect(result1?.PRODUCT_ID?.VALUE).toBe('memoized-value');
    });
  });

  describe('clearNomadConfigCache', () => {
    it('should force re-read from filesystem after cache is cleared', async () => {
      vi.resetModules();
      vi.mock('../../logging/index.js', mockLoggerFactory);

      const configPath = join(testDir, 'config.json');
      writeFileSync(configPath, JSON.stringify({ TOKEN: { VALUE: 'old-token' } }));

      const { getNomadAllocConfig: getConfig, clearNomadConfigCache: clearCache } =
        await import('../nomad-config.js');

      expect(getConfig()?.TOKEN?.VALUE).toBe('old-token');

      writeFileSync(configPath, JSON.stringify({ TOKEN: { VALUE: 'new-token' } }));

      // Still returns memoized value
      expect(getConfig()?.TOKEN?.VALUE).toBe('old-token');

      clearCache();

      // After clearing, re-reads from disk
      expect(getConfig()?.TOKEN?.VALUE).toBe('new-token');
    });
  });

  describe('Edge cases', () => {
    it('should handle whitespace-only VALUE', async () => {
      vi.resetModules();
      vi.mock('../../logging/index.js', mockLoggerFactory);

      const configPath = join(testDir, 'config.json');
      const config = { WHITESPACE: { VALUE: '   ' } };
      writeFileSync(configPath, JSON.stringify(config));

      const { getNomadAllocConfigValue: getValue } = await import('../nomad-config.js');
      const result = getValue('WHITESPACE', 'default');

      // Whitespace string is truthy, so it should be returned
      expect(result).toBe('   ');
    });

    it('should handle very long VALUE strings', async () => {
      vi.resetModules();
      vi.mock('../../logging/index.js', mockLoggerFactory);

      const configPath = join(testDir, 'config.json');
      const longValue = 'x'.repeat(10000);
      const config = { LONG_VALUE: { VALUE: longValue } };
      writeFileSync(configPath, JSON.stringify(config));

      const { getNomadAllocConfigValue: getValue } = await import('../nomad-config.js');
      const result = getValue('LONG_VALUE', 'default');

      expect(result).toBe(longValue);
      expect(result.length).toBe(10000);
    });

    it('should handle config directory not existing', async () => {
      vi.resetModules();
      vi.mock('../../logging/index.js', mockLoggerFactory);

      const nonExistentDir = join(testDir, 'non', 'existent', 'path');
      process.env.NOMAD_ALLOC_DIR = nonExistentDir;

      const { getNomadAllocConfigValue: getValue } = await import('../nomad-config.js');
      const result = getValue('KEY', 'default-for-missing-dir');

      expect(result).toBe('default-for-missing-dir');
    });

    it('should return empty string default if specified', async () => {
      vi.resetModules();
      vi.mock('../../logging/index.js', mockLoggerFactory);

      const { getNomadAllocConfigValue: getValue } = await import('../nomad-config.js');
      const result = getValue('NONEXISTENT', '');

      expect(result).toBe('');
    });

    it('should retry filesystem read after negative cache TTL expires', async () => {
      vi.resetModules();
      vi.useFakeTimers();
      vi.mock('../../logging/index.js', mockLoggerFactory);

      const { getNomadAllocConfig: getConfig } = await import('../nomad-config.js');

      // First call: file absent → negative cache set
      expect(getConfig()).toBeNull();

      // Write config while negative cache is still active
      const configPath = join(testDir, 'config.json');
      writeFileSync(configPath, JSON.stringify({ PRODUCT_ID: { VALUE: 'late-value' } }));

      // Still null within TTL window
      vi.advanceTimersByTime(4999);
      expect(getConfig()).toBeNull();

      // After TTL expires, config is picked up
      vi.advanceTimersByTime(1);
      expect(getConfig()?.PRODUCT_ID?.VALUE).toBe('late-value');

      vi.useRealTimers();
    });
  });
});
