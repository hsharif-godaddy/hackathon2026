/**
 * Publish Route Tests
 *
 * Tests JWT-based authorization for app publish operations
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { Express } from 'express';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';

// Mock dependencies BEFORE imports
const mockFindById = vi.fn();

vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(() => ({
    findById: mockFindById
  }))
}));

vi.mock('../../utils/git.js', () => ({
  GitUtils: {
    resolveCommitHash: vi.fn(),
    getCommitDetails: vi.fn(),
    createArchive: vi.fn()
  }
}));

vi.mock('../../utils/dev-supervisor-client-factory.js', () => ({
  DevSupervisorClientFactory: {
    getInstance: vi.fn(() => ({
      build: vi.fn()
    }))
  }
}));

vi.mock('../../logging/index.js', () => ({
  log: {
    forApp: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })),
    error: vi.fn()
  }
}));

// Import after mocks
const publishRouter = await import('./publish.js').then(m => m.default);

describe('Publish Route Authorization', () => {
  let app: Express;

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();

    // Setup Express app with publish router
    app = express();
    app.use(express.json());

    // Mock auth middleware - we'll set agentContext in tests
    app.use((req, res, next) => {
      // Default to no permissions unless set in test
      (req as AuthenticatedRequest).agentContext = {
        siteId: 'test-site',
        canDownload: false,
        canPublish: false,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000)
      };
      next();
    });

    app.use('/', publishRouter);
  });

  describe('JWT Permission Checks', () => {
    it('should reject publish when canPublish is false', async () => {
      const response = await request(app)
        .post('/apps/test-app-id/publish')
        .send({ commitHash: 'abc123' })
        .expect(403);

      expect(response.body).toEqual({
        error: 'Publish not allowed',
        details: 'Airo Plus subscription required to publish apps'
      });
      expect(mockFindById).not.toHaveBeenCalled();
    });

    it('should allow publish when canPublish is true', async () => {
      // Override middleware to grant permission
      app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        (req as AuthenticatedRequest).agentContext = {
          siteId: 'test-site',
          canDownload: false,
          canPublish: true,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000)
        };
        next();
      });
      app.use('/', publishRouter);

      // Mock app not found to avoid git operations
      mockFindById.mockReturnValue(null);

      const response = await request(app)
        .post('/apps/test-app-id/publish')
        .send({ commitHash: 'abc123' })
        .expect(404);

      expect(mockFindById).toHaveBeenCalledWith('test-app-id');
      expect(response.body.error).toBe('App not found');
    });

    it('should reject publish when agentContext is missing', async () => {
      app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        // No agentContext set
        next();
      });
      app.use('/', publishRouter);

      const response = await request(app)
        .post('/apps/test-app-id/publish')
        .send({ commitHash: 'abc123' })
        .expect(403);

      expect(response.body).toEqual({
        error: 'Publish not allowed',
        details: 'Airo Plus subscription required to publish apps'
      });
    });

    it('should reject publish when canPublish is undefined', async () => {
      app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        (req as AuthenticatedRequest).agentContext = {
          siteId: 'test-site',
          canDownload: false,
          canPublish: undefined as any,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000)
        };
        next();
      });
      app.use('/', publishRouter);

      const response = await request(app)
        .post('/apps/test-app-id/publish')
        .send({ commitHash: 'abc123' })
        .expect(403);

      expect(response.body.error).toBe('Publish not allowed');
    });
  });

  describe('Request Validation', () => {
    beforeEach(() => {
      // Grant permission for these tests
      app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        (req as AuthenticatedRequest).agentContext = {
          siteId: 'test-site',
          canDownload: false,
          canPublish: true,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000)
        };
        next();
      });
      app.use('/', publishRouter);
    });

    it('should return 400 when commitHash is missing', async () => {
      const response = await request(app)
        .post('/apps/test-app-id/publish')
        .send({})
        .expect(400);

      expect(response.body.error).toBe('Commit hash is required');
    });

    it('should return 404 when app does not exist', async () => {
      mockFindById.mockReturnValue(null);

      const response = await request(app)
        .post('/apps/test-app-id/publish')
        .send({ commitHash: 'abc123' })
        .expect(404);

      expect(response.body.error).toBe('App not found');
      expect(mockFindById).toHaveBeenCalledWith('test-app-id');
    });
  });

  describe('Security - Permission Bypass Prevention', () => {
    it('should not allow publish with only canDownload permission', async () => {
      app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        (req as AuthenticatedRequest).agentContext = {
          siteId: 'test-site',
          canDownload: true, // Has download but not publish
          canPublish: false,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000)
        };
        next();
      });
      app.use('/', publishRouter);

      const response = await request(app)
        .post('/apps/test-app-id/publish')
        .send({ commitHash: 'abc123' })
        .expect(403);

      expect(response.body.error).toBe('Publish not allowed');
      expect(mockFindById).not.toHaveBeenCalled();
    });

    it('should check permission before any app operations', async () => {
      // Ensure permission check happens first, even if repo throws
      mockFindById.mockImplementation(() => {
        throw new Error('Should not reach here');
      });

      const response = await request(app)
        .post('/apps/test-app-id/publish')
        .send({ commitHash: 'abc123' })
        .expect(403);

      expect(response.body.error).toBe('Publish not allowed');
      expect(mockFindById).not.toHaveBeenCalled();
    });
  });

  describe('Permission Independence', () => {
    it('should check canPublish independently from canDownload', async () => {
      // Test that publish only checks canPublish, not canDownload
      app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        (req as AuthenticatedRequest).agentContext = {
          siteId: 'test-site',
          canDownload: false, // Download denied
          canPublish: true,   // But publish allowed
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000)
        };
        next();
      });
      app.use('/', publishRouter);

      mockFindById.mockReturnValue(null);

      const response = await request(app)
        .post('/apps/test-app-id/publish')
        .send({ commitHash: 'abc123' })
        .expect(404);

      // Should succeed past permission check (404 is from app not found, not permission)
      expect(response.body.error).toBe('App not found');
    });
  });
});
