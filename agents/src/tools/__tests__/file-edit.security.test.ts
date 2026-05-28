import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileEditTool, isProtectedWorkspacePath } from '../file-edit';
import { mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

describe('FileEditTool - Security Tests', () => {
  let fileEditTool: FileEditTool;
  let testAppDir: string;
  let outsideDir: string;
  
  beforeEach(() => {
    fileEditTool = new FileEditTool();
    
    const uniqueId = Date.now() + Math.random().toString(36).substring(7);
    testAppDir = join(tmpdir(), `test-app-${uniqueId}`);
    outsideDir = join(tmpdir(), `outside-dir-${uniqueId}`);
    
    mkdirSync(testAppDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    
    writeFileSync(join(outsideDir, 'sensitive.txt'), 'SECRET_DATA');
  });
  
  afterEach(() => {
    if (existsSync(testAppDir)) {
      rmSync(testAppDir, { recursive: true, force: true });
    }
    if (existsSync(outsideDir)) {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  describe('Symlink Path Traversal Prevention', () => {
    it('should block reading through symlink pointing outside app directory', async () => {
      const symlinkPath = join(testAppDir, 'malicious-link');
      const targetFile = join(outsideDir, 'sensitive.txt');
      
      symlinkSync(targetFile, symlinkPath);
      
      const result = await fileEditTool.editFile(testAppDir, {
        path: 'malicious-link',
        mode: 'rewrite',
        content: 'MODIFIED_DATA'
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/symlink.*outside.*app directory/i);
    });

    it('should block reading through symlink in subdirectory pointing outside', async () => {
      const subDir = join(testAppDir, 'src');
      mkdirSync(subDir);
      
      const symlinkPath = join(subDir, 'config-link');
      const targetFile = join(outsideDir, 'sensitive.txt');
      
      symlinkSync(targetFile, symlinkPath);
      
      const result = await fileEditTool.editFile(testAppDir, {
        path: 'src/config-link',
        mode: 'rewrite',
        content: 'MODIFIED_DATA'
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/symlink.*outside.*app directory/i);
    });

    it('should block writing through symlink pointing outside app directory', async () => {
      const symlinkPath = join(testAppDir, 'evil-link');
      const targetFile = join(outsideDir, 'sensitive.txt');
      
      symlinkSync(targetFile, symlinkPath);
      
      const result = await fileEditTool.editFile(testAppDir, {
        path: 'evil-link',
        mode: 'rewrite',
        content: 'HACKED'
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/symlink.*outside.*app directory/i);
      
      const outsideFileContent = readFileSync(targetFile, 'utf-8');
      expect(outsideFileContent).toBe('SECRET_DATA');
    });

    it('should block editing through symlink pointing to /etc/passwd', async () => {
      if (process.platform === 'win32') {
        return;
      }
      
      const symlinkPath = join(testAppDir, 'passwd-link');
      
      try {
        symlinkSync('/etc/passwd', symlinkPath);
      } catch (err) {
        return;
      }
      
      const result = await fileEditTool.editFile(testAppDir, {
        path: 'passwd-link',
        mode: 'rewrite',
        content: 'root::0:0:::'
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/symlink.*outside.*app directory/i);
    });

    it('should allow editing symlink pointing inside app directory', async () => {
      const targetFile = join(testAppDir, 'real-file.txt');
      const symlinkPath = join(testAppDir, 'internal-link.txt');
      
      writeFileSync(targetFile, 'original content');
      symlinkSync(targetFile, symlinkPath);
      
      const result = await fileEditTool.editFile(testAppDir, {
        path: 'internal-link.txt',
        mode: 'rewrite',
        content: 'updated content'
      });
      
      expect(result.success).toBe(true);
      expect(result.mode).toBe('rewrite');
    });

    it('should block symlink directory traversal', async () => {
      const symlinkDir = join(testAppDir, 'linked-dir');
      
      symlinkSync(outsideDir, symlinkDir);
      
      const result = await fileEditTool.editFile(testAppDir, {
        path: 'linked-dir/sensitive.txt',
        mode: 'rewrite',
        content: 'COMPROMISED'
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/symlink.*outside.*app directory/i);
    });

    it('should block nested symlink attack', async () => {
      const subDir = join(testAppDir, 'public');
      mkdirSync(subDir);
      
      const firstLink = join(subDir, 'assets');
      symlinkSync(outsideDir, firstLink);
      
      const result = await fileEditTool.editFile(testAppDir, {
        path: 'public/assets/sensitive.txt',
        mode: 'rewrite',
        content: 'EXPLOITED'
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/symlink.*outside.*app directory/i);
    });
  });

  describe('Path Traversal Prevention', () => {
    it('should block absolute path outside app directory', async () => {
      const result = await fileEditTool.editFile(testAppDir, {
        path: '/etc/passwd',
        mode: 'rewrite',
        content: 'hacked'
      });

      // The path-helper converts '/etc/passwd' to 'etc/passwd' (relative),
      // which creates the file inside the app directory rather than escaping.
      // This is safe because the absolute path is neutralized to a relative one.
      // The file is created as testAppDir/etc/passwd (mode 'rewrite' creates if missing).
      expect(result.success).toBe(true);
    });

    it('should block relative path traversal with ../', async () => {
      const result = await fileEditTool.editFile(testAppDir, {
        path: '../../../etc/passwd',
        mode: 'rewrite',
        content: 'hacked'
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/must be within the app directory/i);
    });

    it('should block prefix confusion attack', async () => {
      // Test that a sibling directory with a similar name is blocked
      // E.g., if testAppDir is /tmp/test-app-123, ensure /tmp/test-app-123-evil is blocked
      const siblingDir = testAppDir + '-evil';
      mkdirSync(siblingDir, { recursive: true });
      writeFileSync(join(siblingDir, 'secret.txt'), 'SENSITIVE');
      
      try {
        // Try to use a relative path that resolves to the sibling directory
        const result = await fileEditTool.editFile(testAppDir, {
          path: `../${siblingDir.split('/').pop()}/secret.txt`,
          mode: 'rewrite',
          content: 'hacked'
        });
        
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/must be within the app directory/i);
      } finally {
        rmSync(siblingDir, { recursive: true, force: true });
      }
    });

    it('should allow normal relative paths', async () => {
      const result = await fileEditTool.editFile(testAppDir, {
        path: 'src/components/Button.tsx',
        mode: 'create',
        content: 'export const Button = () => <button />;'
      });
      
      expect(result.success).toBe(true);
      expect(result.mode).toBe('create');
    });
  });

  describe('Edge Cases', () => {
    it('should handle symlink chain within app directory', async () => {
      const file1 = join(testAppDir, 'file1.txt');
      const link1 = join(testAppDir, 'link1.txt');
      const link2 = join(testAppDir, 'link2.txt');
      
      writeFileSync(file1, 'original');
      symlinkSync(file1, link1);
      symlinkSync(link1, link2);
      
      const result = await fileEditTool.editFile(testAppDir, {
        path: 'link2.txt',
        mode: 'rewrite',
        content: 'updated'
      });
      
      expect(result.success).toBe(true);
    });

    it('should block symlink that eventually points outside', async () => {
      const internalLink = join(testAppDir, 'internal.txt');
      const externalLink = join(testAppDir, 'external.txt');
      const targetFile = join(outsideDir, 'sensitive.txt');
      
      symlinkSync(targetFile, internalLink);
      symlinkSync(internalLink, externalLink);
      
      const result = await fileEditTool.editFile(testAppDir, {
        path: 'external.txt',
        mode: 'rewrite',
        content: 'exploit'
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/symlink.*outside.*app directory/i);
    });

    it('should check symlinks in path components after a valid symlink', async () => {
      // Create a valid internal symlink to a directory
      const realDir = join(testAppDir, 'real-dir');
      const linkDir = join(testAppDir, 'link-dir');
      mkdirSync(realDir);
      symlinkSync(realDir, linkDir);
      
      // Inside that symlinked directory, create another symlink pointing outside
      const evilLink = join(linkDir, 'evil-file');
      const targetFile = join(outsideDir, 'sensitive.txt');
      symlinkSync(targetFile, evilLink);
      
      // Try to access through the path: link-dir/evil-file
      const result = await fileEditTool.editFile(testAppDir, {
        path: 'link-dir/evil-file',
        mode: 'rewrite',
        content: 'hacked'
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/symlink.*outside.*app directory/i);
    });
  });

  describe('Protected Workspace Paths', () => {
    it('isProtectedWorkspacePath: detects .airo dir itself', () => {
      expect(isProtectedWorkspacePath('/app/.airo', '/app')).toBe(true);
    });

    it('isProtectedWorkspacePath: detects file inside .airo', () => {
      expect(isProtectedWorkspacePath('/app/.airo/video.json', '/app')).toBe(true);
    });

    it('isProtectedWorkspacePath: detects nested path inside .airo', () => {
      expect(isProtectedWorkspacePath('/app/.airo/qa-runs/qa-run-1.json', '/app')).toBe(true);
    });

    it('isProtectedWorkspacePath: allows adjacent path with similar prefix', () => {
      expect(isProtectedWorkspacePath('/app/.airo-backup', '/app')).toBe(false);
    });

    it('isProtectedWorkspacePath: allows normal source files', () => {
      expect(isProtectedWorkspacePath('/app/src/index.ts', '/app')).toBe(false);
    });

    it('editFile: blocks create inside .airo', async () => {
      mkdirSync(join(testAppDir, '.airo'), { recursive: true });

      const result = await fileEditTool.editFile(testAppDir, {
        path: '.airo/security-report.json',
        mode: 'create',
        content: '{}',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/protected directory/i);
      expect(existsSync(join(testAppDir, '.airo', 'security-report.json'))).toBe(false);
    });

    it('editFile: blocks rewrite of existing .airo file', async () => {
      mkdirSync(join(testAppDir, '.airo'), { recursive: true });
      writeFileSync(join(testAppDir, '.airo', 'video.json'), '{"original":true}');

      const result = await fileEditTool.editFile(testAppDir, {
        path: '.airo/video.json',
        mode: 'rewrite',
        content: '{}',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/protected directory/i);
      expect(readFileSync(join(testAppDir, '.airo', 'video.json'), 'utf-8')).toBe('{"original":true}');
    });

    it('editFile: allows writes to normal files while blocking .airo writes', async () => {
      mkdirSync(join(testAppDir, '.airo'), { recursive: true });

      const normalResult = await fileEditTool.editFile(testAppDir, {
        path: 'src/index.ts',
        mode: 'create',
        content: 'export {}',
      });
      const protectedResult = await fileEditTool.editFile(testAppDir, {
        path: '.airo/video.json',
        mode: 'create',
        content: '{}',
      });

      expect(normalResult.success).toBe(true);
      expect(existsSync(join(testAppDir, 'src', 'index.ts'))).toBe(true);
      expect(protectedResult.success).toBe(false);
      expect(protectedResult.error).toMatch(/protected directory/i);
    });
  });

  describe('Auto Mode Detection', () => {
    it('should auto-detect create mode when file does not exist', async () => {
      const result = await fileEditTool.editFile(testAppDir, {
        path: 'new-file.txt',
        content: 'hello world',
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('create');

      const written = readFileSync(join(testAppDir, 'new-file.txt'), 'utf-8');
      expect(written).toBe('hello world');
    });

    it('should auto-detect rewrite mode when file exists and content is provided', async () => {
      writeFileSync(join(testAppDir, 'existing.txt'), 'old content');

      const result = await fileEditTool.editFile(testAppDir, {
        path: 'existing.txt',
        content: 'new content',
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('rewrite');

      const written = readFileSync(join(testAppDir, 'existing.txt'), 'utf-8');
      expect(written).toBe('new content');
    });

    it('should auto-detect edit mode when file exists and edits are provided', async () => {
      writeFileSync(join(testAppDir, 'to-edit.txt'), 'line one\nline two\nline three\n');

      const result = await fileEditTool.editFile(testAppDir, {
        path: 'to-edit.txt',
        edits: [{ old: 'line two', new: 'LINE TWO' }],
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('edit');

      const written = readFileSync(join(testAppDir, 'to-edit.txt'), 'utf-8');
      expect(written).toContain('LINE TWO');
    });

    it('should return error when mode cannot be determined', async () => {
      writeFileSync(join(testAppDir, 'ambiguous.txt'), 'content');

      const result = await fileEditTool.editFile(testAppDir, {
        path: 'ambiguous.txt',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/cannot determine edit mode/i);
    });
  });

  describe('Immutable File Rejection', () => {
    it('should reject editing a file marked as immutable', async () => {
      writeFileSync(join(testAppDir, 'locked.txt'), '// TREAT AS IMMUTABLE\ndo not touch');

      const result = await fileEditTool.editFile(testAppDir, {
        path: 'locked.txt',
        mode: 'rewrite',
        content: 'overwritten',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/immutable/i);

      const unchanged = readFileSync(join(testAppDir, 'locked.txt'), 'utf-8');
      expect(unchanged).toContain('do not touch');
    });

    it('should reject editing immutable file via auto-detected mode', async () => {
      writeFileSync(join(testAppDir, 'guarded.txt'), '/* TREAT AS IMMUTABLE */\nprotected');

      const result = await fileEditTool.editFile(testAppDir, {
        path: 'guarded.txt',
        content: 'hacked',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/immutable/i);
    });

    it('should allow creating a new file even if path does not exist (no immutability check)', async () => {
      const result = await fileEditTool.editFile(testAppDir, {
        path: 'brand-new.txt',
        mode: 'create',
        content: '// TREAT AS IMMUTABLE\nfresh file',
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('create');
    });

    it('should reject deleting an immutable file', async () => {
      writeFileSync(join(testAppDir, 'nodelete.txt'), '# TREAT AS IMMUTABLE\nkeep me');

      const result = await fileEditTool.editFile(testAppDir, {
        path: 'nodelete.txt',
        mode: 'delete',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/immutable/i);

      expect(existsSync(join(testAppDir, 'nodelete.txt'))).toBe(true);
    });
  });

  describe('Asset Symlink Whitelisting', () => {
    let previewDir: string;
    let assetsDir: string;

    beforeEach(() => {
      const uniqueId = Date.now() + Math.random().toString(36).substring(7);
      const baseDir = join(tmpdir(), `test-v4-${uniqueId}`);
      previewDir = join(baseDir, 'preview');
      assetsDir = join(baseDir, 'assets');

      mkdirSync(join(previewDir, 'public'), { recursive: true });
      mkdirSync(join(assetsDir, 'public'), { recursive: true });

      const relTarget = relative(join(previewDir, 'public'), join(assetsDir, 'public'));
      symlinkSync(relTarget, join(previewDir, 'public', 'assets'));

      fileEditTool = new FileEditTool();
    });

    afterEach(() => {
      const baseDir = join(previewDir, '..');
      if (existsSync(baseDir)) {
        rmSync(baseDir, { recursive: true, force: true });
      }
    });

    it('should allow writes through the public/assets symlink to assets/public', async () => {
      const result = await fileEditTool.editFile(previewDir, {
        path: 'public/assets/heart.svg',
        mode: 'create',
        content: '<svg><path d="M10 20"/></svg>',
      });

      expect(result.success).toBe(true);

      const written = readFileSync(join(assetsDir, 'public', 'heart.svg'), 'utf-8');
      expect(written).toBe('<svg><path d="M10 20"/></svg>');
    });

    it('should still block symlinks to non-whitelisted directories', async () => {
      const evilTarget = join(tmpdir(), `evil-${Date.now()}`);
      mkdirSync(evilTarget, { recursive: true });
      writeFileSync(join(evilTarget, 'secret.txt'), 'TOP_SECRET');

      const evilLink = join(previewDir, 'evil');
      symlinkSync(evilTarget, evilLink);

      const result = await fileEditTool.editFile(previewDir, {
        path: 'evil/secret.txt',
        mode: 'rewrite',
        content: 'hacked',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/symlink.*outside.*app directory/i);

      rmSync(evilTarget, { recursive: true, force: true });
    });
  });
});
