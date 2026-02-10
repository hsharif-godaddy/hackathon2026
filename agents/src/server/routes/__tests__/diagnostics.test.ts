import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';

// Mock gd-auth service
vi.mock('../../../services/gd-auth-service.js', () => ({
  gdAuthService: {
    instance: {
      authenticate: vi.fn()
    }
  }
}));

import { diagnosticsRouter } from '../diagnostics.js';
import { gdAuthService } from '../../../services/gd-auth-service.js';

describe('GET /diagnostics/memory', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/diagnostics', diagnosticsRouter);
    vi.clearAllMocks();
  });

  it('should require Bearer token', async () => {
    const response = await request(app).get('/diagnostics/memory');

    expect(response.status).toBe(401);
    expect(response.body.error).toContain('JOMAX token required');
  });

  it('should reject non-Bearer authorization header', async () => {
    const response = await request(app)
      .get('/diagnostics/memory')
      .set('Authorization', 'Basic dGVzdDp0ZXN0');

    expect(response.status).toBe(401);
    expect(response.body.error).toContain('JOMAX token required');
  });

  it('should accept valid JOMAX token', async () => {
    vi.mocked(gdAuthService.instance.authenticate).mockResolvedValueOnce({
      valid: true,
      payload: {
        shopperId: 'test-shopper',
        cid: 'test-cid',
        exp: 9999999999,
        iat: 1234567890
      }
    });

    const response = await request(app)
      .get('/diagnostics/memory')
      .set('Authorization', 'Bearer valid-jomax-token');

    expect(response.status).toBe(200);
    expect(response.body.heapStats).toBeDefined();
    expect(response.body.heapSpaces).toBeDefined();
  });

  it('should reject invalid JOMAX token', async () => {
    vi.mocked(gdAuthService.instance.authenticate).mockResolvedValueOnce({
      valid: false,
      reason: 'Token expired'
    });

    const response = await request(app)
      .get('/diagnostics/memory')
      .set('Authorization', 'Bearer invalid-token');

    expect(response.status).toBe(403);
    expect(response.body.error).toContain('Invalid JOMAX token');
    expect(response.body.reason).toBe('Token expired');
  });

  it('should include all expected heap statistics', async () => {
    vi.mocked(gdAuthService.instance.authenticate).mockResolvedValueOnce({
      valid: true,
      payload: {
        shopperId: 'test-shopper',
        cid: 'test-cid',
        exp: 9999999999,
        iat: 1234567890
      }
    });

    const response = await request(app)
      .get('/diagnostics/memory')
      .set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(200);
    expect(response.body.heapStats).toHaveProperty('totalHeapSize');
    expect(response.body.heapStats).toHaveProperty('totalHeapSizeExecutable');
    expect(response.body.heapStats).toHaveProperty('totalPhysicalSize');
    expect(response.body.heapStats).toHaveProperty('totalAvailableSize');
    expect(response.body.heapStats).toHaveProperty('usedHeapSize');
    expect(response.body.heapStats).toHaveProperty('heapSizeLimit');
    expect(response.body.heapStats).toHaveProperty('mallocedMemory');
    expect(response.body.heapStats).toHaveProperty('externalMemory');
    expect(response.body.heapStats).toHaveProperty('peakMallocedMemory');

    // Verify all values are numbers
    expect(typeof response.body.heapStats.totalHeapSize).toBe('number');
    expect(typeof response.body.heapStats.usedHeapSize).toBe('number');
    expect(typeof response.body.heapStats.heapSizeLimit).toBe('number');
  });

  it('should include heap spaces array with correct structure', async () => {
    vi.mocked(gdAuthService.instance.authenticate).mockResolvedValueOnce({
      valid: true,
      payload: {
        shopperId: 'test-shopper',
        cid: 'test-cid',
        exp: 9999999999,
        iat: 1234567890
      }
    });

    const response = await request(app)
      .get('/diagnostics/memory')
      .set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(200);
    expect(response.body.heapSpaces).toBeDefined();
    expect(Array.isArray(response.body.heapSpaces)).toBe(true);
    expect(response.body.heapSpaces.length).toBeGreaterThan(0);

    // Verify first space has correct structure
    const firstSpace = response.body.heapSpaces[0];
    expect(firstSpace).toHaveProperty('name');
    expect(firstSpace).toHaveProperty('size');
    expect(firstSpace).toHaveProperty('used');
    expect(firstSpace).toHaveProperty('available');
    expect(firstSpace).toHaveProperty('physicalSize');

    // Verify types
    expect(typeof firstSpace.name).toBe('string');
    expect(typeof firstSpace.size).toBe('number');
    expect(typeof firstSpace.used).toBe('number');
    expect(typeof firstSpace.available).toBe('number');
    expect(typeof firstSpace.physicalSize).toBe('number');
  });

  it('should include memory and uptime', async () => {
    vi.mocked(gdAuthService.instance.authenticate).mockResolvedValueOnce({
      valid: true,
      payload: {
        shopperId: 'test-shopper',
        cid: 'test-cid',
        exp: 9999999999,
        iat: 1234567890
      }
    });

    const response = await request(app)
      .get('/diagnostics/memory')
      .set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(200);
    expect(response.body.memory).toBeDefined();
    expect(response.body.memory).toHaveProperty('rss');
    expect(response.body.memory).toHaveProperty('heapTotal');
    expect(response.body.memory).toHaveProperty('heapUsed');
    expect(response.body.uptime).toBeDefined();
    expect(typeof response.body.uptime).toBe('number');
    expect(response.body.timestamp).toBeDefined();
  });

  it('should include ISO timestamp', async () => {
    vi.mocked(gdAuthService.instance.authenticate).mockResolvedValueOnce({
      valid: true,
      payload: {
        shopperId: 'test-shopper',
        cid: 'test-cid',
        exp: 9999999999,
        iat: 1234567890
      }
    });

    const response = await request(app)
      .get('/diagnostics/memory')
      .set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(200);
    expect(response.body.timestamp).toBeDefined();
    expect(typeof response.body.timestamp).toBe('string');

    // Verify it's a valid ISO 8601 timestamp
    const timestamp = new Date(response.body.timestamp);
    expect(timestamp.toISOString()).toBe(response.body.timestamp);
  });

  it('should return 503 when authentication service fails to initialize', async () => {
    vi.mocked(gdAuthService.instance.authenticate).mockRejectedValueOnce(
      new Error('SSO_HOST environment variable not configured')
    );

    const response = await request(app)
      .get('/diagnostics/memory')
      .set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('Authentication service unavailable');
    // Should NOT leak internal error details
    expect(response.body.error).not.toContain('SSO_HOST');
    expect(response.body.error).not.toContain('godaddy.com');
  });
});

describe('GET /diagnostics/snapshot', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/diagnostics', diagnosticsRouter);
    vi.clearAllMocks();
  });

  it('should require Bearer token', async () => {
    const response = await request(app).get('/diagnostics/snapshot');

    expect(response.status).toBe(401);
    expect(response.body.error).toContain('JOMAX token required');
  });

  it('should reject non-Bearer authorization header', async () => {
    const response = await request(app)
      .get('/diagnostics/snapshot')
      .set('Authorization', 'Basic dGVzdDp0ZXN0');

    expect(response.status).toBe(401);
    expect(response.body.error).toContain('JOMAX token required');
  });

  it('should reject invalid JOMAX token', async () => {
    vi.mocked(gdAuthService.instance.authenticate).mockResolvedValueOnce({
      valid: false,
      reason: 'Token expired'
    });

    const response = await request(app)
      .get('/diagnostics/snapshot')
      .set('Authorization', 'Bearer invalid-token');

    expect(response.status).toBe(403);
    expect(response.body.error).toContain('Invalid JOMAX token');
    expect(response.body.reason).toBe('Token expired');
  });

  it('should generate and download heap snapshot with valid token', async () => {
    vi.mocked(gdAuthService.instance.authenticate).mockResolvedValueOnce({
      valid: true,
      payload: {
        shopperId: 'test-shopper',
        cid: 'test-cid',
        exp: 9999999999,
        iat: 1234567890
      }
    });

    const response = await request(app)
      .get('/diagnostics/snapshot')
      .set('Authorization', 'Bearer valid-jomax-token');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/octet-stream');
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="heap-snapshot-.*\.heapsnapshot"$/);

    // Response should contain binary data
    expect(response.body).toBeDefined();
    expect(Buffer.isBuffer(response.body) || typeof response.body === 'object').toBe(true);
  });

  it('should use proper filename format with timestamp', async () => {
    vi.mocked(gdAuthService.instance.authenticate).mockResolvedValueOnce({
      valid: true,
      payload: {
        shopperId: 'test-shopper',
        cid: 'test-cid',
        exp: 9999999999,
        iat: 1234567890
      }
    });

    const response = await request(app)
      .get('/diagnostics/snapshot')
      .set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(200);

    const disposition = response.headers['content-disposition'];
    expect(disposition).toMatch(/heap-snapshot-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.heapsnapshot/);
  });

  it('should include custom name in filename when provided', async () => {
    vi.mocked(gdAuthService.instance.authenticate).mockResolvedValueOnce({
      valid: true,
      payload: {
        shopperId: 'test-shopper',
        cid: 'test-cid',
        exp: 9999999999,
        iat: 1234567890
      }
    });

    const response = await request(app)
      .get('/diagnostics/snapshot?name=before-deploy')
      .set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(200);

    const disposition = response.headers['content-disposition'];
    expect(disposition).toMatch(/heap-snapshot-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-before-deploy\.heapsnapshot/);
  });

  it('should sanitize custom name to prevent directory traversal', async () => {
    vi.mocked(gdAuthService.instance.authenticate).mockResolvedValueOnce({
      valid: true,
      payload: {
        shopperId: 'test-shopper',
        cid: 'test-cid',
        exp: 9999999999,
        iat: 1234567890
      }
    });

    const response = await request(app)
      .get('/diagnostics/snapshot?name=../../etc/passwd')
      .set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(200);

    const disposition = response.headers['content-disposition'];
    // Slashes and dots should be replaced with underscores
    expect(disposition).toMatch(/heap-snapshot-.*-______etc_passwd\.heapsnapshot/);
    expect(disposition).not.toContain('../');
  });

  it('should rate limit concurrent snapshot requests', async () => {
    vi.mocked(gdAuthService.instance.authenticate).mockResolvedValue({
      valid: true,
      payload: {
        shopperId: 'test-shopper',
        cid: 'test-cid',
        exp: 9999999999,
        iat: 1234567890
      }
    });

    // Start first snapshot (will be in progress)
    const firstRequest = request(app)
      .get('/diagnostics/snapshot')
      .set('Authorization', 'Bearer valid-token');

    // Immediately start second snapshot before first completes
    const secondRequest = request(app)
      .get('/diagnostics/snapshot')
      .set('Authorization', 'Bearer valid-token');

    const [first, second] = await Promise.all([firstRequest, secondRequest]);

    // One should succeed, one should be rate limited
    const responses = [first, second];
    const successResponse = responses.find(r => r.status === 200);
    const rateLimitedResponse = responses.find(r => r.status === 429);

    expect(successResponse).toBeDefined();
    expect(rateLimitedResponse).toBeDefined();
    expect(rateLimitedResponse?.body.error).toContain('Snapshot generation already in progress');
  });

  it('should return 503 when authentication service fails to initialize', async () => {
    vi.mocked(gdAuthService.instance.authenticate).mockRejectedValueOnce(
      new Error('SSO_HOST environment variable not configured')
    );

    const response = await request(app)
      .get('/diagnostics/snapshot')
      .set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('Authentication service unavailable');
    // Should NOT leak internal error details
    expect(response.body.error).not.toContain('SSO_HOST');
    expect(response.body.error).not.toContain('godaddy.com');
  });
});
