/**
 * Git Utils Unit Tests
 *
 * Tests for GitUtils class methods, particularly the pull method
 * with allowUnrelatedHistories parameter.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GitUtils } from '../git.js';

// Mock DevSupervisorClient
const createMockDevSupervisor = () => ({
  isAvailable: vi.fn().mockReturnValue(true),
  exec: vi.fn().mockResolvedValue({
    success: true,
    exit_code: 0,
    stdout: 'Already up to date.',
    stderr: ''
  })
});

describe('GitUtils', () => {
  let gitUtils: GitUtils;
  let mockDevSupervisor: ReturnType<typeof createMockDevSupervisor>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDevSupervisor = createMockDevSupervisor();
    gitUtils = new GitUtils(mockDevSupervisor as any);
  });

  describe('pull', () => {
    it('should execute git pull with -X when merge strategy specified', async () => {
      await gitUtils.pull('/app', 'origin', 'main', {}, 'theirs');

      const callArgs = mockDevSupervisor.exec.mock.calls[0][0];
      expect(callArgs.command).toContain('-X');
      expect(callArgs.command).toContain('theirs');
      expect(callArgs.command).not.toContain('--allow-unrelated-histories');
      expect(callArgs.command).not.toContain('--no-rebase');
    });

    it('should execute git pull with --no-rebase when noRebase is true', async () => {
      await gitUtils.pull('/app', 'origin', 'main', {}, 'theirs', false, true);

      const callArgs = mockDevSupervisor.exec.mock.calls[0][0];
      expect(callArgs.command).toContain('--no-rebase');
      expect(callArgs.command).toContain('-X');
      expect(callArgs.command).toContain('theirs');
    });

    it('should execute git pull with --allow-unrelated-histories when set to true', async () => {
      await gitUtils.pull('/app', 'origin', 'main', {}, 'theirs', true);

      const callArgs = mockDevSupervisor.exec.mock.calls[0][0];
      expect(callArgs.command).toContain('-X');
      expect(callArgs.command).toContain('theirs');
      expect(callArgs.command).toContain('--allow-unrelated-histories');
    });

    it('should execute git pull without --allow-unrelated-histories when set to false', async () => {
      await gitUtils.pull('/app', 'origin', 'main', {}, 'theirs', false);

      const callArgs = mockDevSupervisor.exec.mock.calls[0][0];
      expect(callArgs.command).not.toContain('--allow-unrelated-histories');
    });

    it('should execute git pull without merge strategy when not specified', async () => {
      await gitUtils.pull('/app', 'origin', 'main', {});

      expect(mockDevSupervisor.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          command: expect.stringContaining("git 'pull' 'origin' 'main'")
        })
      );

      const callArgs = mockDevSupervisor.exec.mock.calls[0][0];
      expect(callArgs.command).not.toContain('-X');
      expect(callArgs.command).not.toContain('--no-rebase');
    });

    it('should execute git pull with all options: noRebase, mergeStrategy, and allowUnrelatedHistories', async () => {
      await gitUtils.pull('/app', 'origin', 'main', {}, 'theirs', true, true);

      const callArgs = mockDevSupervisor.exec.mock.calls[0][0];
      expect(callArgs.command).toContain('--no-rebase');
      expect(callArgs.command).toContain('-X');
      expect(callArgs.command).toContain('theirs');
      expect(callArgs.command).toContain('--allow-unrelated-histories');
    });

    it('should execute git pull with allowUnrelatedHistories but without merge strategy', async () => {
      await gitUtils.pull('/app', 'origin', 'main', {}, undefined, true);

      const callArgs = mockDevSupervisor.exec.mock.calls[0][0];
      expect(callArgs.command).not.toContain('-X');
      expect(callArgs.command).toContain('--allow-unrelated-histories');
    });
  });
});
