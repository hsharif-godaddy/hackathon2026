import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiroHttpError } from '@/lib/mgmt-airo';

const mockInitiateTransfer = vi.fn();
const mockGetTransferMetadata = vi.fn();
const mockCancelTransfer = vi.fn();

vi.mock('@/lib/mgmt-airo', () => ({
  AiroMgmtClient: vi.fn().mockImplementation(() => ({
    initiateTransfer: mockInitiateTransfer,
    getTransferMetadata: mockGetTransferMetadata,
    cancelTransfer: mockCancelTransfer,
  })),
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

describe('/api/apps/[id]/transfer', function transferRouteTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('POST - Initiate transfer', function postTests() {
    it('should initiate transfer successfully', async function initiateSuccess() {
      const mockResponse = {
        transferToken: 'abc123',
        appId: 'app-1',
        status: 'initiated',
        createdAt: '2026-03-04T12:00:00.000Z',
        expiresAt: '2026-03-07T12:00:00.000Z',
      };
      mockInitiateTransfer.mockResolvedValue(mockResponse);

      const { POST } = await import('../route');
      const request = new NextRequest('http://localhost:3000/api/apps/app-1/transfer', {
        method: 'POST',
        body: JSON.stringify({ targetShopperId: '12345' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request, { params: Promise.resolve({ id: 'app-1' }) });
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.transferToken).toBe('abc123');
      expect(mockInitiateTransfer).toHaveBeenCalledWith('app-1', '12345');
    });

    it('should return 400 when targetShopperId is missing', async function missingShopperId() {
      const { POST } = await import('../route');
      const request = new NextRequest('http://localhost:3000/api/apps/app-1/transfer', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request, { params: Promise.resolve({ id: 'app-1' }) });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('targetShopperId is required');
    });

    it('should return 400 for invalid JSON body', async function invalidJson() {
      const { POST } = await import('../route');
      const request = new NextRequest('http://localhost:3000/api/apps/app-1/transfer', {
        method: 'POST',
        body: 'not-json',
        headers: { 'Content-Type': 'text/plain' },
      });

      const response = await POST(request, { params: Promise.resolve({ id: 'app-1' }) });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid JSON request body');
    });

    it('should proxy AiroHttpError status codes', async function proxyError() {
      mockInitiateTransfer.mockRejectedValue(
        new AiroHttpError(404, 'Not Found', { message: 'App not found', error: 'App not found' })
      );

      const { POST } = await import('../route');
      const request = new NextRequest('http://localhost:3000/api/apps/app-1/transfer', {
        method: 'POST',
        body: JSON.stringify({ targetShopperId: '12345' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request, { params: Promise.resolve({ id: 'app-1' }) });
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('App not found');
    });

    it('should return 400 for empty request body', async function emptyBody() {
      const { POST } = await import('../route');
      const request = new NextRequest('http://localhost:3000/api/apps/app-1/transfer', {
        method: 'POST',
      });

      const response = await POST(request, { params: Promise.resolve({ id: 'app-1' }) });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid JSON request body');
    });

    it('should return 500 for unexpected errors', async function unexpectedError() {
      mockInitiateTransfer.mockRejectedValue(new Error('Network failure'));

      const { POST } = await import('../route');
      const request = new NextRequest('http://localhost:3000/api/apps/app-1/transfer', {
        method: 'POST',
        body: JSON.stringify({ targetShopperId: '12345' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request, { params: Promise.resolve({ id: 'app-1' }) });

      expect(response.status).toBe(500);
    });
  });

  describe('GET - Transfer metadata', function getTests() {
    it('should return transfer metadata', async function getMetadata() {
      const mockResponse = {
        appId: 'app-1',
        transferToken: 'abc123',
        status: 'initiated',
        createdAt: '2026-03-04T12:00:00.000Z',
        expiresAt: '2026-03-07T12:00:00.000Z',
      };
      mockGetTransferMetadata.mockResolvedValue(mockResponse);

      const { GET } = await import('../route');
      const request = new NextRequest('http://localhost:3000/api/apps/app-1/transfer');

      const response = await GET(request, { params: Promise.resolve({ id: 'app-1' }) });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.transferToken).toBe('abc123');
      expect(mockGetTransferMetadata).toHaveBeenCalledWith('app-1', undefined);
    });

    it('should pass transferToken query param', async function withToken() {
      mockGetTransferMetadata.mockResolvedValue({ status: 'initiated' });

      const { GET } = await import('../route');
      const request = new NextRequest(
        'http://localhost:3000/api/apps/app-1/transfer?transferToken=abc123'
      );

      await GET(request, { params: Promise.resolve({ id: 'app-1' }) });

      expect(mockGetTransferMetadata).toHaveBeenCalledWith('app-1', 'abc123');
    });

    it('should proxy AiroHttpError for metadata', async function metadataError() {
      mockGetTransferMetadata.mockRejectedValue(
        new AiroHttpError(404, 'Not Found', 'No transfer found')
      );

      const { GET } = await import('../route');
      const request = new NextRequest('http://localhost:3000/api/apps/app-1/transfer');

      const response = await GET(request, { params: Promise.resolve({ id: 'app-1' }) });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE - Cancel transfer', function deleteTests() {
    it('should cancel transfer successfully', async function cancelSuccess() {
      mockCancelTransfer.mockResolvedValue({
        status: 'cancelled',
        appId: 'app-1',
        message: 'Transfer cancelled',
      });

      const { DELETE } = await import('../route');
      const request = new NextRequest('http://localhost:3000/api/apps/app-1/transfer', {
        method: 'DELETE',
      });

      const response = await DELETE(request, { params: Promise.resolve({ id: 'app-1' }) });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.status).toBe('cancelled');
      expect(mockCancelTransfer).toHaveBeenCalledWith('app-1');
    });

    it('should proxy AiroHttpError for cancel', async function cancelError() {
      mockCancelTransfer.mockRejectedValue(
        new AiroHttpError(400, 'Bad Request', { message: 'Transfer not in initiated state', error: 'Transfer not in initiated state' })
      );

      const { DELETE } = await import('../route');
      const request = new NextRequest('http://localhost:3000/api/apps/app-1/transfer', {
        method: 'DELETE',
      });

      const response = await DELETE(request, { params: Promise.resolve({ id: 'app-1' }) });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Transfer not in initiated state');
    });
  });
});
