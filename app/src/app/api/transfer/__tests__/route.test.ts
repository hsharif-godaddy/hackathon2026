import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiroHttpError } from '@/lib/mgmt-airo';

const mockAcceptTransfer = vi.fn();
const mockGetTransferMetadataByToken = vi.fn();
const mockListTransfers = vi.fn();

vi.mock('@/lib/mgmt-airo', () => ({
  AiroMgmtClient: vi.fn().mockImplementation(() => ({
    acceptTransfer: mockAcceptTransfer,
    getTransferMetadataByToken: mockGetTransferMetadataByToken,
    listTransfers: mockListTransfers,
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

  describe('GET - List transfers or get metadata', function getTests() {
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

    it('should list transfers when no transferToken', async function listTransfers() {
      const mockResponse = {
        transfers: [
          {
            id: 'tr-1',
            appId: 'app-1',
            transferToken: 'abc123',
            status: 'initiated',
            sourceCustomerId: 'cust-1',
            targetCustomerId: 'cust-2',
            createdAt: '2026-03-04T12:00:00.000Z',
            expiresAt: '2026-03-07T12:00:00.000Z',
            updatedAt: '2026-03-04T12:00:00.000Z',
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
      };
      mockListTransfers.mockResolvedValue(mockResponse);

      const { GET } = await import('../route');
      const request = new NextRequest('http://localhost:3000/api/transfer?status=initiated');

      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.transfers).toHaveLength(1);
      expect(mockListTransfers).toHaveBeenCalledWith({
        appId: undefined,
        targetCustomerId: undefined,
        status: 'initiated',
        limit: undefined,
        offset: undefined,
      });
    });

    it('should pass all filter parameters', async function withFilters() {
      mockListTransfers.mockResolvedValue({ transfers: [], total: 0, limit: 5, offset: 10 });

      const { GET } = await import('../route');
      const request = new NextRequest(
        'http://localhost:3000/api/transfer?appId=app-1&status=initiated&limit=5&offset=10&targetCustomerId=cust-2'
      );

      await GET(request);

      expect(mockListTransfers).toHaveBeenCalledWith({
        appId: 'app-1',
        targetCustomerId: 'cust-2',
        status: 'initiated',
        limit: 5,
        offset: 10,
      });
    });

    it('should pass targetCustomerId from auth context when direction=incoming', async function incomingDirection() {
      mockListTransfers.mockResolvedValue({ transfers: [], total: 0, limit: 10, offset: 0 });

      const { GET } = await import('../route');
      const request = new NextRequest(
        'http://localhost:3000/api/transfer?direction=incoming&status=initiated'
      );

      await GET(request);

      expect(mockListTransfers).toHaveBeenCalledWith({
        appId: undefined,
        targetCustomerId: 'cust-123',
        status: 'initiated',
        limit: undefined,
        offset: undefined,
      });
    });

    it('should not set targetCustomerId when direction is not incoming', async function outgoingDirection() {
      mockListTransfers.mockResolvedValue({ transfers: [], total: 0, limit: 10, offset: 0 });

      const { GET } = await import('../route');
      const request = new NextRequest('http://localhost:3000/api/transfer?status=initiated');

      await GET(request);

      expect(mockListTransfers).toHaveBeenCalledWith({
        appId: undefined,
        targetCustomerId: undefined,
        status: 'initiated',
        limit: undefined,
        offset: undefined,
      });
    });

    it('should proxy AiroHttpError for list', async function listError() {
      mockListTransfers.mockRejectedValue(
        new AiroHttpError(401, 'Unauthorized', 'Invalid token')
      );

      const { GET } = await import('../route');
      const request = new NextRequest('http://localhost:3000/api/transfer');

      const response = await GET(request);

      expect(response.status).toBe(401);
    });
  });
});
