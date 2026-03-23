import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getPersistentPublicDir } from '../persistent-assets.js';

describe('persistent-assets', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.PERSISTENT_ASSETS_DIR;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('getPersistentPublicDir', () => {
    it('returns {PERSISTENT_ASSETS_DIR}/public when env var is set', () => {
      process.env.PERSISTENT_ASSETS_DIR = '/shared-storage';
      expect(getPersistentPublicDir('/app')).toBe('/shared-storage/public');
    });

    it('ignores appPath when PERSISTENT_ASSETS_DIR is set', () => {
      process.env.PERSISTENT_ASSETS_DIR = '/mount/shared';
      expect(getPersistentPublicDir('/any/path')).toBe('/mount/shared/public');
    });

    it('falls back to {appPath}/public when env var is not set', () => {
      expect(getPersistentPublicDir('/app')).toBe('/app/public');
    });

    it('falls back to {appPath}/public for local dev paths', () => {
      expect(getPersistentPublicDir('/tmp/airo-app-builder/abc123/preview')).toBe(
        '/tmp/airo-app-builder/abc123/preview/public'
      );
    });
  });
});
