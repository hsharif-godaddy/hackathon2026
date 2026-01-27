import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as process from 'node:process';

// Mock fs module
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// We need to reset modules between tests since getNomadAllocConfig is memoized
describe('nomad-config', function nomadConfigTests() {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('#getNomadAllocConfig', function getNomadAllocConfigTests() {
    it('should return null when config file does not exist', async function noFile() {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const { getNomadAllocConfig } = await import('../nomad-config.js');
      expect(getNomadAllocConfig()).toBeNull();
    });

    it('should return parsed config when file exists', async function validConfig() {
      const mockConfig = {
        DATABASE: { VALUE: { HOST: 'localhost' }, SYSTEM_MANAGED: true },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

      const { getNomadAllocConfig } = await import('../nomad-config.js');
      const result = getNomadAllocConfig();
      expect(result).toEqual(mockConfig);
    });

    it('should use NOMAD_ALLOC_DIR environment variable when set', async function customDir() {
      const originalEnv = process.env.NOMAD_ALLOC_DIR;
      process.env.NOMAD_ALLOC_DIR = '/custom/alloc';

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

      const { getNomadAllocConfig } = await import('../nomad-config.js');
      getNomadAllocConfig();

      expect(fs.existsSync).toHaveBeenCalledWith('/custom/alloc/config.json');

      // Restore
      if (originalEnv === undefined) {
        delete process.env.NOMAD_ALLOC_DIR;
      } else {
        process.env.NOMAD_ALLOC_DIR = originalEnv;
      }
    });

    it('should return null for invalid JSON', async function invalidJson() {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('{ invalid json }');

      const { getNomadAllocConfig } = await import('../nomad-config.js');
      expect(getNomadAllocConfig()).toBeNull();
    });

    it('should memoize results', async function memoize() {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ test: true }));

      const { getNomadAllocConfig } = await import('../nomad-config.js');

      // Call multiple times
      getNomadAllocConfig();
      getNomadAllocConfig();
      getNomadAllocConfig();

      // Should only read once
      expect(fs.readFileSync).toHaveBeenCalledTimes(1);
    });
  });
});
