import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppContextManager } from '../AppContextManager.js';

// Mock execFileAsync
const mockExecFile = vi.fn();
vi.mock('child_process', () => ({
  execFile: (...args: any[]) => mockExecFile(...args)
}));

vi.mock('util', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    promisify: (fn: any) => (...args: any[]) => {
      // Return a promise wrapper around our mock
      return new Promise((resolve, reject) => {
        fn(...args, (err: any, result: any) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
    }
  };
});

// Mock fs.existsSync — vi.hoisted() ensures the variable is available when the
// hoisted vi.mock() factory runs, before any module-level imports execute.
const { mockExistsSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn().mockReturnValue(false),
}));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    existsSync: (...args: any[]) => mockExistsSync(...args),
  };
});

// Mock dependencies to prevent side effects
vi.mock('../../tools/directory-listing.js', () => ({
  DirectoryListingTool: vi.fn().mockImplementation(() => ({
    listDirectory: vi.fn().mockResolvedValue('')
  }))
}));

vi.mock('../../tools/app-plan-tool.js', () => ({
  appPlanTool: { execute: vi.fn().mockResolvedValue({ success: false }) }
}));

vi.mock('../../logging/index.js', () => ({
  Logger: {
    create: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }))
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock('../../logging/events/index.js', () => ({
  appContextEvents: {
    generateBegin: vi.fn(),
    generateSuccess: vi.fn(),
    generateFailure: vi.fn(),
    packageBegin: vi.fn(),
    packageSuccess: vi.fn(),
    packageFailure: vi.fn()
  }
}));

vi.mock('../../tools/secrets-management-tool.js', () => ({
  SecretsManagementTool: vi.fn()
}));

vi.mock('../../utils/dev-supervisor-client-factory.js', () => ({
  DevSupervisorClientFactory: { createForApp: vi.fn().mockReturnValue(null) }
}));

vi.mock('../MediaManifestService.js', () => ({
  mediaManifestService: { getManifest: vi.fn().mockResolvedValue({ success: false }) }
}));

vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(() => ({
    findById: vi.fn().mockReturnValue(null)
  }))
}));

describe('AppContextManager - git status', () => {
  let manager: AppContextManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AppContextManager();
  });

  describe('formatGitStatusSection', () => {
    it('returns null when gitInfo is null', () => {
      // Access private method via any cast
      const result = (manager as any).formatGitStatusSection(null);
      expect(result).toBeNull();
    });

    it('formats branch, clean status, and last commit', () => {
      const result = (manager as any).formatGitStatusSection({
        branch: 'main',
        uncommittedCount: 0,
        lastCommitHash: 'abc1234',
        lastCommitMessage: 'feat: initial commit'
      });
      expect(result).toBe(
        '## Git Status\n- Branch: main\n- Uncommitted changes: 0\n- Last commit: abc1234 feat: initial commit'
      );
    });

    it('formats with uncommitted changes count', () => {
      const result = (manager as any).formatGitStatusSection({
        branch: 'feature/test',
        uncommittedCount: 5,
        lastCommitHash: 'def5678',
        lastCommitMessage: 'wip'
      });
      expect(result).toContain('- Uncommitted changes: 5');
      expect(result).toContain('- Branch: feature/test');
    });

    it('formats detached HEAD state', () => {
      const result = (manager as any).formatGitStatusSection({
        branch: 'detached:abc1234',
        uncommittedCount: 0,
        lastCommitHash: 'abc1234',
        lastCommitMessage: 'some commit'
      });
      expect(result).toContain('- Branch: detached:abc1234');
    });

    it('omits branch line when branch is null', () => {
      const result = (manager as any).formatGitStatusSection({
        branch: null,
        uncommittedCount: 0,
        lastCommitHash: null,
        lastCommitMessage: null
      });
      expect(result).toBe('## Git Status\n- Uncommitted changes: 0');
      expect(result).not.toContain('Branch:');
      expect(result).not.toContain('Last commit:');
    });

    it('omits uncommitted changes line when uncommittedCount is null', () => {
      const result = (manager as any).formatGitStatusSection({
        branch: 'main',
        uncommittedCount: null,
        lastCommitHash: 'abc1234',
        lastCommitMessage: 'feat: initial commit'
      });
      expect(result).not.toContain('Uncommitted changes');
      expect(result).toContain('- Branch: main');
      expect(result).toContain('- Last commit: abc1234 feat: initial commit');
    });

    it('omits last commit line when no commits exist', () => {
      const result = (manager as any).formatGitStatusSection({
        branch: 'main',
        uncommittedCount: 0,
        lastCommitHash: null,
        lastCommitMessage: null
      });
      expect(result).not.toContain('Last commit:');
    });

    it('formats last commit without trailing space when message is null', () => {
      const result = (manager as any).formatGitStatusSection({
        branch: 'main',
        uncommittedCount: 0,
        lastCommitHash: 'abc1234',
        lastCommitMessage: null
      });
      expect(result).toContain('- Last commit: abc1234');
      expect(result).not.toMatch(/abc1234 $/m);
      expect(result).not.toMatch(/abc1234 \n/);
    });
  });

  describe('getGitStatusInfo', () => {
    it('returns null when git-repo directory does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await (manager as any).getGitStatusInfo('/tmp/app/preview');
      expect(result).toBeNull();
    });

    it('returns git status when repo exists with commits', async () => {
      mockExistsSync.mockReturnValue(true);

      // Mock execFile callback-style calls
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, callback: any) => {
        if (args.includes('--abbrev-ref')) {
          callback(null, { stdout: 'main\n', stderr: '' });
        } else if (args.includes('--porcelain')) {
          callback(null, { stdout: ' M file1.ts\n M file2.ts\n', stderr: '' });
        } else if (args.includes('--format=%h %s')) {
          callback(null, { stdout: 'abc1234 feat: add feature\n', stderr: '' });
        } else if (args.includes('--short')) {
          callback(null, { stdout: 'abc1234\n', stderr: '' });
        } else {
          callback(null, { stdout: '', stderr: '' });
        }
      });

      const result = await (manager as any).getGitStatusInfo('/tmp/app/preview');
      expect(result).toEqual({
        branch: 'main',
        uncommittedCount: 2,
        lastCommitHash: 'abc1234',
        lastCommitMessage: 'feat: add feature'
      });
    });

    it('handles detached HEAD state', async () => {
      mockExistsSync.mockReturnValue(true);

      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, callback: any) => {
        if (args.includes('--abbrev-ref')) {
          callback(null, { stdout: 'HEAD\n', stderr: '' });
        } else if (args.includes('--short')) {
          callback(null, { stdout: 'def5678\n', stderr: '' });
        } else if (args.includes('--porcelain')) {
          callback(null, { stdout: '', stderr: '' });
        } else if (args.includes('--format=%h %s')) {
          callback(null, { stdout: 'def5678 some commit\n', stderr: '' });
        } else {
          callback(null, { stdout: '', stderr: '' });
        }
      });

      const result = await (manager as any).getGitStatusInfo('/tmp/app/preview');
      expect(result?.branch).toBe('detached:def5678');
    });

    it('handles repo with no commits yet', async () => {
      mockExistsSync.mockReturnValue(true);

      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, callback: any) => {
        if (args.includes('--abbrev-ref') || args.includes('--format=%h %s')) {
          callback(new Error('fatal: bad default revision'), null);
        } else if (args.includes('--porcelain')) {
          callback(null, { stdout: '?? newfile.ts\n', stderr: '' });
        } else {
          callback(new Error('not found'), null);
        }
      });

      const result = await (manager as any).getGitStatusInfo('/tmp/app/preview');
      expect(result).toEqual({
        branch: null,
        uncommittedCount: 1,
        lastCommitHash: null,
        lastCommitMessage: null
      });
    });

    it('returns null when all git commands fail', async () => {
      mockExistsSync.mockReturnValue(true);

      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, callback: any) => {
        callback(new Error('git failed'), null);
      });

      const result = await (manager as any).getGitStatusInfo('/tmp/app/preview');
      expect(result).toBeNull();
    });

    it('returns null uncommittedCount when status fails but branch/log succeed', async () => {
      mockExistsSync.mockReturnValue(true);

      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, callback: any) => {
        if (args.includes('--abbrev-ref')) {
          callback(null, { stdout: 'main\n', stderr: '' });
        } else if (args.includes('--porcelain')) {
          callback(new Error('permission denied'), null);
        } else if (args.includes('--format=%h %s')) {
          callback(null, { stdout: 'abc1234 some commit\n', stderr: '' });
        } else {
          callback(null, { stdout: '', stderr: '' });
        }
      });

      const result = await (manager as any).getGitStatusInfo('/tmp/app/preview');
      expect(result).toEqual({
        branch: 'main',
        uncommittedCount: null,
        lastCommitHash: 'abc1234',
        lastCommitMessage: 'some commit'
      });
    });

    it('handles clean repo with no uncommitted changes', async () => {
      mockExistsSync.mockReturnValue(true);

      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, callback: any) => {
        if (args.includes('--abbrev-ref')) {
          callback(null, { stdout: 'main\n', stderr: '' });
        } else if (args.includes('--porcelain')) {
          callback(null, { stdout: '', stderr: '' });
        } else if (args.includes('--format=%h %s')) {
          callback(null, { stdout: 'abc1234 initial commit\n', stderr: '' });
        } else {
          callback(null, { stdout: '', stderr: '' });
        }
      });

      const result = await (manager as any).getGitStatusInfo('/tmp/app/preview');
      expect(result?.uncommittedCount).toBe(0);
    });
  });
});
