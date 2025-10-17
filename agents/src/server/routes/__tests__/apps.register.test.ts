import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { appsRouter } from '../apps.js';

const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/apps', appsRouter);
  return app;
};

describe('POST /apps/register - Validation Tests', () => {
  let app: express.Express;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    app = createTestApp();
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Basic validation', () => {
    it('should return 400 when siteId is missing', async () => {
      const response = await request(app)
        .post('/apps/register')
        .send({})
        .expect(400);

      expect(response.body.error).toBe('siteId is required and must be a non-empty string');
    });

    it('should return 400 when siteId is not a string', async () => {
      const response = await request(app)
        .post('/apps/register')
        .send({ siteId: 123 })
        .expect(400);

      expect(response.body.error).toBe('siteId is required and must be a non-empty string');
    });

    it('should return 400 when siteId is empty string', async () => {
      const response = await request(app)
        .post('/apps/register')
        .send({ siteId: '' })
        .expect(400);

      expect(response.body.error).toBe('siteId is required and must be a non-empty string');
    });

    it('should return 400 when siteId is only whitespace', async () => {
      const response = await request(app)
        .post('/apps/register')
        .send({ siteId: '   ' })
        .expect(400);

      expect(response.body.error).toBe('siteId is required and must be a non-empty string');
    });
  });

  describe('Name validation', () => {
    it('should return 400 when name is not a string', async () => {
      const response = await request(app)
        .post('/apps/register')
        .send({ siteId: 'test-site-123', name: 123 })
        .expect(400);

      expect(response.body.error).toBe('name must be a non-empty string if provided');
    });

    it('should return 400 when name is empty string', async () => {
      const response = await request(app)
        .post('/apps/register')
        .send({ siteId: 'test-site-123', name: '' })
        .expect(400);

      expect(response.body.error).toBe('name must be a non-empty string if provided');
    });

    it('should return 400 when name is only whitespace', async () => {
      const response = await request(app)
        .post('/apps/register')
        .send({ siteId: 'test-site-123', name: '   ' })
        .expect(400);

      expect(response.body.error).toBe('name must be a non-empty string if provided');
    });

    it('should accept valid name', async () => {
      const response = await request(app)
        .post('/apps/register')
        .send({ siteId: 'test-site-123', name: 'My Test App' });

      expect(response.status).not.toBe(400);
      expect(response.body.error).not.toBe('name must be a non-empty string if provided');
    });
  });

  describe('AppPath validation', () => {
    it('should return 400 when appPath is not a string', async () => {
      const response = await request(app)
        .post('/apps/register')
        .send({ siteId: 'test-site-123', appPath: 123 })
        .expect(400);

      expect(response.body.error).toBe('appPath must be a non-empty string if provided');
    });

    it('should return 400 when appPath is empty string', async () => {
      const response = await request(app)
        .post('/apps/register')
        .send({ siteId: 'test-site-123', appPath: '' })
        .expect(400);

      expect(response.body.error).toBe('appPath must be a non-empty string if provided');
    });

    it('should return 400 when appPath is only whitespace', async () => {
      const response = await request(app)
        .post('/apps/register')
        .send({ siteId: 'test-site-123', appPath: '   ' })
        .expect(400);

      expect(response.body.error).toBe('appPath must be a non-empty string if provided');
    });
  });

  describe('Port validation', () => {
    it('should return 400 when port is not a number', async () => {
      const response = await request(app)
        .post('/apps/register')
        .send({ siteId: 'test-site-123', port: 'not-a-number' })
        .expect(400);

      expect(response.body.error).toBe('port must be a valid port number (1-65535) if provided');
    });

    it('should return 400 when port is less than 1', async () => {
      const response = await request(app)
        .post('/apps/register')
        .send({ siteId: 'test-site-123', port: 0 })
        .expect(400);

      expect(response.body.error).toBe('port must be a valid port number (1-65535) if provided');
    });

    it('should return 400 when port is greater than 65535', async () => {
      const response = await request(app)
        .post('/apps/register')
        .send({ siteId: 'test-site-123', port: 65536 })
        .expect(400);

      expect(response.body.error).toBe('port must be a valid port number (1-65535) if provided');
    });

    it('should accept valid port number', async () => {
      const response = await request(app)
        .post('/apps/register')
        .send({ siteId: 'test-site-123', port: 3000 });

      expect(response.status).not.toBe(400);
      expect(response.body.error).not.toBe('port must be a valid port number (1-65535) if provided');
    });
  });

  describe('InitialPrompt validation', () => {
    it('should return 400 when initialPrompt is not a string', async () => {
      const response = await request(app)
        .post('/apps/register')
        .send({ siteId: 'test-site-123', initialPrompt: 123 })
        .expect(400);

      expect(response.body.error).toBe('initialPrompt must be a string if provided');
    });

    it('should accept empty initialPrompt string', async () => {
      const response = await request(app)
        .post('/apps/register')
        .send({ siteId: 'test-site-123', initialPrompt: '' });

      expect(response.status).not.toBe(400);
      expect(response.body.error).not.toBe('initialPrompt must be a string if provided');
    });
  });

  describe('SITE_ID environment variable enforcement', () => {
    it('should return 403 when SITE_ID is set and does not match', async () => {
      process.env.SITE_ID = 'locked-site-id';

      const response = await request(app)
        .post('/apps/register')
        .send({ siteId: 'different-site-id' })
        .expect(403);

      expect(response.body.error).toBe('Site ID mismatch');
      expect(response.body.message).toBe('This agent is locked to a specific site and cannot register other sites');
    });

    it('should accept when SITE_ID is set and matches', async () => {
      process.env.SITE_ID = 'locked-site-id';

      const response = await request(app)
        .post('/apps/register')
        .send({ siteId: 'locked-site-id' });

      expect(response.status).not.toBe(403);
      expect(response.body.error).not.toBe('Site ID mismatch');
    });

    it('should accept any siteId when SITE_ID is not set', async () => {
      delete process.env.SITE_ID;

      const response = await request(app)
        .post('/apps/register')
        .send({ siteId: 'any-site-id' });

      expect(response.status).not.toBe(403);
      expect(response.body.error).not.toBe('Site ID mismatch');
    });

    it('should trim siteId before checking against SITE_ID', async () => {
      process.env.SITE_ID = 'locked-site-id';

      const response = await request(app)
        .post('/apps/register')
        .send({ siteId: '  locked-site-id  ' });

      expect(response.status).not.toBe(403);
      expect(response.body.error).not.toBe('Site ID mismatch');
    });
  });

  describe('CUSTOMER_APP_DIR environment variable enforcement', () => {
    it('should return 403 when CUSTOMER_APP_DIR is set and appPath does not match', async () => {
      process.env.CUSTOMER_APP_DIR = '/locked/app/path';

      const response = await request(app)
        .post('/apps/register')
        .send({ 
          siteId: 'test-site-123',
          appPath: '/different/app/path'
        })
        .expect(403);

      expect(response.body.error).toBe('App path mismatch');
      expect(response.body.message).toBe('This agent is locked to a specific app directory');
    });

    it('should accept when CUSTOMER_APP_DIR is set and appPath matches', async () => {
      process.env.CUSTOMER_APP_DIR = '/locked/app/path';

      const response = await request(app)
        .post('/apps/register')
        .send({ 
          siteId: 'test-site-123',
          appPath: '/locked/app/path'
        });

      expect(response.status).not.toBe(403);
      expect(response.body.error).not.toBe('App path mismatch');
    });

    it('should return 403 when CUSTOMER_APP_DIR is set but appPath is not provided (default path will not match)', async () => {
      process.env.CUSTOMER_APP_DIR = '/locked/app/path';

      const response = await request(app)
        .post('/apps/register')
        .send({ siteId: 'test-site-123' })
        .expect(403);

      expect(response.body.error).toBe('App path mismatch');
      expect(response.body.message).toBe('This agent is locked to a specific app directory');
    });

    it('should accept any appPath when CUSTOMER_APP_DIR is not set', async () => {
      delete process.env.CUSTOMER_APP_DIR;

      const response = await request(app)
        .post('/apps/register')
        .send({ 
          siteId: 'test-site-123',
          appPath: '/any/app/path'
        });

      expect(response.status).not.toBe(403);
      expect(response.body.error).not.toBe('App path mismatch');
    });

    it('should trim appPath before checking against CUSTOMER_APP_DIR', async () => {
      process.env.CUSTOMER_APP_DIR = '/locked/app/path';

      const response = await request(app)
        .post('/apps/register')
        .send({ 
          siteId: 'test-site-123',
          appPath: '  /locked/app/path  '
        });

      expect(response.status).not.toBe(403);
      expect(response.body.error).not.toBe('App path mismatch');
    });
  });

  describe('Combined environment variable enforcement', () => {
    it('should enforce both SITE_ID and CUSTOMER_APP_DIR when both are set', async () => {
      process.env.SITE_ID = 'locked-site-id';
      process.env.CUSTOMER_APP_DIR = '/locked/app/path';

      const response = await request(app)
        .post('/apps/register')
        .send({ 
          siteId: 'different-site-id',
          appPath: '/different/app/path'
        })
        .expect(403);

      expect(response.body.error).toBe('Site ID mismatch');
    });

    it('should accept when both SITE_ID and CUSTOMER_APP_DIR match', async () => {
      process.env.SITE_ID = 'locked-site-id';
      process.env.CUSTOMER_APP_DIR = '/locked/app/path';

      const response = await request(app)
        .post('/apps/register')
        .send({ 
          siteId: 'locked-site-id',
          appPath: '/locked/app/path'
        });

      expect(response.status).not.toBe(403);
    });
  });
});
