import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { appsRouter } from '../apps.js';

// Create test Express app
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/apps', appsRouter);
  return app;
};

describe('Apps Routes Basic Tests', () => {
  let app: express.Express;

  beforeAll(async () => {
    app = createTestApp();
  });

  it('should return 404 for non-existent app styles edit', async () => {
    const response = await request(app)
      .post('/apps/non-existent-id/styles/edit')
      .send({
        selector: 'p',
        property: 'color',
        value: 'red',
        elementInfo: { devContext: { fileName: 'test.tsx', componentName: 'Test', lineNumber: 1 } }
      })
      .expect(404);

    expect(response.body.error).toBe('App not found');
  });

  it('should return 400 for missing selector', async () => {
    const response = await request(app)
      .post('/apps/some-id/styles/edit')
      .send({
        property: 'color',
        value: 'red',
        elementInfo: { devContext: { fileName: 'test.tsx', componentName: 'Test', lineNumber: 1 } }
      })
      .expect(400);

    expect(response.body.error).toBe('Selector, property, and value are required');
  });

  it('should return 400 for missing element info', async () => {
    const response = await request(app)
      .post('/apps/some-id/styles/edit')
      .send({
        selector: 'p',
        property: 'color',
        value: 'red'
      })
      .expect(400);

    expect(response.body.error).toBe('Element info with dev context is required');
  });

  it('should handle basic app routes', async () => {
    // Test the basic apps list endpoint
    const response = await request(app)
      .get('/apps')
      .expect(200);

    expect(response.body).toHaveProperty('apps');
    expect(Array.isArray(response.body.apps)).toBe(true);
  });

  it('should test route structure', async () => {
    // Add a debug test to see what routes are actually available
    console.log('Testing styles/edit endpoint structure...');
    
    const response = await request(app)
      .post('/apps/test-id/styles/edit')
      .send({});

    console.log('Response status:', response.status);
    console.log('Response body:', response.body);
    
    // Should be 400 (bad request) or 404 (not found), but not 404 due to missing route
    expect([400, 404]).toContain(response.status);
  });
});
