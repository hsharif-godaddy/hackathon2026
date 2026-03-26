import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getPersistentPublicDir, getPersistentPrivateDir, getPersistentAssetPaths } from '../persistent-assets.js';

describe('persistent-assets', () => {
  beforeEach(() => {
    delete process.env.SHARED_STORAGE_DIR;
  });

  afterEach(() => {
    delete process.env.SHARED_STORAGE_DIR;
  });

  describe('getPersistentPublicDir', () => {
    it('returns {SHARED_STORAGE_DIR}/public/assets when env var is set', () => {
      process.env.SHARED_STORAGE_DIR = '/shared-storage';
      expect(getPersistentPublicDir('/app')).toBe('/shared-storage/public/assets');
    });

    it('ignores appPath when SHARED_STORAGE_DIR is set', () => {
      process.env.SHARED_STORAGE_DIR = '/mount/shared';
      expect(getPersistentPublicDir('/any/path')).toBe('/mount/shared/public/assets');
    });

    it('returns {appPath}/public/assets in container mode (appPath is /app)', () => {
      expect(getPersistentPublicDir('/app')).toBe('/app/public/assets');
    });

    it('returns {appPath}/public/assets in container mode (appPath starts with /app/)', () => {
      expect(getPersistentPublicDir('/app/subdir')).toBe('/app/subdir/public/assets');
    });

    it('returns host assets directory in local dev (appPath is host path)', () => {
      expect(getPersistentPublicDir('/tmp/airo-app-builder/abc123/preview')).toBe(
        '/tmp/airo-app-builder/abc123/assets/public'
      );
    });

    it('returns correct path for publish workspace in local dev', () => {
      expect(getPersistentPublicDir('/tmp/airo-app-builder/abc123/publish')).toBe(
        '/tmp/airo-app-builder/abc123/assets/public'
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
    it('returns v4 default container mount paths', () => {
      expect(getPersistentAssetPaths()).toEqual({
        persistentPublicPath: '/app/public/assets',
        persistentPrivatePath: '/private',
      });
    });

    it('uses SHARED_STORAGE_DIR when set', () => {
      process.env.SHARED_STORAGE_DIR = '/custom/base';
      expect(getPersistentAssetPaths()).toEqual({
        persistentPublicPath: '/custom/base/public/assets',
        persistentPrivatePath: '/private',
      });
    });

    it('uses /shared-storage when SHARED_STORAGE_DIR is set (future deployment)', () => {
      process.env.SHARED_STORAGE_DIR = '/shared-storage';
      expect(getPersistentAssetPaths()).toEqual({
        persistentPublicPath: '/shared-storage/public/assets',
        persistentPrivatePath: '/private',
      });
    });
  });
});
