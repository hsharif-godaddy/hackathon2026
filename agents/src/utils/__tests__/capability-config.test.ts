import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';

// Mock fs module
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// We need to reset modules between tests since getNomadAllocConfig is memoized
describe('capability-config', function capabilityConfigTests() {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('#isCapabilityEnabled', function isCapabilityEnabledTests() {
    it('should return true for existing capability (exact case)', async function exactCase() {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          CAPABILITIES: {
            VALUE: ['GIT_REMOTE_SYNC', 'COMMERCE_API_READ'],
            SYSTEM_MANAGED: true,
          },
        })
      );

      const { isCapabilityEnabled } = await import('../capability-config.js');
      expect(isCapabilityEnabled('GIT_REMOTE_SYNC')).toBe(true);
    });

    it('should return true for existing capability (case-insensitive)', async function caseInsensitive() {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          CAPABILITIES: {
            VALUE: ['GIT_REMOTE_SYNC', 'COMMERCE_API_READ'],
            SYSTEM_MANAGED: true,
          },
        })
      );

      const { isCapabilityEnabled } = await import('../capability-config.js');
      expect(isCapabilityEnabled('git_remote_sync')).toBe(true);
      expect(isCapabilityEnabled('Git_Remote_Sync')).toBe(true);
      expect(isCapabilityEnabled('gIt_ReMoTe_SyNc')).toBe(true);
    });

    it('should return false for non-existing capability', async function nonExisting() {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          CAPABILITIES: {
            VALUE: ['GIT_REMOTE_SYNC'],
            SYSTEM_MANAGED: true,
          },
        })
      );

      const { isCapabilityEnabled } = await import('../capability-config.js');
      expect(isCapabilityEnabled('COMMERCE_API_READ')).toBe(false);
      expect(isCapabilityEnabled('NON_EXISTENT')).toBe(false);
    });

    it('should return false when config file does not exist', async function noConfigFile() {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const { isCapabilityEnabled } = await import('../capability-config.js');
      expect(isCapabilityEnabled('GIT_REMOTE_SYNC')).toBe(false);
    });

    it('should return false when CAPABILITIES key is missing', async function noCapabilitiesKey() {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          DATABASE: { VALUE: {}, SYSTEM_MANAGED: true },
        })
      );

      const { isCapabilityEnabled } = await import('../capability-config.js');
      expect(isCapabilityEnabled('GIT_REMOTE_SYNC')).toBe(false);
    });

    it('should return false when CAPABILITIES.VALUE is not an array', async function notAnArray() {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          CAPABILITIES: {
            VALUE: 'not-an-array',
            SYSTEM_MANAGED: true,
          },
        })
      );

      const { isCapabilityEnabled } = await import('../capability-config.js');
      expect(isCapabilityEnabled('GIT_REMOTE_SYNC')).toBe(false);
    });

    it('should return false when CAPABILITIES.VALUE is null', async function nullValue() {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          CAPABILITIES: {
            VALUE: null,
            SYSTEM_MANAGED: true,
          },
        })
      );

      const { isCapabilityEnabled } = await import('../capability-config.js');
      expect(isCapabilityEnabled('GIT_REMOTE_SYNC')).toBe(false);
    });

    it('should return false when capabilities array is empty', async function emptyArray() {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          CAPABILITIES: {
            VALUE: [],
            SYSTEM_MANAGED: true,
          },
        })
      );

      const { isCapabilityEnabled } = await import('../capability-config.js');
      expect(isCapabilityEnabled('GIT_REMOTE_SYNC')).toBe(false);
    });

    it('should skip non-string items in capabilities array', async function nonStringItems() {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          CAPABILITIES: {
            VALUE: [123, null, undefined, { key: 'value' }, 'GIT_REMOTE_SYNC', true],
            SYSTEM_MANAGED: true,
          },
        })
      );

      const { isCapabilityEnabled } = await import('../capability-config.js');
      expect(isCapabilityEnabled('GIT_REMOTE_SYNC')).toBe(true);
      expect(isCapabilityEnabled('123')).toBe(false); // number 123 should not match string '123'
    });

    it('should return false for empty string capability input', async function emptyStringInput() {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          CAPABILITIES: {
            VALUE: ['GIT_REMOTE_SYNC', ''],
            SYSTEM_MANAGED: true,
          },
        })
      );

      const { isCapabilityEnabled } = await import('../capability-config.js');
      // Empty string matches empty string in array
      expect(isCapabilityEnabled('')).toBe(true);
    });

    it('should handle whitespace in capability names', async function whitespace() {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          CAPABILITIES: {
            VALUE: ['GIT_REMOTE_SYNC', ' SPACED_CAP '],
            SYSTEM_MANAGED: true,
          },
        })
      );

      const { isCapabilityEnabled } = await import('../capability-config.js');
      // Whitespace is preserved - exact match required (after case normalization)
      expect(isCapabilityEnabled(' SPACED_CAP ')).toBe(true);
      expect(isCapabilityEnabled('SPACED_CAP')).toBe(false);
    });

    it('should return false for null or undefined capability input', async function nullUndefinedInput() {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          CAPABILITIES: {
            VALUE: ['GIT_REMOTE_SYNC'],
            SYSTEM_MANAGED: true,
          },
        })
      );

      const { isCapabilityEnabled } = await import('../capability-config.js');
      // TypeScript would catch this, but runtime safety is important
      expect(isCapabilityEnabled(null as unknown as string)).toBe(false);
      expect(isCapabilityEnabled(undefined as unknown as string)).toBe(false);
    });

    it('should return false when config file has invalid JSON', async function invalidJson() {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('not valid json');

      const { isCapabilityEnabled } = await import('../capability-config.js');
      expect(isCapabilityEnabled('GIT_REMOTE_SYNC')).toBe(false);
    });

    it('should work with all capabilities from sample config', async function sampleConfig() {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          CAPABILITIES: {
            VALUE: [
              'GIT_REMOTE_SYNC',
              'CODE_SYNC_ZIP_UPLOAD',
              'CODE_SYNC_GIT_PULL',
              'CODE_SYNC_GIT_PUSH',
              'COMMERCE_API_READ',
              'COMMERCE_API_WRITE',
            ],
            SYSTEM_MANAGED: true,
          },
        })
      );

      const { isCapabilityEnabled } = await import('../capability-config.js');

      // All should be enabled
      expect(isCapabilityEnabled('GIT_REMOTE_SYNC')).toBe(true);
      expect(isCapabilityEnabled('CODE_SYNC_ZIP_UPLOAD')).toBe(true);
      expect(isCapabilityEnabled('CODE_SYNC_GIT_PULL')).toBe(true);
      expect(isCapabilityEnabled('CODE_SYNC_GIT_PUSH')).toBe(true);
      expect(isCapabilityEnabled('COMMERCE_API_READ')).toBe(true);
      expect(isCapabilityEnabled('COMMERCE_API_WRITE')).toBe(true);

      // These should not be enabled
      expect(isCapabilityEnabled('COMMERCE_API_DELETE')).toBe(false);
      expect(isCapabilityEnabled('ADMIN_ACCESS')).toBe(false);
    });

    it('should use memoized config (performance)', async function memoization() {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          CAPABILITIES: {
            VALUE: ['GIT_REMOTE_SYNC'],
            SYSTEM_MANAGED: true,
          },
        })
      );

      const { isCapabilityEnabled } = await import('../capability-config.js');

      // Call multiple times
      isCapabilityEnabled('GIT_REMOTE_SYNC');
      isCapabilityEnabled('COMMERCE_API_READ');
      isCapabilityEnabled('GIT_REMOTE_SYNC');

      // readFileSync should only be called once due to memoization
      expect(fs.readFileSync).toHaveBeenCalledTimes(1);
    });
  });
});
