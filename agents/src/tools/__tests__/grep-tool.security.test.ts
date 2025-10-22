import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GrepTool } from '../grep-tool';
import { mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('GrepTool - Security Tests', () => {
  let grepTool: GrepTool;
  let testAppDir: string;
  let outsideDir: string;
  
  beforeEach(() => {
    const uniqueId = Date.now() + Math.random().toString(36).substring(7);
    testAppDir = join(tmpdir(), `test-grep-${uniqueId}`);
    outsideDir = join(tmpdir(), `outside-grep-${uniqueId}`);
    
    mkdirSync(testAppDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    
    // Create sensitive file outside app directory
    writeFileSync(join(outsideDir, 'secrets.txt'), 'API_KEY=super-secret-123');
    writeFileSync(join(outsideDir, 'passwords.txt'), 'admin:password123');
    
    // Create normal files inside app directory
    writeFileSync(join(testAppDir, 'config.txt'), 'debug=true');
    
    grepTool = new GrepTool(testAppDir);
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
    it('should block relative path traversal with ../', async () => {
      const result = await grepTool.execute({
        query: 'API_KEY',
        paths: ['../../../etc/passwd']
      });
      
      // Should not find the outside file
      expect(result.matches.length).toBe(0);
      expect(result.filesSearched).toBe(0);
    });

    it('should block absolute path outside working directory', async () => {
      const result = await grepTool.execute({
        query: 'API_KEY',
        paths: [join(outsideDir, 'secrets.txt')]
      });
      
      // Should not search the outside file
      expect(result.matches.length).toBe(0);
      expect(result.filesSearched).toBe(0);
    });

    it('should allow normal relative paths within directory', async () => {
      const result = await grepTool.execute({
        query: 'debug',
        paths: ['config.txt']
      });
      
      expect(result.success).toBe(true);
      expect(result.matches.length).toBeGreaterThan(0);
    });

    it('should block prefix confusion attack', async () => {
      // If testAppDir is /tmp/test-grep-123, try /tmp/test-grep-123-evil
      const evilDir = testAppDir + '-evil';
      mkdirSync(evilDir, { recursive: true });
      writeFileSync(join(evilDir, 'evil.txt'), 'SECRET_DATA');
      
      try {
        const result = await grepTool.execute({
          query: 'SECRET',
          paths: [`../${evilDir.split('/').pop()}/evil.txt`]
        });
        
        // Should not find the file in the sibling directory
        expect(result.matches.length).toBe(0);
        expect(result.filesSearched).toBe(0);
      } finally {
        rmSync(evilDir, { recursive: true, force: true });
      }
    });
  });

  describe('Symlink Path Traversal Prevention', () => {
    it('should block searching through symlink pointing outside', async () => {
      const symlinkPath = join(testAppDir, 'evil-link.txt');
      const targetFile = join(outsideDir, 'secrets.txt');
      
      symlinkSync(targetFile, symlinkPath);
      
      const result = await grepTool.execute({
        query: 'API_KEY',
        paths: ['evil-link.txt']
      });
      
      // Should not read the symlinked file
      expect(result.matches.length).toBe(0);
    });

    it('should block symlink directory traversal', async () => {
      const symlinkDir = join(testAppDir, 'linked-secrets');
      
      symlinkSync(outsideDir, symlinkDir);
      
      const result = await grepTool.execute({
        query: 'password',
        paths: ['linked-secrets/passwords.txt']
      });
      
      // Should not search files in symlinked directory
      expect(result.matches.length).toBe(0);
    });

    it('should allow symlink pointing inside working directory', async () => {
      const realFile = join(testAppDir, 'real-config.txt');
      const symlinkPath = join(testAppDir, 'link-config.txt');
      
      writeFileSync(realFile, 'setting=value');
      symlinkSync(realFile, symlinkPath);
      
      const result = await grepTool.execute({
        query: 'setting',
        paths: ['link-config.txt']
      });
      
      expect(result.success).toBe(true);
      expect(result.matches.length).toBeGreaterThan(0);
    });

    it('should block nested symlink attack', async () => {
      // Create valid internal symlink to directory
      const realDir = join(testAppDir, 'docs');
      const linkDir = join(testAppDir, 'docs-link');
      mkdirSync(realDir);
      symlinkSync(realDir, linkDir);
      
      // Inside symlinked directory, create symlink pointing outside
      const evilLink = join(linkDir, 'secrets-link.txt');
      const targetFile = join(outsideDir, 'secrets.txt');
      symlinkSync(targetFile, evilLink);
      
      const result = await grepTool.execute({
        query: 'API_KEY',
        paths: ['docs-link/secrets-link.txt']
      });
      
      // Should not read the file that escapes via nested symlinks
      expect(result.matches.length).toBe(0);
    });

    it('should block searching entire symlinked external directory', async () => {
      const symlinkDir = join(testAppDir, 'external-data');
      
      symlinkSync(outsideDir, symlinkDir);
      
      // Try to search the symlinked directory
      const result = await grepTool.execute({
        query: 'API_KEY',
        paths: ['external-data']
      });
      
      // Should not search any files in the symlinked external directory
      expect(result.matches.length).toBe(0);
      expect(result.filesSearched).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle symlink chains within working directory', async () => {
      const file1 = join(testAppDir, 'file1.txt');
      const link1 = join(testAppDir, 'link1.txt');
      const link2 = join(testAppDir, 'link2.txt');
      
      writeFileSync(file1, 'content=valid');
      symlinkSync(file1, link1);
      symlinkSync(link1, link2);
      
      const result = await grepTool.execute({
        query: 'content',
        paths: ['link2.txt']
      });
      
      expect(result.success).toBe(true);
      expect(result.matches.length).toBeGreaterThan(0);
    });

    it('should block symlink that eventually points outside', async () => {
      const link1 = join(testAppDir, 'internal-link.txt');
      const link2 = join(testAppDir, 'final-link.txt');
      const targetFile = join(outsideDir, 'secrets.txt');
      
      symlinkSync(targetFile, link1);
      symlinkSync(link1, link2);
      
      const result = await grepTool.execute({
        query: 'API_KEY',
        paths: ['final-link.txt']
      });
      
      expect(result.matches.length).toBe(0);
    });
  });
});
