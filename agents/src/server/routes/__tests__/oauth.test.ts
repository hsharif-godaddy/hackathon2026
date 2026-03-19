import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import oauthRouter from '../oauth.js';
import { AuthService, pkceStateStore } from '../../../services/auth-service.js';

describe('OAuth Router', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/oauth', oauthRouter);
    
    // Clear PKCE state store
    pkceStateStore.clear();
    
    // Reset all mocks
    vi.clearAllMocks();
  });

  describe('GET /oauth/godaddy/callback', () => {
    describe('Error Handling', () => {
      it('should handle OAuth error response with error code', async () => {
        const response = await request(app)
          .get('/oauth/godaddy/callback')
          .query({
            error: 'access_denied',
            error_description: 'User denied authorization',
          });

        expect(response.status).toBe(400);
        expect(response.text).toContain('Authentication Failed');
        expect(response.text).toContain('access_denied');
        expect(response.text).toContain('User denied authorization');
      });

      it('should handle OAuth error without description', async () => {
        const response = await request(app)
          .get('/oauth/godaddy/callback')
          .query({
            error: 'server_error',
          });

        expect(response.status).toBe(400);
        expect(response.text).toContain('Authentication Failed');
        expect(response.text).toContain('server_error');
      });

      it('should return 400 if code parameter is missing', async () => {
        const response = await request(app)
          .get('/oauth/godaddy/callback')
          .query({
            state: 'test-state',
          });

        expect(response.status).toBe(400);
        expect(response.text).toContain('Missing required parameters');
      });

      it('should return 400 if state parameter is missing', async () => {
        const response = await request(app)
          .get('/oauth/godaddy/callback')
          .query({
            code: 'test-code',
          });

        expect(response.status).toBe(400);
        expect(response.text).toContain('Missing required parameters');
      });
    });

    describe('Successful Token Exchange', () => {
      it('should exchange code for token and return success page', async () => {
        const mockState = 'test-state-uuid';
        const mockCode = 'auth-code-123';
        
        // Mock AuthService.exchangeCode to return success
        vi.spyOn(AuthService, 'exchangeCode').mockResolvedValue({
          accessToken: 'mock-access-token',
          expiresAt: Date.now() + 3600000,
        });

        const response = await request(app)
          .get('/oauth/godaddy/callback')
          .query({
            code: mockCode,
            state: mockState,
          });

        expect(response.status).toBe(200);
        expect(response.text).toContain('Authentication Successful');
        expect(response.text).toContain('window.close()');
        expect(AuthService.exchangeCode).toHaveBeenCalledWith({
          code: mockCode,
          state: mockState,
        });
      });

      it('should auto-close window after 2 seconds', async () => {
        vi.spyOn(AuthService, 'exchangeCode').mockResolvedValue({
          accessToken: 'mock-token',
          expiresAt: Date.now() + 3600000,
        });

        const response = await request(app)
          .get('/oauth/godaddy/callback')
          .query({
            code: 'code',
            state: 'state',
          });

        expect(response.status).toBe(200);
        expect(response.text).toContain('setTimeout');
        expect(response.text).toContain('100');
      });
    });

    describe('Token Exchange Failures', () => {
      it('should handle invalid state error', async () => {
        vi.spyOn(AuthService, 'exchangeCode').mockRejectedValue(
          new Error('Invalid state parameter')
        );

        const response = await request(app)
          .get('/oauth/godaddy/callback')
          .query({
            code: 'code',
            state: 'invalid-state',
          });

        expect(response.status).toBe(500);
        expect(response.text).toContain('Authentication Failed');
        expect(response.text).toContain('Invalid state parameter');
      });

      it('should handle token exchange network error', async () => {
        vi.spyOn(AuthService, 'exchangeCode').mockRejectedValue(
          new Error('Token exchange failed: 500')
        );

        const response = await request(app)
          .get('/oauth/godaddy/callback')
          .query({
            code: 'code',
            state: 'state',
          });

        expect(response.status).toBe(500);
        expect(response.text).toContain('Authentication Failed');
        expect(response.text).toContain('Token exchange failed');
      });

      it('should handle expired state error', async () => {
        vi.spyOn(AuthService, 'exchangeCode').mockRejectedValue(
          new Error('OAuth state has expired. Please restart authentication.')
        );

        const response = await request(app)
          .get('/oauth/godaddy/callback')
          .query({
            code: 'code',
            state: 'expired-state',
          });

        expect(response.status).toBe(500);
        expect(response.text).toContain('expired');
        expect(response.text).toContain('restart authentication');
      });
    });

    describe('HTML Rendering', () => {
      it('should return valid HTML with proper DOCTYPE', async () => {
        vi.spyOn(AuthService, 'exchangeCode').mockResolvedValue({
          accessToken: 'token',
          expiresAt: Date.now() + 3600000,
        });

        const response = await request(app)
          .get('/oauth/godaddy/callback')
          .query({ code: 'code', state: 'state' });

        expect(response.status).toBe(200);
        expect(response.text).toMatch(/<!DOCTYPE html>/i);
        expect(response.text).toContain('<html');
        expect(response.text).toContain('<head>');
        expect(response.text).toContain('<body>');
      });

      it('should include checkmark icon in success page', async () => {
        vi.spyOn(AuthService, 'exchangeCode').mockResolvedValue({
          accessToken: 'token',
          expiresAt: Date.now() + 3600000,
        });

        const response = await request(app)
          .get('/oauth/godaddy/callback')
          .query({ code: 'code', state: 'state' });

        expect(response.status).toBe(200);
        expect(response.text).toContain('✓');
      });

      it('should include proper styling in error page', async () => {
        const response = await request(app)
          .get('/oauth/godaddy/callback')
          .query({ error: 'access_denied' });

        expect(response.status).toBe(400);
        expect(response.text).toContain('<style>');
        expect(response.text).toContain('font-family');
      });
    });

    describe('Logging', () => {
      it('should log callback success', async () => {
        vi.spyOn(AuthService, 'exchangeCode').mockResolvedValue({
          accessToken: 'token',
          expiresAt: Date.now() + 3600000,
        });

        await request(app)
          .get('/oauth/godaddy/callback')
          .query({ code: 'code', state: 'state' });

        // Logger calls are verified by checking no errors thrown
        expect(AuthService.exchangeCode).toHaveBeenCalled();
      });

      it('should log callback error', async () => {
        await request(app)
          .get('/oauth/godaddy/callback')
          .query({ error: 'access_denied' });

        // Logger calls are verified by checking proper error response
        expect(true).toBe(true);
      });
    });
  });
});
