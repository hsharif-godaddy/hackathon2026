import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { ValidationErrorKey } from '../../../types/import.js';
import { validateGitImport, validateGitUrl, validateToken } from '../git-import-validation.js';

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
    create: vi.fn(() => ({
      info: mockLoggerInfo,
      warn: mockLoggerWarn,
      error: mockLoggerError,
    })),
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

describe('validateGitImport middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonSpy: any;
  let statusSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockClear();

    mockReq = {
      headers: { 'content-type': 'application/json' },
      body: {
        gitUrl: 'https://github.com/user/repo.git',
        gitToken: 'ghp_validtoken123',
      },
      params: { id: 'test-app-id' },
      path: '/apps/test-app-id/git/replace',
      method: 'POST',
    };

    jsonSpy = vi.fn();
    statusSpy = vi.fn().mockReturnValue({ json: jsonSpy });
    mockRes = {
      status: statusSpy,
      json: jsonSpy,
    };

    mockNext = vi.fn();

    // Default: mock successful token validation
    (global.fetch as any).mockResolvedValue({
      status: 200,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Content-Type validation', () => {
    it('should skip validation for multipart/form-data (zip upload)', async () => {
      mockReq.headers = { 'content-type': 'multipart/form-data' };

      await validateGitImport(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledOnce();
      expect(statusSpy).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should skip validation for missing content-type', async () => {
      mockReq.headers = {};

      await validateGitImport(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledOnce();
      expect(statusSpy).not.toHaveBeenCalled();
    });

    it('should process validation for application/json', async () => {
      await validateGitImport(mockReq as Request, mockRes as Response, mockNext);

      expect(global.fetch).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle case-insensitive content-type check', async () => {
      mockReq.headers = { 'content-type': 'APPLICATION/JSON' };

      await validateGitImport(mockReq as Request, mockRes as Response, mockNext);

      expect(global.fetch).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Missing parameter validation', () => {
    it('should return 400 when both gitUrl and gitToken are missing', async () => {
      mockReq.body = {};

      await validateGitImport(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith({
        success: false,
        error: 'gitUrl and gitToken are required for git import',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 when gitUrl is missing', async () => {
      mockReq.body = { gitToken: 'ghp_token123' };

      await validateGitImport(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 when gitToken is missing', async () => {
      mockReq.body = { gitUrl: 'https://github.com/user/repo.git' };

      await validateGitImport(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Token format validation', () => {
    it('should return 400 when gitToken is not a string', async () => {
      mockReq.body = {
        gitUrl: 'https://github.com/user/repo.git',
        gitToken: 12345 as any,
      };

      await validateGitImport(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith({
        success: false,
        error: 'gitToken must be a non-empty string',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 when gitToken is whitespace only', async () => {
      mockReq.body = {
        gitUrl: 'https://github.com/user/repo.git',
        gitToken: '   ',
      };

      await validateGitImport(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Git URL validation', () => {
    it('should return 400 for SSH URL', async () => {
      mockReq.body.gitUrl = 'git@github.com:user/repo.git';

      await validateGitImport(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith({
        success: false,
        error: expect.stringContaining('SSH URLs are not supported'),
        validationErrors: expect.arrayContaining([
          expect.objectContaining({
            key: ValidationErrorKey.GIT_URL_INVALID,
          }),
        ]),
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 for localhost URL', async () => {
      mockReq.body.gitUrl = 'https://localhost/repo.git';

      await validateGitImport(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 for unsupported provider', async () => {
      mockReq.body.gitUrl = 'https://example.com/repo.git';

      await validateGitImport(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith({
        success: false,
        error: expect.stringContaining('GitHub, GitLab, and Bitbucket'),
        validationErrors: expect.arrayContaining([
          expect.objectContaining({
            key: ValidationErrorKey.GIT_URL_UNSUPPORTED,
          }),
        ]),
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should accept valid GitHub URL', async () => {
      mockReq.body.gitUrl = 'https://github.com/user/repo.git';

      await validateGitImport(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusSpy).not.toHaveBeenCalled();
    });
  });

  describe('Token validation', () => {
    it('should return 400 for invalid token (401)', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        status: 401,
      });

      await validateGitImport(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith({
        success: false,
        error: expect.stringContaining('Invalid or expired access token'),
        validationErrors: expect.arrayContaining([
          expect.objectContaining({
            key: ValidationErrorKey.GIT_AUTH_FAILED,
          }),
        ]),
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 for repository not found (404)', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        status: 404,
      });

      await validateGitImport(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith({
        success: false,
        error: expect.stringContaining('Repository not found'),
        validationErrors: expect.arrayContaining([
          expect.objectContaining({
            key: ValidationErrorKey.GIT_REPO_NOT_FOUND,
          }),
        ]),
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should call next() for valid token', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        status: 200,
      });

      await validateGitImport(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledOnce();
      expect(statusSpy).not.toHaveBeenCalled();
    });
  });

  describe('Successful validation flow', () => {
    it('should complete full validation and call next()', async () => {
      mockReq.body = {
        gitUrl: 'https://github.com/user/repo.git',
        gitToken: 'ghp_validtoken123',
        gitBranch: 'main',
      };

      await validateGitImport(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledOnce();
      expect(statusSpy).not.toHaveBeenCalled();
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'route.middleware.git-import.validation.success',
        expect.any(Object)
      );
    });

    it('should log gitBranch when provided', async () => {
      mockReq.body.gitBranch = 'develop';

      await validateGitImport(mockReq as Request, mockRes as Response, mockNext);

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'route.middleware.git-import.validation.start',
        expect.objectContaining({
          gitBranch: 'develop',
        })
      );
    });
  });

  describe('Error handling', () => {
    it('should gracefully handle fetch errors and continue validation', async () => {
      // Fetch errors are caught by validateToken and degraded gracefully
      (global.fetch as any).mockImplementationOnce(() => {
        throw new Error('Unexpected error');
      });

      await validateGitImport(mockReq as Request, mockRes as Response, mockNext);

      // Should proceed with validation since token validation gracefully degrades
      expect(mockNext).toHaveBeenCalledOnce();
      expect(statusSpy).not.toHaveBeenCalled();
    });

    it('should return 500 on middleware-level error', async () => {
      // Force an error at the middleware level, not in validation functions
      const errorReq = {
        headers: { 'content-type': 'application/json' },
        get body() {
          throw new Error('Body parsing error');
        },
        params: { id: 'test-app-id' },
      };

      await validateGitImport(errorReq as unknown as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(500);
      expect(jsonSpy).toHaveBeenCalledWith({
        success: false,
        error: 'Internal server error during validation',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('URL sanitization in logs', () => {
    it('should sanitize URLs with credentials', async () => {
      mockReq.body.gitUrl = 'https://token:secret@github.com/user/repo.git';

      await validateGitImport(mockReq as Request, mockRes as Response, mockNext);

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'route.middleware.git-import.validation.start',
        expect.objectContaining({
          gitUrl: expect.stringContaining('***'),
        })
      );
    });
  });

  describe('Integration scenarios', () => {
    it('should validate complete happy path', async () => {
      mockReq.body = {
        gitUrl: 'https://github.com/user/repo.git',
        gitToken: 'ghp_validtoken123',
        gitBranch: 'main',
      };

      await validateGitImport(mockReq as Request, mockRes as Response, mockNext);

      // Verify fetch was called with correct params
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/user/repo',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer ghp_validtoken123',
          }),
        })
      );

      expect(mockNext).toHaveBeenCalledOnce();
      expect(statusSpy).not.toHaveBeenCalled();
    });

    it('should fail at URL validation before token check', async () => {
      mockReq.body.gitUrl = 'git@github.com:user/repo.git';

      await validateGitImport(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(global.fetch).not.toHaveBeenCalled(); // Should not reach token validation
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});
