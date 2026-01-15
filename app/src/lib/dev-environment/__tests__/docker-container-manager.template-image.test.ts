import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Test suite for DockerContainerManager template image build logic
 *
 * Covers:
 * - Docker buildx build invocation
 * - Build arguments (UID, GID, build contexts)
 * - Error handling
 * - Relies on Docker's built-in layer caching (no manual hash validation)
 */

// Mock dependencies
vi.mock('execa');

const { execa } = await import('execa');
const mockExeca = vi.mocked(execa);

describe('DockerContainerManager - Template Image Build Logic', () => {
  let DockerContainerManager: any;
  let manager: any;

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock environment
    process.env.APP_TEMPLATE_DIR = 'app-templates/v8';

    // Import after mocks are set up
    const containerModule = await import('../services/docker-container-manager.js');
    DockerContainerManager = containerModule.DockerContainerManager;

    // Get singleton instance and reset it for testing
    manager = DockerContainerManager.getInstance();

    // Mock initialization to avoid Docker checks
    (manager as any).initialized = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Docker Build Invocation', () => {
    it('should call docker buildx build with correct image name', async () => {
      // Setup
      mockExeca.mockResolvedValueOnce({ stdout: '', stderr: '' } as any);

      // Execute
      await (manager as any).ensureTemplateImage('v8', '/test/app');

      // Verify
      const buildCall = mockExeca.mock.calls.find(
        call => call[0] === 'docker' && Array.isArray(call[1]) && call[1][0] === 'buildx'
      );
      expect(buildCall).toBeDefined();
      expect(buildCall?.[1]).toContain('build');
      expect(buildCall?.[1]).toContain('-t');
      expect(buildCall?.[1]).toContain('aab-template-v8:latest');
    });

    it('should include build contexts for dev-ca, dev-supervisor, and publish', async () => {
      // Setup
      mockExeca.mockResolvedValueOnce({ stdout: '', stderr: '' } as any);

      // Execute
      await (manager as any).ensureTemplateImage('v8', '/test/app');

      // Verify
      const buildCall = mockExeca.mock.calls.find(
        call => call[0] === 'docker' && Array.isArray(call[1]) && call[1][0] === 'buildx'
      );
      const args = buildCall?.[1] as string[] | undefined;
      expect(args).toBeDefined();

      // Find all --build-context arguments
      const buildContextIndices: number[] = [];
      args?.forEach((arg, index) => {
        if (arg === '--build-context') {
          buildContextIndices.push(index);
        }
      });

      expect(buildContextIndices.length).toBeGreaterThanOrEqual(3);

      // Get all build context values
      const buildContexts = buildContextIndices.map(index => args?.[index + 1]);

      // Check for required build contexts
      expect(buildContexts.some(ctx => ctx?.match(/dev-ca=.*\.dev-ca/))).toBe(true);
      expect(buildContexts.some(ctx => ctx?.match(/dev-supervisor=.*dev-supervisor/))).toBe(true);
      expect(buildContexts.some(ctx => ctx?.match(/publish=.*publish/))).toBe(true);
    });

    it('should pass HOST_UID and HOST_GID build arguments', async () => {
      // Setup
      mockExeca.mockResolvedValueOnce({ stdout: '', stderr: '' } as any);

      // Execute
      await (manager as any).ensureTemplateImage('v8', '/test/app');

      // Verify
      const buildCall = mockExeca.mock.calls.find(
        call => call[0] === 'docker' && Array.isArray(call[1]) && call[1][0] === 'buildx'
      );
      const args = buildCall?.[1] as string[] | undefined;
      expect(args).toBeDefined();

      // Check for HOST_UID
      const uidIndex = args?.findIndex(arg => typeof arg === 'string' && arg.startsWith('HOST_UID='));
      expect(uidIndex).toBeGreaterThan(-1);

      // Check for HOST_GID
      const gidIndex = args?.findIndex(arg => typeof arg === 'string' && arg.startsWith('HOST_GID='));
      expect(gidIndex).toBeGreaterThan(-1);
    });

    it('should specify correct Dockerfile path', async () => {
      // Setup
      mockExeca.mockResolvedValueOnce({ stdout: '', stderr: '' } as any);

      // Execute
      await (manager as any).ensureTemplateImage('v8', '/test/app');

      // Verify
      const buildCall = mockExeca.mock.calls.find(
        call => call[0] === 'docker' && Array.isArray(call[1]) && call[1][0] === 'buildx'
      );
      const args = buildCall?.[1] as string[] | undefined;
      expect(args).toBeDefined();
      expect(args).toContain('-f');

      const dockerfileIndex = args?.indexOf('-f');
      if (dockerfileIndex !== undefined && dockerfileIndex !== -1) {
        expect(args?.[dockerfileIndex + 1]).toMatch(/Dockerfile\.dev$/);
      }
    });
  });

  describe('Error Handling', () => {
    it('should throw descriptive error when build fails', async () => {
      // Setup: Build command fails
      mockExeca.mockRejectedValueOnce(new Error('Docker daemon not running'));

      // Execute & Verify
      await expect((manager as any).ensureTemplateImage('v8', '/test/app'))
        .rejects.toThrow('Failed to build template image: Docker daemon not running');
    });

    it('should handle non-Error exceptions', async () => {
      // Setup: Non-standard error
      mockExeca.mockRejectedValueOnce('String error');

      // Execute & Verify
      await expect((manager as any).ensureTemplateImage('v8', '/test/app'))
        .rejects.toThrow('Failed to build template image: String error');
    });

    it('should propagate error message from execa', async () => {
      // Setup
      const buildError = new Error('Exit code 1: invalid Dockerfile syntax');
      mockExeca.mockRejectedValueOnce(buildError);

      // Execute & Verify
      await expect((manager as any).ensureTemplateImage('v8', '/test/app'))
        .rejects.toThrow('Failed to build template image: Exit code 1: invalid Dockerfile syntax');
    });
  });

  describe('Template Version Support', () => {
    it('should use correct image name for v8 template', async () => {
      // Setup
      mockExeca.mockResolvedValueOnce({ stdout: '', stderr: '' } as any);

      // Execute
      await (manager as any).ensureTemplateImage('v8', '/test/app');

      // Verify
      const buildCall = mockExeca.mock.calls.find(
        call => call[0] === 'docker' && Array.isArray(call[1]) && call[1][0] === 'buildx'
      );
      expect(buildCall?.[1]).toContain('aab-template-v8:latest');
    });
  });
});
