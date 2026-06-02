import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiroHttpError } from '@/lib/mgmt-airo';

const mockAcceptTransfer = vi.fn();
const mockGetTransferMetadataByToken = vi.fn();

vi.mock('@/lib/mgmt-airo', () => ({
  AiroMgmtClient: vi.fn().mockImplementation(function () { return {
    acceptTransfer: mockAcceptTransfer,
    getTransferMetadataByToken: mockGetTransferMetadataByToken,
  }; }),
  AiroHttpError: class extends Error {
    status: number;
    statusText: string;
    body: any;
    constructor(status: number, statusText: string, body?: any) {
      super(statusText);
      this.status = status;
      this.statusText = statusText;
      this.body = body;
    }
  },
}));

vi.mock('@/lib/mgmt-airo/auth-error', () => ({
  mgmtAiro401Response: vi.fn(function () { return null; }),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => {
    return async (request: any, ...args: any[]) => {
      const mockAuthContext = {
        jwt: 'test-jwt-token',
        user: { customerId: 'cust-123', email: 'test@example.com' },
      };
      return handler(request, mockAuthContext, ...args);
    };
  },
}));

describe('/api/transfer', function transferRouteTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('POST - Accept transfer', function postTests() {
    it('should accept transfer successfully', async function acceptSuccess() {
      const mockResponse = {
        requestId: 'req-1',
        status: 'processing',
        hostingTransferId: 'transfer-xxx',
        message: 'App transfer accepted and in progress',
        appId: 'app-1',
      };
      mockAcceptTransfer.mockResolvedValue(mockResponse);

      const { POST } = await import('../route');
      const request = new NextRequest('http://localhost:3000/api/transfer', {
        method: 'POST',
        body: JSON.stringify({ transferToken: 'abc123' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.status).toBe('processing');
      expect(mockAcceptTransfer).toHaveBeenCalledWith('abc123');
    });

    it('should return 400 when transferToken is missing', async function missingToken() {
      const { POST } = await import('../route');
      const request = new NextRequest('http://localhost:3000/api/transfer', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('transferToken is required');
    });

    it('should return 400 for invalid JSON body', async function invalidJson() {
      const { POST } = await import('../route');
      const request = new NextRequest('http://localhost:3000/api/transfer', {
        method: 'POST',
        body: 'not-json',
        headers: { 'Content-Type': 'text/plain' },
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid JSON request body');
    });

    it('should proxy customer mismatch error', async function customerMismatch() {
      mockAcceptTransfer.mockRejectedValue(
        new AiroHttpError(400, 'Bad Request', { message: 'CUSTOMER_MISMATCH', error: 'CUSTOMER_MISMATCH' })
      );

      const { POST } = await import('../route');
      const request = new NextRequest('http://localhost:3000/api/transfer', {
        method: 'POST',
        body: JSON.stringify({ transferToken: 'abc123' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('CUSTOMER_MISMATCH');
    });

    it('should proxy expired transfer error', async function expiredTransfer() {
      mockAcceptTransfer.mockRejectedValue(
        new AiroHttpError(400, 'Bad Request', 'TRANSFER_EXPIRED')
      );

      const { POST } = await import('../route');
      const request = new NextRequest('http://localhost:3000/api/transfer', {
        method: 'POST',
        body: JSON.stringify({ transferToken: 'abc123' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it('should return 400 for empty request body', async function emptyBody() {
      const { POST } = await import('../route');
      const request = new NextRequest('http://localhost:3000/api/transfer', {
        method: 'POST',
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid JSON request body');
    });

    it('should return 500 for unexpected errors', async function unexpectedError() {
      mockAcceptTransfer.mockRejectedValue(new Error('Network failure'));

      const { POST } = await import('../route');
      const request = new NextRequest('http://localhost:3000/api/transfer', {
        method: 'POST',
        body: JSON.stringify({ transferToken: 'abc123' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
    });
  });

  describe('GET - Get transfer metadata', function getTests() {
    it('should return metadata when transferToken is provided', async function getMetadata() {
      const mockResponse = {
        appId: 'app-1',
        transferToken: 'abc123',
        status: 'initiated',
        createdAt: '2026-03-04T12:00:00.000Z',
        expiresAt: '2026-03-07T12:00:00.000Z',
      };
      mockGetTransferMetadataByToken.mockResolvedValue(mockResponse);

      const { GET } = await import('../route');
      const request = new NextRequest(
        'http://localhost:3000/api/transfer?transferToken=abc123'
      );

      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.transferToken).toBe('abc123');
      expect(mockGetTransferMetadataByToken).toHaveBeenCalledWith('abc123');
    });

    it('should return 400 when transferToken is missing', async function missingToken() {
      const { GET } = await import('../route');
      const request = new NextRequest('http://localhost:3000/api/transfer');

      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('transferToken is required');
    });

    it('should proxy AiroHttpError', async function metadataError() {
      mockGetTransferMetadataByToken.mockRejectedValue(
        new AiroHttpError(404, 'Not Found', { error: 'TRANSFER_NOT_FOUND' })
      );

      const { GET } = await import('../route');
      const request = new NextRequest(
        'http://localhost:3000/api/transfer?transferToken=invalid'
      );

      const response = await GET(request);

      expect(response.status).toBe(404);
    });

    it('should return 500 for unexpected errors', async function unexpectedError() {
      mockGetTransferMetadataByToken.mockRejectedValue(new Error('Network failure'));

      const { GET } = await import('../route');
      const request = new NextRequest(
        'http://localhost:3000/api/transfer?transferToken=abc123'
      );

      const response = await GET(request);

      expect(response.status).toBe(500);
    });
  });
});
