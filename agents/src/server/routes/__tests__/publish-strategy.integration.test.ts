import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

// Store original env
const originalEnv = { ...process.env };

// Mock modules before imports
vi.mock("../../../database/repositories/AppRepository.js", () => {
  const mockFindById = vi.fn().mockReturnValue({
    id: "test-app-id",
    path: "/tmp/test-app",
    publishSupervisorPath: null,
  });
  return {
    AppRepository: vi.fn().mockImplementation(() => ({
      findById: mockFindById,
    })),
  };
});

vi.mock("../../../utils/dev-supervisor-client-factory.js", () => ({
  DevSupervisorClientFactory: {
    createForApp: vi.fn().mockReturnValue({
      exec: vi
        .fn()
        .mockResolvedValue({ success: true, stdout: "", stderr: "" }),
      publish: vi
        .fn()
        .mockResolvedValue({ status: "success", version: "1.0.0" }),
    }),
    createForSocketPath: vi.fn().mockReturnValue(null),
  },
}));

vi.mock("../../../utils/git.js", () => {
  const mockGetCurrentBranch = vi.fn().mockResolvedValue("main");
  const mockGetCurrentCommit = vi
    .fn()
    .mockResolvedValue("abc1234567890123456789012345678901234567");
  const mockHasUncommittedChanges = vi.fn().mockResolvedValue(false);
  const mockGetStatus = vi.fn().mockResolvedValue({
    branch: "main",
    isClean: true,
    stagedFiles: 0,
    modifiedFiles: 0,
  });
  const mockGetCommitHistory = vi.fn().mockResolvedValue([
    { hash: "abc1234567890123456789012345678901234567", message: "test commit" },
  ]);
  const mockCreateArchive = vi
    .fn()
    .mockResolvedValue({ path: "/dist/abc123.tar.gz", commitHash: "abc123" });

  return {
    GitUtils: vi.fn().mockImplementation(() => ({
      getCurrentBranch: mockGetCurrentBranch,
      getCurrentCommit: mockGetCurrentCommit,
      hasUncommittedChanges: mockHasUncommittedChanges,
      getStatus: mockGetStatus,
      getCommitHistory: mockGetCommitHistory,
      createArchive: mockCreateArchive,
    })),
  };
});

import publishRouter from "../publish.js";
import { GitUtils } from "../../../utils/git.js";

describe("Publish Strategy Integration", () => {
  let app: express.Application;

  beforeEach(() => {
    // Set production-like environment to skip unified job / publish supervisor
    process.env.NOMAD_ALLOC_DIR = "/alloc";
    // Ensure no publish socket path (non-unified job)
    delete process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH;

    // Clear call history but keep mock implementations
    vi.clearAllMocks();

    app = express();
    app.use(express.json());

    // Mock authentication middleware
    app.use((req: any, _res, next) => {
      req.agentContext = { siteId: "test-app-id", canPublish: true };
      next();
    });

    app.use("/publish", publishRouter);
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  describe("backward compatibility", () => {
    it("uses default strategy when no deploymentStrategy provided", async () => {
      const res = await request(app)
        .post("/publish/apps/test-app-id/publish")
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify git operations were called (default behavior)
      const gitUtilsInstance = vi.mocked(GitUtils).mock.results[0]?.value;
      expect(gitUtilsInstance.getCurrentBranch).toHaveBeenCalled();
      expect(gitUtilsInstance.getCurrentCommit).toHaveBeenCalled();
    });

    it("uses default strategy when deploymentStrategy is null", async () => {
      const res = await request(app)
        .post("/publish/apps/test-app-id/publish")
        .send({ deploymentStrategy: null });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('uses default strategy when deploymentStrategy is "default"', async () => {
      const res = await request(app)
        .post("/publish/apps/test-app-id/publish")
        .send({ deploymentStrategy: "default" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("PaaS strategy", () => {
    it('skips git operations when deploymentStrategy is "paas"', async () => {
      const res = await request(app)
        .post("/publish/apps/test-app-id/publish")
        .send({ deploymentStrategy: "paas" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify commitHash is hex timestamp (12+ hex chars)
      expect(res.body.commitHash).toMatch(/^[a-f0-9]{12,}$/i);

      // Verify git operations were NOT called
      const gitUtilsInstance = vi.mocked(GitUtils).mock.results[0]?.value;
      expect(gitUtilsInstance.getCurrentBranch).not.toHaveBeenCalled();
      expect(gitUtilsInstance.getCurrentCommit).not.toHaveBeenCalled();
    });

    it("creates archive with includeSource: true for paas strategy", async () => {
      const res = await request(app)
        .post("/publish/apps/test-app-id/publish")
        .send({ deploymentStrategy: "paas" });

      expect(res.status).toBe(200);

      const gitUtilsInstance = vi.mocked(GitUtils).mock.results[0]?.value;
      expect(gitUtilsInstance.createArchive).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringMatching(/^[a-f0-9]{12,}$/i), // hex timestamp
        undefined, // targetDir is undefined when not unified job + not local dev
        { includeSource: true }
      );
    });

    it("returns 400 with BuildError details when build fails", async () => {
      // Import the mock to modify it for this test
      const { DevSupervisorClientFactory } = await import(
        "../../../utils/dev-supervisor-client-factory.js"
      );

      // Mock exec to simulate build failure
      const mockExec = vi.fn().mockResolvedValue({
        success: false,
        exit_code: 1,
        stdout: "",
        stderr: "npm ERR! Missing script: build",
      });

      vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue({
        exec: mockExec,
        publish: vi.fn(),
      } as any);

      const res = await request(app)
        .post("/publish/apps/test-app-id/publish")
        .send({ deploymentStrategy: "paas" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: "Build failed",
        details: "npm ERR! Missing script: build",
        exitCode: 1,
      });
    });

    it("returns BuildError with stdout when stderr is empty", async () => {
      const { DevSupervisorClientFactory } = await import(
        "../../../utils/dev-supervisor-client-factory.js"
      );

      const mockExec = vi.fn().mockResolvedValue({
        success: false,
        exit_code: 2,
        stdout: "Error: Cannot find module 'react'",
        stderr: "",
      });

      vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue({
        exec: mockExec,
        publish: vi.fn(),
      } as any);

      const res = await request(app)
        .post("/publish/apps/test-app-id/publish")
        .send({ deploymentStrategy: "paas" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: "Build failed",
        details: "Error: Cannot find module 'react'",
        exitCode: 2,
      });
    });
  });
});
