import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { isPathSafe } from '../../utils/path-helper.js';

describe('Grep Search - Path Security Tests', () => {
  let testAppDir: string;
  let outsideDir: string;

  beforeEach(() => {
    const uniqueId = Date.now() + Math.random().toString(36).substring(7);
    testAppDir = join(tmpdir(), `test-grep-${uniqueId}`);
    outsideDir = join(tmpdir(), `outside-grep-${uniqueId}`);

    mkdirSync(testAppDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });

    writeFileSync(join(outsideDir, 'secrets.txt'), 'API_KEY=super-secret-123');
    writeFileSync(join(outsideDir, 'passwords.txt'), 'admin:password123');
    writeFileSync(join(testAppDir, 'config.txt'), 'debug=true');
  });

  afterEach(() => {
    if (existsSync(testAppDir)) {
      rmSync(testAppDir, { recursive: true, force: true });
    }
    if (existsSync(outsideDir)) {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  describe('Path Traversal Prevention', () => {
    it('should block relative path traversal with ../', () => {
      const maliciousPath = join(testAppDir, '../../../etc/passwd');
      expect(isPathSafe(maliciousPath, testAppDir)).toBe(false);
    });

    it('should block absolute path outside working directory', () => {
      const outsidePath = join(outsideDir, 'secrets.txt');
      expect(isPathSafe(outsidePath, testAppDir)).toBe(false);
    });

    it('should allow normal paths within directory', () => {
      const safePath = join(testAppDir, 'config.txt');
      expect(isPathSafe(safePath, testAppDir)).toBe(true);
    });

    it('should block prefix confusion attack', () => {
      const evilDir = testAppDir + '-evil';
      mkdirSync(evilDir, { recursive: true });
      writeFileSync(join(evilDir, 'evil.txt'), 'SECRET_DATA');

      try {
        expect(isPathSafe(join(evilDir, 'evil.txt'), testAppDir)).toBe(false);
      } finally {
        rmSync(evilDir, { recursive: true, force: true });
      }
    });

    it('should allow files whose names start with dots', () => {
      const dotEnv = join(testAppDir, '..env');
      writeFileSync(dotEnv, 'FOO=bar');
      expect(isPathSafe(dotEnv, testAppDir)).toBe(true);
    });
  });

  describe('Symlink Path Traversal Prevention', () => {
    it('should block symlink pointing outside app directory', () => {
      const symlinkPath = join(testAppDir, 'evil-link.txt');
      symlinkSync(join(outsideDir, 'secrets.txt'), symlinkPath);

      expect(isPathSafe(symlinkPath, testAppDir)).toBe(false);
    });

    it('should block symlink directory traversal', () => {
      const symlinkDir = join(testAppDir, 'linked-secrets');
      symlinkSync(outsideDir, symlinkDir);

      const targetFile = join(symlinkDir, 'passwords.txt');
      expect(isPathSafe(targetFile, testAppDir)).toBe(false);
    });

    it('should allow symlink pointing inside working directory', () => {
      const realFile = join(testAppDir, 'real-config.txt');
      const symlinkPath = join(testAppDir, 'link-config.txt');

      writeFileSync(realFile, 'setting=value');
      symlinkSync(realFile, symlinkPath);

      expect(isPathSafe(symlinkPath, testAppDir)).toBe(true);
    });

    it('should block nested symlink attack', () => {
      const realDir = join(testAppDir, 'docs');
      const linkDir = join(testAppDir, 'docs-link');
      mkdirSync(realDir);
      symlinkSync(realDir, linkDir);

      const evilLink = join(linkDir, 'secrets-link.txt');
      symlinkSync(join(outsideDir, 'secrets.txt'), evilLink);

      expect(isPathSafe(evilLink, testAppDir)).toBe(false);
    });

    it('should block searching entire symlinked external directory', () => {
      const symlinkDir = join(testAppDir, 'external-data');
      symlinkSync(outsideDir, symlinkDir);

      expect(isPathSafe(symlinkDir, testAppDir)).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle symlink chains within working directory', () => {
      const file1 = join(testAppDir, 'file1.txt');
      const link1 = join(testAppDir, 'link1.txt');
      const link2 = join(testAppDir, 'link2.txt');

      writeFileSync(file1, 'content=valid');
      symlinkSync(file1, link1);
      symlinkSync(link1, link2);

      expect(isPathSafe(link2, testAppDir)).toBe(true);
    });

    it('should block symlink that eventually points outside', () => {
      const link1 = join(testAppDir, 'internal-link.txt');
      const link2 = join(testAppDir, 'final-link.txt');

      symlinkSync(join(outsideDir, 'secrets.txt'), link1);
      symlinkSync(link1, link2);

      expect(isPathSafe(link2, testAppDir)).toBe(false);
    });
  });
});
