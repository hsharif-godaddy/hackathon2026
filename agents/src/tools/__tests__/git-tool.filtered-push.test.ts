// agents/src/tools/__tests__/git-tool.filtered-push.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("../../database/repositories/GitRemoteConfigRepository.js", () => ({
  GitRemoteConfigRepository: vi.fn().mockImplementation(function () { return {
    findByAppAndRemote: vi.fn().mockReturnValue({
      id: "config-1",
      repoUrl: "https://github.com/user/repo.git",
      syncEnabled: true,
    }),
    update: vi.fn(),
  }; }),
}));

// Create mock functions that we can track
const mockRemoveFiles = vi.fn();
const mockAddFiles = vi.fn();
const mockWriteTree = vi.fn();
const mockCommitTree = vi.fn();
const mockPush = vi.fn();
const mockReset = vi.fn();
const mockGetCurrentBranch = vi.fn();
const mockIsGitRepository = vi.fn();
const mockHasRemote = vi.fn();
const mockAddRemote = vi.fn();
const mockGetRemoteUrl = vi.fn();
const mockSetRemoteUrl = vi.fn();

vi.mock("../../utils/git.js", () => ({
  GitUtils: vi.fn().mockImplementation(function () { return {
    getCurrentBranch: mockGetCurrentBranch,
    isGitRepository: mockIsGitRepository,
    hasRemote: mockHasRemote,
    addRemote: mockAddRemote,
    getRemoteUrl: mockGetRemoteUrl,
    setRemoteUrl: mockSetRemoteUrl,
    // Methods for filtered push
    removeFiles: mockRemoveFiles,
    addFiles: mockAddFiles,
    writeTree: mockWriteTree,
    commitTree: mockCommitTree,
    push: mockPush,
    reset: mockReset,
  }; }),
}));

vi.mock("../../services/GitRemoteTokenManager.js", () => ({
  GitRemoteTokenManager: vi.fn().mockImplementation(function () { return {
    configureGitCredentials: vi.fn().mockResolvedValue(undefined),
    cleanupGitCredentials: vi.fn().mockResolvedValue(undefined),
  }; }),
}));

vi.mock("../../config/app-download.js", () => ({
  ALLOWED_DIRECTORIES: ["src", "public"],
  ALLOWED_CONFIG_FILES: ["package.json", "tsconfig.json", "vite.config.ts"],
}));

import { GitTool } from "../git-tool.js";
import { ALLOWED_DIRECTORIES, ALLOWED_CONFIG_FILES } from "../../config/app-download.js";

/**
 * Helper to setup the standard mock sequence for filtered push operations.
 *
 * Command sequence (using GitUtils methods):
 * 1. removeFiles(['.'], { recursive, cached, quiet }) - clear index completely
 * 2. addFiles(ALLOWED_DIRECTORIES, { ignoreErrors: true }) - add allowed dirs
 * 3. addFiles(ALLOWED_CONFIG_FILES, { ignoreErrors: true }) - add config files
 * 4. writeTree() - create tree object
 * 5. commitTree(treeHash, message) - create orphan commit
 * 6. push(remoteName, refspec, options, forcePush) - force push
 * 7. reset({ mode: 'hard', target: 'HEAD' }) - restore to clean state
 */
function setupSuccessfulPushMocks(overrides?: {
  pushResult?: { success: boolean; stdout: string; stderr: string };
}) {
  // Setup default mocks for filtered push sequence
  mockGetCurrentBranch.mockResolvedValue("main");
  mockIsGitRepository.mockResolvedValue(true);
  mockHasRemote.mockResolvedValue(false);
  mockAddRemote.mockResolvedValue({ success: true });
  mockGetRemoteUrl.mockResolvedValue("https://github.com/user/repo.git");
  mockSetRemoteUrl.mockResolvedValue({ success: true });

  // Filtered push sequence mocks
  mockRemoveFiles.mockResolvedValue({ success: true, stdout: "", stderr: "" });
  mockAddFiles.mockResolvedValue({ success: true, stdout: "", stderr: "" });
  mockWriteTree.mockResolvedValue({ success: true, stdout: "abc123tree", stderr: "" });
  mockCommitTree.mockResolvedValue({ success: true, stdout: "def456commit", stderr: "" });
  mockPush.mockResolvedValue(overrides?.pushResult ?? { success: true, stdout: "pushed", stderr: "" });
  mockReset.mockResolvedValue({ success: true, stdout: "", stderr: "" });
}

describe("GitTool - Filtered Push with Allowlist", () => {
  let gitTool: GitTool;
  let mockTasks: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTasks = {
      runCommandSync: vi.fn().mockResolvedValue({
        taskId: 'test-task-1',
        exitCode: 0,
        stdout: '',
        stderr: '',
        timedOut: false,
        executionTimeMs: 50,
      }),
      runCommand: vi.fn(),
      runCommandAsync: vi.fn(),
      get: vi.fn(),
      output: vi.fn(),
      cancel: vi.fn(),
    };

    gitTool = new GitTool(mockTasks);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("handlePush with allowlist", () => {
    it("should add allowed directories and config files using GitUtils.addFiles", async () => {
      setupSuccessfulPushMocks();

      const result = await gitTool.executeGitOperation(
        "/tmp/apps/test-app/app",
        {
          operation: "push",
          remoteName: "origin",
          branch: "main",
          repoUrl: "https://github.com/user/repo.git",
          token: "ghp_test_token",
        }
      );

      expect(result.success).toBe(true);

      // Verify addFiles was called for allowed directories with ignoreErrors
      expect(mockAddFiles).toHaveBeenCalledWith(
        "/tmp/apps/test-app/app",
        ALLOWED_DIRECTORIES,
        { ignoreErrors: true }
      );

      // Verify addFiles was called for config files with ignoreErrors
      expect(mockAddFiles).toHaveBeenCalledWith(
        "/tmp/apps/test-app/app",
        ALLOWED_CONFIG_FILES,
        { ignoreErrors: true }
      );
    });

    it("should create orphan commit using GitUtils.commitTree and force push using GitUtils.push", async () => {
      setupSuccessfulPushMocks();

      const result = await gitTool.executeGitOperation(
        "/tmp/apps/test-app/app",
        {
          operation: "push",
          remoteName: "origin",
          branch: "main",
          repoUrl: "https://github.com/user/repo.git",
          token: "ghp_test_token",
        }
      );

      expect(result.success).toBe(true);

      // Verify commitTree was called with tree hash and message (orphan commit, no parent)
      expect(mockCommitTree).toHaveBeenCalledWith(
        "/tmp/apps/test-app/app",
        "abc123tree",
        "Sync: filtered commit (allowlist)"
      );

      // Verify push was called with forcePush=true and fully-qualified refspec
      expect(mockPush).toHaveBeenCalledWith(
        "/tmp/apps/test-app/app",
        "origin",
        "def456commit:refs/heads/main",
        { timeout: 120000 },
        true  // forcePush
      );
    });

    it("should restore to clean state with GitUtils.reset({ hard: true }) after push", async () => {
      setupSuccessfulPushMocks();

      await gitTool.executeGitOperation(
        "/tmp/apps/test-app/app",
        {
          operation: "push",
          remoteName: "origin",
          branch: "main",
          repoUrl: "https://github.com/user/repo.git",
          token: "ghp_test_token",
        }
      );

      // Verify reset was called with mode: 'hard' and target: 'HEAD' for cleanup
      expect(mockReset).toHaveBeenCalledWith(
        "/tmp/apps/test-app/app",
        { mode: 'hard', target: 'HEAD' }
      );
    });

    it("should clear index using GitUtils.removeFiles before adding allowlisted files", async () => {
      setupSuccessfulPushMocks();

      await gitTool.executeGitOperation(
        "/tmp/apps/test-app/app",
        {
          operation: "push",
          remoteName: "origin",
          branch: "main",
          repoUrl: "https://github.com/user/repo.git",
          token: "ghp_test_token",
        }
      );

      // Verify removeFiles was called with options to clear the index
      expect(mockRemoveFiles).toHaveBeenCalledWith(
        "/tmp/apps/test-app/app",
        ["."],
        { recursive: true, cached: true, quiet: true }
      );

      // Verify the order: removeFiles should be called before addFiles
      const removeFilesOrder = mockRemoveFiles.mock.invocationCallOrder[0];
      const addFilesOrder = mockAddFiles.mock.invocationCallOrder[0];
      expect(removeFilesOrder).toBeLessThan(addFilesOrder);
    });

    it("should handle push failure with auth error", async () => {
      setupSuccessfulPushMocks({
        pushResult: { success: false, stdout: "", stderr: "authentication failed" }
      });

      const result = await gitTool.executeGitOperation(
        "/tmp/apps/test-app/app",
        {
          operation: "push",
          remoteName: "origin",
          branch: "main",
          repoUrl: "https://github.com/user/repo.git",
          token: "ghp_test_token",
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("authentication failed");

      // Verify reset is still called even on failure (cleanup in finally block)
      expect(mockReset).toHaveBeenCalled();
    });

    it("should handle network errors", async () => {
      setupSuccessfulPushMocks({
        pushResult: { success: false, stdout: "", stderr: "could not resolve host" }
      });

      const result = await gitTool.executeGitOperation(
        "/tmp/apps/test-app/app",
        {
          operation: "push",
          remoteName: "origin",
          branch: "main",
          repoUrl: "https://github.com/user/repo.git",
          token: "ghp_test_token",
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");

      // Verify reset is still called even on failure
      expect(mockReset).toHaveBeenCalled();
    });

    it("should use ignoreErrors option when adding files via GitUtils", async () => {
      setupSuccessfulPushMocks();

      await gitTool.executeGitOperation(
        "/tmp/apps/test-app/app",
        {
          operation: "push",
          remoteName: "origin",
          branch: "main",
          repoUrl: "https://github.com/user/repo.git",
          token: "ghp_test_token",
        }
      );

      // Verify all addFiles calls use ignoreErrors: true
      const addFilesCalls = mockAddFiles.mock.calls;
      for (const call of addFilesCalls) {
        expect(call[2]).toEqual({ ignoreErrors: true });
      }
    });

    it("should NOT include non-allowlisted directories in the push", async () => {
      setupSuccessfulPushMocks();

      await gitTool.executeGitOperation(
        "/tmp/apps/test-app/app",
        {
          operation: "push",
          remoteName: "origin",
          branch: "main",
          repoUrl: "https://github.com/user/repo.git",
          token: "ghp_test_token",
        }
      );

      // Verify NO addFiles call includes non-allowlisted directories
      const addFilesCalls = mockAddFiles.mock.calls;
      for (const call of addFilesCalls) {
        const files = call[1];
        expect(files).not.toContain("dev-tools");
        expect(files).not.toContain("source-mapper");
        expect(files).not.toContain("airo-secrets");
      }

      // Verify index is cleared first
      expect(mockRemoveFiles).toHaveBeenCalled();
    });

    it("should create tree object using GitUtils.writeTree", async () => {
      setupSuccessfulPushMocks();

      await gitTool.executeGitOperation(
        "/tmp/apps/test-app/app",
        {
          operation: "push",
          remoteName: "origin",
          branch: "main",
          repoUrl: "https://github.com/user/repo.git",
          token: "ghp_test_token",
        }
      );

      // Verify writeTree was called
      expect(mockWriteTree).toHaveBeenCalledWith("/tmp/apps/test-app/app");
    });
  });

  describe("GitUtils.removeFiles error handling", () => {
    it("should ignore any removeFiles failure and continue", async () => {
      setupSuccessfulPushMocks();

      // Override removeFiles to fail
      mockRemoveFiles.mockResolvedValueOnce({
        success: false,
        stdout: "",
        stderr: "fatal: pathspec '.' did not match any files"
      });

      const result = await gitTool.executeGitOperation(
        "/tmp/apps/test-app/app",
        {
          operation: "push",
          remoteName: "origin",
          branch: "main",
          repoUrl: "https://github.com/user/repo.git",
          token: "ghp_test_token",
        }
      );

      // Should succeed - removeFiles errors are ignored, addFiles establishes correct state
      expect(result.success).toBe(true);

      // Verify addFiles was still called after removeFiles failed
      expect(mockAddFiles).toHaveBeenCalled();
    });
  });

  describe("writeTree failure handling", () => {
    it("should return error when writeTree fails", async () => {
      setupSuccessfulPushMocks();

      // Override writeTree to fail
      mockWriteTree.mockResolvedValueOnce({
        success: false,
        stdout: "",
        stderr: "fatal: write-tree failed"
      });

      const result = await gitTool.executeGitOperation(
        "/tmp/apps/test-app/app",
        {
          operation: "push",
          remoteName: "origin",
          branch: "main",
          repoUrl: "https://github.com/user/repo.git",
          token: "ghp_test_token",
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to create tree object");

      // Verify reset is still called (cleanup in finally block)
      expect(mockReset).toHaveBeenCalled();
    });
  });

  describe("commitTree failure handling", () => {
    it("should return error when commitTree fails", async () => {
      setupSuccessfulPushMocks();

      // Override commitTree to fail
      mockCommitTree.mockResolvedValueOnce({
        success: false,
        stdout: "",
        stderr: "fatal: commit-tree failed"
      });

      const result = await gitTool.executeGitOperation(
        "/tmp/apps/test-app/app",
        {
          operation: "push",
          remoteName: "origin",
          branch: "main",
          repoUrl: "https://github.com/user/repo.git",
          token: "ghp_test_token",
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to create commit");

      // Verify reset is still called (cleanup in finally block)
      expect(mockReset).toHaveBeenCalled();
    });
  });
});
