import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getPersistentPublicDir, getPersistentPrivateDir, getPersistentAssetPaths } from '../persistent-assets.js';

describe('persistent-assets', () => {
  beforeEach(() => {
    delete process.env.PERSISTENT_ASSETS_DIR;
  });

  afterEach(() => {
    delete process.env.PERSISTENT_ASSETS_DIR;
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

  describe('getPersistentPrivateDir', () => {
    it('returns /private when appPath is /app (container mode)', () => {
      expect(getPersistentPrivateDir('/app')).toBe('/private');
    });

    it('returns /private when appPath starts with /app/ (container subdir)', () => {
      expect(getPersistentPrivateDir('/app/subdir')).toBe('/private');
    });

    it('returns {appPath}/../assets/private for local dev (agents on host)', () => {
      expect(getPersistentPrivateDir('/tmp/airo-app-builder/abc123/preview')).toBe(
        '/tmp/airo-app-builder/abc123/assets/private'
      );
    });

    it('returns correct path for publish workspace in local dev', () => {
      expect(getPersistentPrivateDir('/tmp/airo-app-builder/abc123/publish')).toBe(
        '/tmp/airo-app-builder/abc123/assets/private'
      );
    });
  });

  describe('getPersistentAssetPaths', () => {
    it('returns default container mount paths', () => {
      expect(getPersistentAssetPaths()).toEqual({
        persistentPublicPath: '/shared-storage/public',
        persistentPrivatePath: '/private',
      });
    });

    it('uses PERSISTENT_ASSETS_DIR when set', () => {
      process.env.PERSISTENT_ASSETS_DIR = '/custom/base';
      expect(getPersistentAssetPaths()).toEqual({
        persistentPublicPath: '/custom/base/public',
        persistentPrivatePath: '/private',
      });
    });

    it('matches production configuration', () => {
      process.env.PERSISTENT_ASSETS_DIR = '/shared-storage';
      expect(getPersistentAssetPaths()).toEqual({
        persistentPublicPath: '/shared-storage/public',
        persistentPrivatePath: '/private',
      });
    });
  });
});
