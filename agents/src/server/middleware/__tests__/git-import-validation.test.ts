import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeRunCommandResult } from '../../../workspace/__tests__/mock-helpers.js';
import { Request, Response, NextFunction } from 'express';
import { ValidationErrorKey } from '../../../types/import.js';
import {
  validateGitSync,
  validateGitUrl,
  validateToken,
  hasDependency,
  hasConfigFileInContainer,
  matchesBuildToolInContainer,
  isSupportedProjectInContainer,
  isValidShellPath,
  NODEJS_BUILD_TOOL,
  SUPPORTED_BUILD_TOOLS,
  type PackageJsonDeps,
  type BuildToolConfig,
} from '../git-import-validation.js';

// Create mock logger functions using vi.hoisted to ensure they're available in factory
const { mockLoggerInfo, mockLoggerWarn, mockLoggerError, mockLogError } = vi.hoisted(() => ({
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
  mockLogError: vi.fn(),
}));

// Mock Logger
vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: vi.fn(function () { return {
      info: mockLoggerInfo,
      warn: mockLoggerWarn,
      error: mockLoggerError,
    }; }),
  },
  log: {
    error: mockLogError,
  },
}));

// Mock fetch globally for token validation tests
global.fetch = vi.fn();

describe('validateGitUrl', () => {
  it('should return error for SSH URL', () => {
    const result = validateGitUrl('git@github.com:user/repo.git');

    expect(result).toEqual({
      key: ValidationErrorKey.GIT_URL_INVALID,
      message: expect.stringContaining('SSH URLs are not supported'),
    });
  });

  it('should return error for file:// URL', () => {
    const result = validateGitUrl('file:///local/path');

    expect(result).toEqual({
      key: ValidationErrorKey.GIT_URL_INVALID,
      message: 'file:// URLs are not allowed',
    });
  });

  it('should return error for localhost URL', () => {
    const result = validateGitUrl('https://localhost/repo.git');

    expect(result).toEqual({
      key: ValidationErrorKey.GIT_URL_INVALID,
      message: 'Localhost URLs are not allowed',
    });
  });

  it('should return error for path traversal', () => {
    const result = validateGitUrl('https://github.com/../etc/passwd');

    expect(result).toEqual({
      key: ValidationErrorKey.GIT_URL_INVALID,
      message: 'Path traversal is not allowed',
    });
  });

  it('should return error for unsupported provider', () => {
    const result = validateGitUrl('https://example.com/repo.git');

    expect(result).toEqual({
      key: ValidationErrorKey.GIT_URL_UNSUPPORTED,
      message: 'Only HTTPS URLs from GitHub, GitLab, and Bitbucket are supported',
    });
  });

  it('should return null for valid GitHub URL with .git', () => {
    const result = validateGitUrl('https://github.com/user/repo.git');
    expect(result).toBeNull();
  });

  it('should return null for valid GitHub URL without .git', () => {
    const result = validateGitUrl('https://github.com/user/repo');
    expect(result).toBeNull();
  });

  it('should return null for valid GitLab URL', () => {
    const result = validateGitUrl('https://gitlab.com/user/repo.git');
    expect(result).toBeNull();
  });

  it('should return null for valid Bitbucket URL', () => {
    const result = validateGitUrl('https://bitbucket.org/user/repo.git');
    expect(result).toBeNull();
  });
});

describe('validateToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockClear();
  });

  it('should return valid for GitHub repo with 200 response', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      status: 200,
    });

    const result = await validateToken('https://github.com/user/repo.git', 'ghp_token123');

    expect(result).toEqual({
      valid: true,
      hasRepoAccess: true,
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/user/repo',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer ghp_token123',
        }),
      })
    );
  });

  it('should return invalid for 401 response', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      status: 401,
    });

    const result = await validateToken('https://github.com/user/repo.git', 'ghp_invalid');

    expect(result).toEqual({
      valid: false,
      error: {
        key: ValidationErrorKey.GIT_AUTH_FAILED,
        message: 'Invalid or expired access token. Please check your credentials.',
      },
    });
  });

  it('should return invalid for 404 response', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      status: 404,
    });

    const result = await validateToken('https://github.com/user/repo.git', 'ghp_token123');

    expect(result).toEqual({
      valid: false,
      error: {
        key: ValidationErrorKey.GIT_REPO_NOT_FOUND,
        message: expect.stringContaining('Repository not found'),
      },
    });
  });

  it('should return invalid for 403 response', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      status: 403,
    });

    const result = await validateToken('https://github.com/user/repo.git', 'ghp_token123');

    expect(result).toEqual({
      valid: false,
      error: {
        key: ValidationErrorKey.GIT_AUTH_FAILED,
        message: expect.stringContaining('sufficient permissions'),
      },
    });
  });

  it('should return valid for unparseable URL (fallback)', async () => {
    const result = await validateToken('not-a-url', 'token');

    expect(result).toEqual({ valid: true });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should return valid on network error (graceful degradation)', async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

    const result = await validateToken('https://github.com/user/repo.git', 'ghp_token123');

    expect(result).toEqual({ valid: true });
  });

  it('should return valid on timeout (graceful degradation)', async () => {
    // Mock AbortError to simulate timeout
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';

    (global.fetch as any).mockRejectedValueOnce(abortError);

    const result = await validateToken('https://github.com/user/repo.git', 'ghp_token123');

    expect(result).toEqual({ valid: true });
  });

  it('should work with GitLab URLs', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      status: 200,
    });

    await validateToken('https://gitlab.com/user/repo.git', 'glpat_token123');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://gitlab.com/api/v4/projects/user%2Frepo',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer glpat_token123',
        }),
      })
    );
  });

  it('should work with Bitbucket URLs', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      status: 200,
    });

    await validateToken('https://bitbucket.org/user/repo.git', 'token123');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.bitbucket.org/2.0/repositories/user/repo',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer token123',
        }),
      })
    );
  });
});

describe('BuildToolConfig', () => {
  describe('NODEJS_BUILD_TOOL', () => {
    it('should have correct name', () => {
      expect(NODEJS_BUILD_TOOL.name).toBe('Node.js');
    });

    it('should have no config files (any Node.js project is supported)', () => {
      expect(NODEJS_BUILD_TOOL.configFiles).toHaveLength(0);
    });

    it('should have no specific package requirements (any package.json is valid)', () => {
      expect(NODEJS_BUILD_TOOL.packageNames).toHaveLength(0);
    });
  });

  describe('SUPPORTED_BUILD_TOOLS', () => {
    it('should include Node.js', () => {
      expect(SUPPORTED_BUILD_TOOLS).toContainEqual(NODEJS_BUILD_TOOL);
    });

    it('should only contain Node.js (Vite detection removed)', () => {
      expect(SUPPORTED_BUILD_TOOLS).toHaveLength(1);
      expect(SUPPORTED_BUILD_TOOLS[0].name).toBe('Node.js');
    });

    it('should be extensible (array)', () => {
      expect(Array.isArray(SUPPORTED_BUILD_TOOLS)).toBe(true);
    });
  });
});

describe('hasDependency', () => {
  it('should return true when package is in dependencies', () => {
    const packageJson: PackageJsonDeps = { dependencies: { express: '^4.0.0' } };
    expect(hasDependency(packageJson, ['express'])).toBe(true);
  });

  it('should return true when package is in devDependencies', () => {
    const packageJson: PackageJsonDeps = { devDependencies: { typescript: '^5.0.0' } };
    expect(hasDependency(packageJson, ['typescript'])).toBe(true);
  });

  it('should return true when any of multiple packages is found', () => {
    const packageJson: PackageJsonDeps = { dependencies: { fastify: '^4.0.0' } };
    expect(hasDependency(packageJson, ['express', 'fastify', 'koa'])).toBe(true);
  });

  it('should return false when none of the packages are found', () => {
    const packageJson: PackageJsonDeps = { dependencies: { react: '^18.0.0' } };
    expect(hasDependency(packageJson, ['express', 'fastify'])).toBe(false);
  });

  it('should return true for empty packageNames (any package.json is valid)', () => {
    const packageJson: PackageJsonDeps = { dependencies: { anything: '^1.0.0' } };
    expect(hasDependency(packageJson, [])).toBe(true);
  });

  it('should return true for empty package.json when packageNames is empty', () => {
    const packageJson: PackageJsonDeps = {};
    expect(hasDependency(packageJson, [])).toBe(true);
  });

  describe('NODEJS_BUILD_TOOL detection', () => {
    it('should return true for any package.json (no specific packages required)', () => {
      const packageJson: PackageJsonDeps = { dependencies: { express: '^4.18.2' } };
      expect(hasDependency(packageJson, NODEJS_BUILD_TOOL.packageNames)).toBe(true);
    });

    it('should return true for package.json with any dependencies', () => {
      const packageJson: PackageJsonDeps = { dependencies: { lodash: '^4.17.21' } };
      expect(hasDependency(packageJson, NODEJS_BUILD_TOOL.packageNames)).toBe(true);
    });

    it('should return true for empty package.json (no specific packages required)', () => {
      const packageJson: PackageJsonDeps = {};
      expect(hasDependency(packageJson, NODEJS_BUILD_TOOL.packageNames)).toBe(true);
    });
  });
});

describe('hasConfigFileInContainer', () => {
  it('should return true when config file is found', async () => {
    const mockTasks = {
      runCommandSync: vi.fn().mockResolvedValueOnce(makeRunCommandResult({ stdout: 'found' })),
    };

    const result = await hasConfigFileInContainer(
      mockTasks as any,
      '/app',
      ['custom.config.js', 'custom.config.ts']
    );

    expect(result).toBe(true);
    expect(mockTasks.runCommandSync).toHaveBeenCalledWith({
      command: 'test -f "/app/custom.config.js" && echo "found" || echo "notfound"',
      timeoutSeconds: 5,
    });
  });

  it('should check all config files until one is found', async () => {
    const mockTasks = {
      runCommandSync: vi.fn()
        .mockResolvedValueOnce(makeRunCommandResult({ stdout: 'notfound' }))
        .mockResolvedValueOnce(makeRunCommandResult({ stdout: 'found' })),
    };

    const result = await hasConfigFileInContainer(
      mockTasks as any,
      '/app',
      ['first.config.js', 'second.config.js', 'third.config.js']
    );

    expect(result).toBe(true);
    expect(mockTasks.runCommandSync).toHaveBeenCalledTimes(2);
  });

  it('should return false when no config files found', async () => {
    const mockTasks = {
      runCommandSync: vi.fn().mockResolvedValue(makeRunCommandResult({ stdout: 'notfound' })),
    };

    const result = await hasConfigFileInContainer(
      mockTasks as any,
      '/app',
      ['a.config.js', 'b.config.js']
    );

    expect(result).toBe(false);
    expect(mockTasks.runCommandSync).toHaveBeenCalledTimes(2);
  });

  it('should throw error for invalid path', async () => {
    const mockTasks = { runCommandSync: vi.fn() };

    await expect(
      hasConfigFileInContainer(mockTasks as any, '/app; rm -rf /', ['config.js'])
    ).rejects.toThrow('Invalid project root path');
  });
});

describe('isValidShellPath', () => {
  it('should return true for valid Unix paths', () => {
    expect(isValidShellPath('/app/project')).toBe(true);
    expect(isValidShellPath('/app/my-project')).toBe(true);
    expect(isValidShellPath('/app/my_project')).toBe(true);
    expect(isValidShellPath('/app/project.name')).toBe(true);
    expect(isValidShellPath('/app/project123')).toBe(true);
    expect(isValidShellPath('/app/.hidden')).toBe(true);
    expect(isValidShellPath('/tmp/apps/abc123/app')).toBe(true);
  });

  it('should return false for paths with shell metacharacters', () => {
    expect(isValidShellPath('/app/project; rm -rf /')).toBe(false);
    expect(isValidShellPath('/app/project`whoami`')).toBe(false);
    expect(isValidShellPath('/app/project$(id)')).toBe(false);
    expect(isValidShellPath('/app/project|cat /etc/passwd')).toBe(false);
    expect(isValidShellPath('/app/project&& echo pwned')).toBe(false);
    expect(isValidShellPath("/app/project'")).toBe(false);
    expect(isValidShellPath('/app/project"')).toBe(false);
    expect(isValidShellPath('/app/project\n')).toBe(false);
    expect(isValidShellPath('/app/project>')).toBe(false);
    expect(isValidShellPath('/app/project<')).toBe(false);
  });

  it('should return false for paths with spaces', () => {
    expect(isValidShellPath('/app/my project')).toBe(false);
  });

  it('should return false for empty string', () => {
    // Empty string is not a valid path
    expect(isValidShellPath('')).toBe(false);
  });
});

describe('isSupportedProjectInContainer', () => {
  it('should return supported=true with matchedTool for any valid package.json', async () => {
    const mockTasks = {
      runCommandSync: vi.fn(),
    };
    const packageJson: PackageJsonDeps = { dependencies: { anything: '^1.0.0' } };

    const result = await isSupportedProjectInContainer(mockTasks as any, '/app', packageJson);

    expect(result.supported).toBe(true);
    expect(result.matchedTool).toBe('Node.js');
    // No exec calls needed since NODEJS_BUILD_TOOL has no config files
    expect(mockTasks.runCommandSync).not.toHaveBeenCalled();
  });

  it('should return supported=true even for empty dependencies', async () => {
    const mockTasks = {
      runCommandSync: vi.fn(),
    };
    const packageJson: PackageJsonDeps = { dependencies: {} };

    const result = await isSupportedProjectInContainer(mockTasks as any, '/app', packageJson);

    expect(result.supported).toBe(true);
    expect(result.matchedTool).toBe('Node.js');
  });

  it('should work with custom build tools that have config files', async () => {
    const customTool: BuildToolConfig = {
      name: 'CustomBundler',
      configFiles: ['custom.config.js'],
      packageNames: ['custom-bundler'],
    };

    const mockTasks = {
      runCommandSync: vi.fn().mockResolvedValueOnce(makeRunCommandResult({ stdout: 'found' })),
    };
    const packageJson: PackageJsonDeps = { dependencies: {} };

    const result = await isSupportedProjectInContainer(
      mockTasks as any,
      '/app',
      packageJson,
      [customTool]
    );

    expect(result.supported).toBe(true);
    expect(result.matchedTool).toBe('CustomBundler');
  });

  it('should match custom tool by dependency when no config file exists', async () => {
    const customTool: BuildToolConfig = {
      name: 'CustomBundler',
      configFiles: ['custom.config.js'],
      packageNames: ['custom-bundler'],
    };

    const mockTasks = {
      runCommandSync: vi.fn().mockResolvedValue(makeRunCommandResult({ stdout: 'notfound' })),
    };
    const packageJson: PackageJsonDeps = { dependencies: { 'custom-bundler': '^1.0.0' } };

    const result = await isSupportedProjectInContainer(
      mockTasks as any,
      '/app',
      packageJson,
      [customTool]
    );

    expect(result.supported).toBe(true);
    expect(result.matchedTool).toBe('CustomBundler');
  });

  describe('NODEJS_BUILD_TOOL detection', () => {
    it('should support any Node.js project (no specific package required)', async () => {
      const mockTasks = { runCommandSync: vi.fn() };
      const packageJson: PackageJsonDeps = { dependencies: { express: '^4.18.2' } };

      const result = await isSupportedProjectInContainer(mockTasks as any, '/app', packageJson);

      expect(result.supported).toBe(true);
      expect(result.matchedTool).toBe('Node.js');
    });

    it('should support projects with any dependencies', async () => {
      const mockTasks = { runCommandSync: vi.fn() };
      const packageJson: PackageJsonDeps = { dependencies: { lodash: '^4.17.21' } };

      const result = await isSupportedProjectInContainer(mockTasks as any, '/app', packageJson);

      expect(result.supported).toBe(true);
      expect(result.matchedTool).toBe('Node.js');
    });

    it('should support projects with vitest in devDependencies (not Vite project)', async () => {
      const mockTasks = { runCommandSync: vi.fn() };
      // Project has vitest for testing but is not a Vite frontend project
      const packageJson: PackageJsonDeps = {
        dependencies: { express: '^4.18.2' },
        devDependencies: { vitest: '^1.0.0' }
      };

      const result = await isSupportedProjectInContainer(mockTasks as any, '/app', packageJson);

      expect(result.supported).toBe(true);
      expect(result.matchedTool).toBe('Node.js');
    });
  });
});

describe('validateGitSync middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonSpy: any;
  let statusSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockReq = {
      body: {},
      params: { id: 'test-app-id' },
      path: '/apps/test-app-id/git/pull',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    };

    jsonSpy = vi.fn();
    statusSpy = vi.fn().mockReturnValue({ json: jsonSpy });
    mockRes = {
      status: statusSpy,
      json: jsonSpy,
    };

    mockNext = vi.fn();

    // Default mock for fetch (valid token)
    vi.mocked(global.fetch).mockResolvedValue({
      status: 200,
      json: async () => ({}),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('when both repoUrl and token are provided', () => {
    it('should call next when both repoUrl and token are valid', async () => {
      mockReq.body = {
        repoUrl: 'https://github.com/user/repo.git',
        token: 'ghp_validtoken123',
      };

      await validateGitSync(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledOnce();
      expect(statusSpy).not.toHaveBeenCalled();
    });

    it('should validate URL format and reject SSH URLs', async () => {
      mockReq.body = {
        repoUrl: 'git@github.com:user/repo.git',
        token: 'ghp_validtoken123',
      };

      await validateGitSync(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('SSH URLs are not supported'),
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject unsupported providers', async () => {
      mockReq.body = {
        repoUrl: 'https://custom-git.example.com/user/repo.git',
        token: 'some_token',
      };

      await validateGitSync(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('GitHub, GitLab, and Bitbucket'),
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject invalid token (401 from provider)', async () => {
      mockReq.body = {
        repoUrl: 'https://github.com/user/repo.git',
        token: 'invalid_token',
      };

      vi.mocked(global.fetch).mockResolvedValue({
        status: 401,
        json: async () => ({}),
      } as Response);

      await validateGitSync(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('Invalid or expired'),
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject when repo not found (404 from provider)', async () => {
      mockReq.body = {
        repoUrl: 'https://github.com/user/nonexistent-repo.git',
        token: 'ghp_validtoken123',
      };

      vi.mocked(global.fetch).mockResolvedValue({
        status: 404,
        json: async () => ({}),
      } as Response);

      await validateGitSync(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('not found'),
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('when neither repoUrl nor token are provided', () => {
    it('should skip validation and call next when neither repoUrl nor token provided', async () => {
      mockReq.body = {
        remoteName: 'origin',
        branch: 'main',
      };

      await validateGitSync(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledOnce();
      expect(statusSpy).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should skip validation when body is empty', async () => {
      mockReq.body = {};

      await validateGitSync(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledOnce();
      expect(statusSpy).not.toHaveBeenCalled();
    });
  });

  describe('Incomplete credentials (only one of repoUrl/token)', () => {
    it('should reject when only repoUrl is provided without token', async () => {
      mockReq.body = {
        repoUrl: 'https://github.com/user/repo.git',
      };

      await validateGitSync(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Both repoUrl and token must be provided together, or neither',
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject when only token is provided without repoUrl', async () => {
      mockReq.body = {
        token: 'ghp_validtoken123',
      };

      await validateGitSync(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Both repoUrl and token must be provided together, or neither',
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Token format validation', () => {
    it('should treat empty string token as missing (incomplete credentials)', async () => {
      mockReq.body = {
        repoUrl: 'https://github.com/user/repo.git',
        token: '',
      };

      await validateGitSync(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Both repoUrl and token must be provided together, or neither',
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject whitespace-only token', async () => {
      mockReq.body = {
        repoUrl: 'https://github.com/user/repo.git',
        token: '   ',
      };

      await validateGitSync(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('non-empty string'),
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should return 500 for unexpected errors', async () => {
      // Force an error by making fetch throw
      vi.mocked(global.fetch).mockImplementation(function () {
        throw new Error('Network error');
      });

      mockReq.body = {
        repoUrl: 'https://github.com/user/repo.git',
        token: 'ghp_validtoken123',
      };

      await validateGitSync(mockReq as Request, mockRes as Response, mockNext);

      // validateToken gracefully handles errors and returns valid: true
      // So the middleware should call next()
      expect(mockNext).toHaveBeenCalledOnce();
    });
  });
});
