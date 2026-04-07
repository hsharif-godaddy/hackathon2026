import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { ReadFileTool, isFileBlocked } from '../read-file';

describe('ReadFileTool - Security Tests', () => {
  let readFileTool: ReadFileTool;
  let testAppDir: string;
  let outsideDir: string;
  
  beforeEach(() => {
    readFileTool = new ReadFileTool();
    
    const uniqueId = Date.now() + Math.random().toString(36).substring(7);
    testAppDir = join(tmpdir(), `test-read-${uniqueId}`);
    outsideDir = join(tmpdir(), `outside-read-${uniqueId}`);
    
    mkdirSync(testAppDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    
    // Create sensitive file outside app directory
    writeFileSync(join(outsideDir, 'secrets.txt'), 'API_KEY=super-secret-123\nPASSWORD=admin123');
    writeFileSync(join(outsideDir, 'passwd'), 'root:x:0:0:root:/root:/bin/bash');
    
    // Create normal files inside app directory
    writeFileSync(join(testAppDir, 'config.txt'), 'debug=true\nport=3000');
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
      const result = await readFileTool.readFile({
        path: '../../../etc/passwd'
      }, testAppDir);
      
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/outside.*app directory|Access denied/i);
    });

    it('should block absolute path outside app directory', async () => {
      const result = await readFileTool.readFile({
        path: join(outsideDir, 'secrets.txt')
      }, testAppDir);
      
      expect(result.success).toBe(false);
      // The path-helper converts absolute paths to relative, so /tmp/outside-read-.../secrets.txt
      // becomes a relative path inside the app dir that doesn't exist
      expect(result.error).toMatch(/outside.*app directory|Access denied|blocked|Cache directories|File does not exist/i);
    });

    it('should allow normal relative paths within directory', async () => {
      const result = await readFileTool.readFile({
        path: 'config.txt'
      }, testAppDir);
      
      expect(result.success).toBe(true);
      expect(result.content).toContain('debug=true');
    });

    it('should block prefix confusion attack', async () => {
      // If testAppDir is /tmp/test-read-123, try /tmp/test-read-123-evil
      const evilDir = testAppDir + '-evil';
      mkdirSync(evilDir, { recursive: true });
      writeFileSync(join(evilDir, 'evil.txt'), 'SECRET_DATA=stolen');
      
      try {
        const result = await readFileTool.readFile({
          path: `../${evilDir.split('/').pop()}/evil.txt`
        }, testAppDir);
        
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/outside.*app directory|Access denied/i);
      } finally {
        rmSync(evilDir, { recursive: true, force: true });
      }
    });
  });

  describe('Symlink Path Traversal Prevention', () => {
    it('should block reading through symlink pointing outside', async () => {
      const symlinkPath = join(testAppDir, 'evil-link.txt');
      const targetFile = join(outsideDir, 'secrets.txt');
      
      symlinkSync(targetFile, symlinkPath);
      
      const result = await readFileTool.readFile({
        path: 'evil-link.txt'
      }, testAppDir);
      
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/symlink|outside.*app directory|Access denied/i);
    });

    it('should block symlink directory traversal', async () => {
      const symlinkDir = join(testAppDir, 'linked-secrets');
      
      symlinkSync(outsideDir, symlinkDir);
      
      const result = await readFileTool.readFile({
        path: 'linked-secrets/secrets.txt'
      }, testAppDir);
      
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/symlink|outside.*app directory|Access denied/i);
    });

    it('should allow symlink pointing inside app directory', async () => {
      const realFile = join(testAppDir, 'real-config.txt');
      const symlinkPath = join(testAppDir, 'link-config.txt');
      
      writeFileSync(realFile, 'setting=value');
      symlinkSync(realFile, symlinkPath);
      
      const result = await readFileTool.readFile({
        path: 'link-config.txt'
      }, testAppDir);
      
      expect(result.success).toBe(true);
      expect(result.content).toContain('setting=value');
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
      
      const result = await readFileTool.readFile({
        path: 'docs-link/secrets-link.txt'
      }, testAppDir);
      
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/symlink|outside.*app directory|Access denied/i);
    });

    it('should block reading /etc/passwd via symlink', async () => {
      if (process.platform === 'win32') {
        return;
      }
      
      const symlinkPath = join(testAppDir, 'passwd-link');
      
      try {
        symlinkSync('/etc/passwd', symlinkPath);
      } catch (err) {
        return;
      }
      
      const result = await readFileTool.readFile({
        path: 'passwd-link'
      }, testAppDir);
      
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/symlink|outside.*app directory|Access denied/i);
    });
  });

  describe('Edge Cases', () => {
    it('should handle symlink chains within app directory', async () => {
      const file1 = join(testAppDir, 'file1.txt');
      const link1 = join(testAppDir, 'link1.txt');
      const link2 = join(testAppDir, 'link2.txt');
      
      writeFileSync(file1, 'content=valid');
      symlinkSync(file1, link1);
      symlinkSync(link1, link2);
      
      const result = await readFileTool.readFile({
        path: 'link2.txt'
      }, testAppDir);
      
      expect(result.success).toBe(true);
      expect(result.content).toContain('content=valid');
    });

    it('should block symlink that eventually points outside', async () => {
      const link1 = join(testAppDir, 'internal-link.txt');
      const link2 = join(testAppDir, 'final-link.txt');
      const targetFile = join(outsideDir, 'secrets.txt');
      
      symlinkSync(targetFile, link1);
      symlinkSync(link1, link2);
      
      const result = await readFileTool.readFile({
        path: 'final-link.txt'
      }, testAppDir);
      
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/symlink|outside.*app directory|Access denied/i);
    });

    it('should handle partial file reads safely', async () => {
      const result = await readFileTool.readFile({
        path: 'config.txt',
        startLine: 1,
        numLines: 1
      }, testAppDir);

      expect(result.success).toBe(true);
      expect(result.linesRead).toEqual({ start: 1, end: 1 });
    });
  });

  describe('Binary file blocking', () => {
    it('should block image files with image-specific reason', () => {
      const result = isFileBlocked('assets/logo.png');
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('Cannot read image as text');
      expect(result.reason).toContain('Reference by path in code');
    });

    it('should block jpg with image-specific reason', () => {
      const result = isFileBlocked('photo.jpg');
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('Cannot read image as text');
    });

    it('should block PDF with document-specific reason', () => {
      const result = isFileBlocked('report.pdf');
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('Cannot read PDF as text');
      expect(result.reason).toContain('paste relevant content');
    });

    it('should block DOCX with document-specific reason', () => {
      const result = isFileBlocked('spec.docx');
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('Cannot read DOCX as text');
    });

    it('should block archive files with generic binary reason', () => {
      const result = isFileBlocked('bundle.zip');
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('not readable as text');
      expect(result.reason).toContain('Reference by path in code');
    });

    it('should block executable files', () => {
      const result = isFileBlocked('app.exe');
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('not readable as text');
      expect(result.reason).toContain('Reference by path in code');
    });

    it('should not block SVG files', () => {
      const result = isFileBlocked('icon.svg');
      expect(result.blocked).toBe(false);
    });

    it('should not block source code files', () => {
      expect(isFileBlocked('app.tsx').blocked).toBe(false);
      expect(isFileBlocked('index.js').blocked).toBe(false);
      expect(isFileBlocked('styles.css').blocked).toBe(false);
    });
  });

  describe('Binary null-byte sniffing', () => {
    it('should block binary files with unknown extensions via null-byte detection', async () => {
      writeFileSync(join(testAppDir, 'data.custom'), Buffer.from([0x00, 0x01, 0x02, 0xFF]));
      const result = await readFileTool.readFile({ path: 'data.custom' }, testAppDir);
      expect(result.success).toBe(false);
      expect(result.error).toContain('binary file detected');
    });

    it('should allow text files with unknown extensions', async () => {
      writeFileSync(join(testAppDir, 'config.toml'), '[server]\nport = 3000\n');
      const result = await readFileTool.readFile({ path: 'config.toml' }, testAppDir);
      expect(result.success).toBe(true);
      expect(result.content).toContain('port = 3000');
    });
  });

  describe('Raw option', () => {
    it('should include line number prefixes by default', async () => {
      const result = await readFileTool.readFile({
        path: 'config.txt',
      }, testAppDir);

      expect(result.success).toBe(true);
      expect(result.content).toMatch(/^\s+1\|debug=true/);
      expect(result.content).toMatch(/\s+2\|port=3000/);
    });

    it('should return raw content without line numbers when raw is true', async () => {
      const result = await readFileTool.readFile({
        path: 'config.txt',
        raw: true,
      }, testAppDir);

      expect(result.success).toBe(true);
      expect(result.content).toBe('debug=true\nport=3000');
    });
  });
});
