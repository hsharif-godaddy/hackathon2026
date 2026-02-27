import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, symlinkSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

import { deriveAssetsDir, translateDockerPath, validateNoEscapingSymlinks } from '../path-helper.js';

describe('path-helper', () => {
  describe('#translateDockerPath', () => {
    it('should strip /app/ prefix', function strip() {
      expect(translateDockerPath('/app/public/assets/heart.svg')).toBe('public/assets/heart.svg');
    });

    it('should strip leading / for other absolute paths', function absolute() {
      expect(translateDockerPath('/etc/passwd')).toBe('etc/passwd');
    });

    it('should return relative paths unchanged', function relative() {
      expect(translateDockerPath('src/index.ts')).toBe('src/index.ts');
    });
  });

  describe('#deriveAssetsDir', () => {
    it('should return assets sibling when appPath ends with /preview', function preview() {
      expect(deriveAssetsDir('/tmp/airo-app-builder/abc/preview')).toBe('/tmp/airo-app-builder/abc/assets');
    });

    it('should return null when appPath does not end with /preview and no CEPH_STORAGE_DIR', function noPreview() {
      expect(deriveAssetsDir('/tmp/airo-app-builder/abc')).toBeNull();
    });

    it('should use CEPH_STORAGE_DIR in production when appPath is not /preview', function cephDir() {
      const original = process.env.CEPH_STORAGE_DIR;
      try {
        process.env.CEPH_STORAGE_DIR = '/mnt/ceph/site-123';
        expect(deriveAssetsDir('/app')).toBe('/mnt/ceph/site-123/preview/assets');
      } finally {
        if (original === undefined) {
          delete process.env.CEPH_STORAGE_DIR;
        } else {
          process.env.CEPH_STORAGE_DIR = original;
        }
      }
    });
  });

  describe('#validateNoEscapingSymlinks', () => {
    let baseDir: string;
    let outsideDir: string;

    beforeEach(() => {
      const id = Date.now() + Math.random().toString(36).substring(7);
      baseDir = join(tmpdir(), `test-validate-${id}`, 'preview');
      outsideDir = join(tmpdir(), `test-validate-${id}`, 'outside');
      mkdirSync(join(baseDir, 'public'), { recursive: true });
      mkdirSync(outsideDir, { recursive: true });
      writeFileSync(join(outsideDir, 'secret.txt'), 'SECRET');
    });

    afterEach(() => {
      const parent = join(baseDir, '..', '..');
      if (existsSync(join(baseDir, '..'))) {
        rmSync(join(baseDir, '..'), { recursive: true, force: true });
      }
    });

    it('should throw for symlinks pointing outside basePath', function blockEscape() {
      symlinkSync(outsideDir, join(baseDir, 'evil'));
      expect(() => {
        validateNoEscapingSymlinks(join(baseDir, 'evil', 'secret.txt'), baseDir);
      }).toThrow(/Security violation/);
    });

    it('should allow internal symlinks', function allowInternal() {
      const realDir = join(baseDir, 'real');
      mkdirSync(realDir);
      symlinkSync(realDir, join(baseDir, 'linked'));
      expect(() => {
        validateNoEscapingSymlinks(join(baseDir, 'linked', 'file.txt'), baseDir);
      }).not.toThrow();
    });

    it('should allow symlinks to allowedPaths', function allowWhitelist() {
      const assetsDir = join(baseDir, '..', 'assets');
      mkdirSync(join(assetsDir, 'public'), { recursive: true });

      const relTarget = relative(join(baseDir, 'public'), join(assetsDir, 'public'));
      symlinkSync(relTarget, join(baseDir, 'public', 'assets'));

      expect(() => {
        validateNoEscapingSymlinks(
          join(baseDir, 'public', 'assets', 'heart.svg'),
          baseDir,
          [assetsDir]
        );
      }).not.toThrow();
    });

    it('should still block symlinks to non-allowed external directories', function blockNonAllowed() {
      const assetsDir = join(baseDir, '..', 'assets');
      mkdirSync(join(assetsDir, 'public'), { recursive: true });

      symlinkSync(outsideDir, join(baseDir, 'hack'));

      expect(() => {
        validateNoEscapingSymlinks(
          join(baseDir, 'hack', 'secret.txt'),
          baseDir,
          [assetsDir]
        );
      }).toThrow(/Security violation/);
    });
  });
});
