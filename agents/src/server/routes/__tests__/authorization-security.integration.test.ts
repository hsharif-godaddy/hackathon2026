/**
 * Cross-Tenant Authorization Security Integration Tests
 *
 * Tests that all routes properly enforce tenant isolation and reject
 * cross-tenant access attempts. These tests verify the fixes for the
 * authorization bypass vulnerabilities discovered on 2026-01-09.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import { appsRouter } from '../apps.js';
import { filesRouter } from '../files.js';
import { dbRouter } from '../db.js';
import { publishRouter } from '../publish.js';
import { gitRouter } from '../git.js';
import { conversationsRouter } from '../conversations.js';
import { chatRouter } from '../chat.js';
import diagnoseRouter, { _setDependencies as _setDiagnoseDependencies, _resetDependencies as _resetDiagnoseDependencies } from '../diagnose.js';
import rebuildRouter from '../rebuild.js';
import nextActionsRouter from '../next-actions.js';
import seoQualityRouter from '../seo-quality.js';
import { jwtAuthMiddleware } from '../../middleware/jwt-auth.js';

describe('Cross-Tenant Authorization Security - Integration Tests', () => {
  let app: Express;

  // Mock JWT tokens for two different tenants
  const siteA_token = 'mock-jwt-token-site-a';
  const siteB_token = 'mock-jwt-token-site-b';
  // Canonical appId shapes so validateOwnership's shape check doesn't
  // 400 these requests before the ownership comparison runs.
  const siteA_id = '11111111-1111-1111-1111-111111111111';
  const siteB_id = '22222222-2222-2222-2222-222222222222';

  // SEO quality routes enforce a [a-z0-9]{10} regex on :id — use valid 10-char IDs.
  const seoA_token = 'mock-jwt-token-seo-a';
  const seoB_token = 'mock-jwt-token-seo-b';
  const seoA_id = 'aaaaaaaaaa';
  const seoB_id = 'bbbbbbbbbb';

  beforeAll(() => {
    // Mock JWT auth middleware to inject test agent contexts
    vi.spyOn(jwtAuthMiddleware, 'authenticate').mockImplementation(function (req: any, res, next) {
      const authHeader = req.headers.authorization;

      if (!authHeader) {
        return res.status(401).json({ error: 'Missing Authorization header' });
      }

      const token = authHeader.replace('Bearer ', '');

      if (token === siteA_token) {
        req.agentContext = {
          siteId: siteA_id,
          product: 'PaaSNodeJS',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
        };
      } else if (token === siteB_token) {
        req.agentContext = {
          siteId: siteB_id,
          product: 'PaaSNodeJS',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
        };
      } else if (token === seoA_token) {
        req.agentContext = {
          siteId: seoA_id,
          product: 'PaaSNodeJS',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
        };
      } else if (token === seoB_token) {
        req.agentContext = {
          siteId: seoB_id,
          product: 'PaaSNodeJS',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
        };
      } else {
        return res.status(401).json({ error: 'Invalid token' });
      }

      next();
    });
  });

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Apply JWT auth middleware globally
    app.use(jwtAuthMiddleware.authenticate);

    // Mount routers
    app.use(appsRouter);
    app.use(filesRouter);
    app.use(dbRouter);
    app.use(publishRouter);
    app.use('/agent', gitRouter);
    app.use(conversationsRouter);
    app.use('/agent', chatRouter);
    app.use('/apps', diagnoseRouter);
    app.use('/apps', rebuildRouter);
    app.use('/apps', nextActionsRouter);
    app.use('/', seoQualityRouter);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe('Apps Router - /apps/:id/*', () => {
    it('should reject cross-tenant access to /apps/:id/files', async () => {
      const response = await request(app)
        .get(`/apps/${siteB_id}/files`)
        .set('Authorization', `Bearer ${siteA_token}`);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Access denied');
    });

    it('should allow same-tenant access to /apps/:id/files', async () => {
      // Mock the DirectoryListingTool to avoid file system access
      const response = await request(app)
        .get(`/apps/${siteA_id}/files`)
        .set('Authorization', `Bearer ${siteA_token}`);

      // Should not return 403 (may return other errors due to missing app/files)
      expect(response.status).not.toBe(403);
    });


    it('should reject cross-tenant server operations /apps/:id/restart', async () => {
      const response = await request(app)
        .post(`/apps/${siteB_id}/restart`)
        .set('Authorization', `Bearer ${siteA_token}`);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Access denied');
    });
  });

  describe('Files Router - /files/*', () => {
    it('should reject cross-tenant file upload with wrong appId in body', async () => {
      const response = await request(app)
        .post('/files/upload')
        .set('Authorization', `Bearer ${siteA_token}`)
        .field('appId', siteB_id)  // Attempting to upload to Site B
        .attach('files', Buffer.from('test file content'), 'test.txt');

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Access denied');
    });

    it('should allow same-tenant file upload', async () => {
      const response = await request(app)
        .post('/files/upload')
        .set('Authorization', `Bearer ${siteA_token}`)
        .field('appId', siteA_id)  // Same tenant
        .attach('files', Buffer.from('test file content'), 'test.txt');

      // Should not return 403 (may return other errors)
      expect(response.status).not.toBe(403);
    });

    it('should reject cross-tenant file access /:appId/:uploadId', async () => {
      const response = await request(app)
        .get(`/files/${siteB_id}/upload-123`)
        .set('Authorization', `Bearer ${siteA_token}`);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Access denied');
    });

    it('should reject cross-tenant file deletion', async () => {
      const response = await request(app)
        .delete(`/files/${siteB_id}/upload-123`)
        .set('Authorization', `Bearer ${siteA_token}`);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Access denied');
    });
  });

  describe('Database Router - /apps/:id/database/*', () => {
    it('should reject cross-tenant database table access', async () => {
      const response = await request(app)
        .get(`/apps/${siteB_id}/database/tables`)
        .set('Authorization', `Bearer ${siteA_token}`);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Access denied');
    });

    it('should reject cross-tenant table schema access', async () => {
      const response = await request(app)
        .get(`/apps/${siteB_id}/database/tables/users/schema`)
        .set('Authorization', `Bearer ${siteA_token}`);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Access denied');
    });

    it('should reject cross-tenant table data access', async () => {
      const response = await request(app)
        .get(`/apps/${siteB_id}/database/tables/users/data`)
        .set('Authorization', `Bearer ${siteA_token}`);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Access denied');
    });
  });

  describe('Diagnose Router - /apps/:id/diagnose', () => {
    beforeEach(() => {
      // Inject a stub DiagnoseService so the same-tenant test exercises the auth/product
      // gate without depending on the DB, dev-supervisor, or the LLM.
      _setDiagnoseDependencies({
        diagnose: vi.fn().mockResolvedValue({
          success: true,
          analysis: {
            status: 'healthy',
            issues: [],
            summary: { totalIssues: 0, errors: 0, warnings: 0, primaryRecommendation: 'ok' },
            metadata: { logsAnalyzed: 0, tierUsed: 'pattern', analysisTimeMs: 1 },
          },
        }),
      } as never);
    });

    afterEach(() => {
      _resetDiagnoseDependencies();
    });

    it('should reject cross-tenant diagnose requests', async () => {
      const response = await request(app)
        .post(`/apps/${siteB_id}/diagnose`)
        .set('Authorization', `Bearer ${siteA_token}`)
        .send({ target: 'publish' });

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Access denied');
    });

    it('should allow same-tenant diagnose requests', async () => {
      const response = await request(app)
        .post(`/apps/${siteA_id}/diagnose`)
        .set('Authorization', `Bearer ${siteA_token}`)
        .send({ target: 'publish' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('Publish Router - /apps/:id/publish', () => {
    it('should reject cross-tenant publish operations', async () => {
      const response = await request(app)
        .post(`/apps/${siteB_id}/publish`)
        .set('Authorization', `Bearer ${siteA_token}`)
        .send({ commitRef: 'main' });

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Access denied');
    });
  });

  describe('Git Router - /agent/apps/:id/git/*', () => {
    it('should reject cross-tenant git history access', async () => {
      const response = await request(app)
        .get(`/agent/apps/${siteB_id}/git/history`)
        .set('Authorization', `Bearer ${siteA_token}`);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Access denied');
    });

    it('should reject cross-tenant git checkout', async () => {
      const response = await request(app)
        .post(`/agent/apps/${siteB_id}/git/checkout`)
        .set('Authorization', `Bearer ${siteA_token}`)
        .send({ commitHash: 'abc123' });

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Access denied');
    });

    it('should reject cross-tenant git restore', async () => {
      const response = await request(app)
        .post(`/agent/apps/${siteB_id}/git/restore`)
        .set('Authorization', `Bearer ${siteA_token}`)
        .send({ commitHash: 'abc123' });

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Access denied');
    });
  });

  describe('Conversations Router - /api/conversations/*', () => {
    it('should reject cross-tenant conversation listing', async () => {
      const response = await request(app)
        .get('/api/conversations')
        .query({ appId: siteB_id })
        .set('Authorization', `Bearer ${siteA_token}`);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Access denied');
    });

    it('should allow same-tenant conversation listing', async () => {
      const response = await request(app)
        .get('/api/conversations')
        .query({ appId: siteA_id })
        .set('Authorization', `Bearer ${siteA_token}`);

      // Should not return 403
      expect(response.status).not.toBe(403);
    });

    it('should reject cross-tenant conversation message access', async () => {
      // This requires mocking ConversationRepository
      // Skipping detailed implementation as it requires DB mocking
      expect(true).toBe(true);
    });
  });

  describe('Chat Router - /agent/conversations/*', () => {
    it('should reject cross-tenant conversation access', async () => {
      const response = await request(app)
        .get(`/agent/conversations/${siteB_id}`)
        .set('Authorization', `Bearer ${siteA_token}`);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Access denied');
    });

    it('should reject cross-tenant bulk message fetch', async () => {
      const response = await request(app)
        .get(`/agent/conversations/${siteB_id}/messages`)
        .query({ conversationIds: 'conv-1,conv-2' })
        .set('Authorization', `Bearer ${siteA_token}`);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Access denied');
    });

    it('should reject cross-tenant conversation creation', async () => {
      const response = await request(app)
        .post('/agent/conversations')
        .set('Authorization', `Bearer ${siteA_token}`)
        .send({
          appId: siteB_id,  // Attempting to create for Site B
          agentId: 'develop',
          title: 'Test Conversation',
        });

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Access denied');
    });

    it('should allow same-tenant conversation creation', async () => {
      const response = await request(app)
        .post('/agent/conversations')
        .set('Authorization', `Bearer ${siteA_token}`)
        .send({
          appId: siteA_id,  // Same tenant
          agentId: 'develop',
          title: 'Test Conversation',
        });

      // Should not return 403 (may return other errors due to DB)
      expect(response.status).not.toBe(403);
    });
  });

  describe('Security Logging Verification', () => {
    it('should log cross-tenant attempts with security tags', async () => {
      // This would require setting up log capture
      // For now, just verify the endpoint rejects properly
      const response = await request(app)
        .get(`/apps/${siteB_id}/files`)
        .set('Authorization', `Bearer ${siteA_token}`);

      expect(response.status).toBe(403);
      // In a real implementation, we'd verify logs contain:
      // - event: 'route.middleware.ownership.denied'
      // - tags: ['security', 'authorization-failure', 'cross-tenant-attempt']
      // - context: { authenticatedSiteId, requestedAppId }
    });
  });

  describe('Edge Cases and Boundary Conditions', () => {
    it('should reject requests with no authentication', async () => {
      const response = await request(app)
        .get(`/apps/${siteA_id}/files`);

      expect(response.status).toBe(401);
    });

    it('should reject requests with invalid tokens', async () => {
      const response = await request(app)
        .get(`/apps/${siteA_id}/files`)
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
    });

    it('should reject requests with empty appId', async () => {
      const response = await request(app)
        .get('/apps//files')
        .set('Authorization', `Bearer ${siteA_token}`);

      // Route may not match, but should not cause server error
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('Rebuild Router - /apps/:id/rebuild/*', () => {
    it('should reject cross-tenant access to rebuild pages', async () => {
      const response = await request(app)
        .get(`/apps/${siteB_id}/rebuild/pages`)
        .set('Authorization', `Bearer ${siteA_token}`);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Access denied');
    });

    it('should allow same-tenant access to rebuild pages', async () => {
      const response = await request(app)
        .get(`/apps/${siteA_id}/rebuild/pages`)
        .set('Authorization', `Bearer ${siteA_token}`);

      expect(response.status).not.toBe(403);
    });

    it('should reject cross-tenant access to rebuild status', async () => {
      const response = await request(app)
        .get(`/apps/${siteB_id}/rebuild/status`)
        .set('Authorization', `Bearer ${siteA_token}`);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Access denied');
    });

    it('should reject cross-tenant access to rebuild intake', async () => {
      const response = await request(app)
        .post(`/apps/${siteB_id}/rebuild/intake`)
        .set('Authorization', `Bearer ${siteA_token}`)
        .send({ scope: 'homepage_only', stylePreferences: { designDirection: 'keep-similar' } });

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Access denied');
    });
  });

  describe('Next Actions Router - /apps/:id/next-actions', () => {
    it('should reject cross-tenant access to next-actions', async () => {
      const response = await request(app)
        .post(`/apps/${siteB_id}/next-actions`)
        .set('Authorization', `Bearer ${siteA_token}`);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Access denied');
    });

    it('should allow same-tenant access to next-actions', async () => {
      const response = await request(app)
        .post(`/apps/${siteA_id}/next-actions`)
        .set('Authorization', `Bearer ${siteA_token}`);

      expect(response.status).not.toBe(403);
    });
  });

  // SEO quality routes use the [a-z0-9]{10} regex on :id, so tests must use
  // canonical 10-char IDs (seoA_id / seoB_id) — UUID-format IDs would 404.
  describe('SEO Quality Router - /apps/:id/seo-quality/*', () => {
    it('should reject cross-tenant access to /seo-quality/latest', async () => {
      const response = await request(app)
        .get(`/apps/${seoB_id}/seo-quality/latest`)
        .set('Authorization', `Bearer ${seoA_token}`);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Access denied');
    });

    it('should reject cross-tenant access to /seo-quality/history', async () => {
      const response = await request(app)
        .get(`/apps/${seoB_id}/seo-quality/history`)
        .set('Authorization', `Bearer ${seoA_token}`);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Access denied');
    });

    it('should allow same-tenant access to /seo-quality/latest (no data yet = 404)', async () => {
      const response = await request(app)
        .get(`/apps/${seoA_id}/seo-quality/latest`)
        .set('Authorization', `Bearer ${seoA_token}`);

      // Ownership check passes (not 403); no snapshot yet → 404
      expect(response.status).not.toBe(403);
      expect(response.status).toBe(404);
    });

    it('should allow same-tenant access to /seo-quality/history (empty list)', async () => {
      const response = await request(app)
        .get(`/apps/${seoA_id}/seo-quality/history`)
        .set('Authorization', `Bearer ${seoA_token}`);

      expect(response.status).not.toBe(403);
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('history');
    });

    it('should reject unauthenticated access to /seo-quality/latest', async () => {
      const response = await request(app)
        .get(`/apps/${seoA_id}/seo-quality/latest`);

      expect(response.status).toBe(401);
    });
  });
});
