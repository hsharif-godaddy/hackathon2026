vi.mock('fs');
vi.mock('https');

import request from 'supertest';
import { app } from '../../src/server.js';

describe('Getty Images API Integration', () => {
  const validToken = 'Bearer gd-test-token-123';
  const invalidToken = 'Bearer invalid-token';

  describe('GET /img/search', () => {
    it('should return 401 for missing authorization header', async () => {
      const response = await request(app)
        .get('/img/search?phrase=test')
        .expect(401);

      expect(response.body.error.type).toBe('invalid_request_error');
    });

    it('should return 401 for invalid token format', async () => {
      const response = await request(app)
        .get('/img/search?phrase=test')
        .set('Authorization', invalidToken)
        .expect(401);

      expect(response.body.error.type).toBe('invalid_request_error');
    });

    it('should return 400 for missing search phrase', async () => {
      const response = await request(app)
        .get('/img/search')
        .set('Authorization', validToken)
        .expect(400);

      expect(response.body.error.type).toBe('invalid_request_error');
    });

    it('should not crash when given invalid page and pageSize parameters', async () => {
      const response = await request(app)
        .get('/img/search?phrase=test&page=0&pageSize=1000')
        .set('Authorization', validToken);

      // Request gets past auth/validation, fails at Getty API (no certs in test env)
      // Note: Parameter normalization logic is tested in tests/unit/params.test.ts
      expect(response.status).toBe(503);
    });

    // Note: These tests will fail without proper SSO setup
    // In a real environment, you'd mock the SSO client
  });

});
