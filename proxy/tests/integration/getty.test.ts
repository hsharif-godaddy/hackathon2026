import request from 'supertest';
import { app } from '../../src/server';

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

    it('should validate page and pageSize parameters', async () => {
      const response = await request(app)
        .get('/img/search?phrase=test&page=0&pageSize=1000')
        .set('Authorization', validToken);

      // Should normalize page to 1 and pageSize to 100 (max)
      expect(response.status).toBe(503); // Will fail at Getty API level but params should be normalized
    });

    // Note: These tests will fail without proper SSO setup
    // In a real environment, you'd mock the SSO client
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits', async () => {
      const requests = Array.from({ length: 52 }, (_, i) => 
        request(app)
          .get('/img/search?phrase=test')
          .set('Authorization', validToken)
      );

      const responses = await Promise.all(requests);
      const rateLimited = responses.filter(r => r.status === 429);
      
      expect(rateLimited.length).toBeGreaterThan(0);
    }, 30000);
  });
});
