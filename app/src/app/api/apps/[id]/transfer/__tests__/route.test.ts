import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAgentFetch = vi.fn();
const mockGetSite = vi.fn();
const mockInitiateTransfer = vi.fn();
const mockGetTransferMetadata = vi.fn();
const mockCancelTransfer = vi.fn();
const mockUnpublishApp = vi.fn();
const mockCreateToken = vi.fn();

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: (...args: any[]) => mockAgentFetch(...args),
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: () => ({
    getSite: (...args: any[]) => mockGetSite(...args),
  }),
}));

vi.mock('@/lib/mgmt-airo', () => ({
  AiroMgmtClient: class {
    initiateTransfer(...args: any[]) { return mockInitiateTransfer(...args); }
    getTransferMetadata(...args: any[]) { return mockGetTransferMetadata(...args); }
    cancelTransfer(...args: any[]) { return mockCancelTransfer(...args); }
    unpublishApp(...args: any[]) { return mockUnpublishApp(...args); }
  },
  AiroHttpError: class extends Error {
    status: number;
    body: any;
    statusText: string;
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

vi.mock('@/lib/jwt-service', () => ({
  getJWTService: () => ({
    createToken: (...args: any[]) => mockCreateToken(...args),
  }),
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
      const authContext = (request as any).__testAuthContext ?? {
        jwt: 'test-jwt-token',
        user: { customerId: 'cust-123', email: 'test@example.com' },
      };
      return handler(request, authContext, ...args);
    };
  },
}));

import { AiroHttpError } from '@/lib/mgmt-airo';

function createPostRequest(appId: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost:3000/api/apps/${appId}/transfer`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const MOCK_SITE = {
  id: 'app-1',
  agent_url: 'https://agent.example.com',
  status: 'running',
};

const MOCK_SITE_WITH_SUBSCRIPTION = {
  ...MOCK_SITE,
  subscription_id: 'sub-1',
  system_id: 'sys-1',
};

function mockPassingValidation() {
  mockAgentFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ canTransfer: true, gdCommerce: false }),
  });
}

const mockFetch = vi.fn();

describe('/api/apps/[id]/transfer', function transferRouteTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    mockGetSite.mockResolvedValue(MOCK_SITE);
    mockCreateToken.mockResolvedValue({ token: 'agent-jwt-token' });
    mockFetch.mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);
  });

  describe('POST - Commerce validation guard', function postGuardTests() {
    it('should allow transfer when canTransfer is true', async function allowed() {
      mockPassingValidation();
      mockInitiateTransfer.mockResolvedValue({ status: 'initiated', transferToken: 'tok-123' });

      const { POST } = await import('../route');
      const response = await POST(
        createPostRequest('app-1', { targetEmail: 'test@godaddy.com' }),
        { params: Promise.resolve({ id: 'app-1' }) }
      );
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.status).toBe('initiated');
      expect(mockAgentFetch).toHaveBeenCalledWith(
        'https://agent.example.com/apps/app-1/transfer/validate',
        { siteId: 'app-1' }
      );
      expect(mockInitiateTransfer).toHaveBeenCalledWith('app-1', 'test@godaddy.com');
    });

    it('should return 403 when canTransfer is false', async function blocked() {
      mockAgentFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ canTransfer: false, gdCommerce: true }),
      });

      const { POST } = await import('../route');
      const response = await POST(
        createPostRequest('app-1', { targetEmail: 'test@godaddy.com' }),
        { params: Promise.resolve({ id: 'app-1' }) }
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toMatch(/Commerce/);
      expect(mockInitiateTransfer).not.toHaveBeenCalled();
    });

    it('should return 503 when agent validate endpoint fails', async function agentDown() {
      mockAgentFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const { POST } = await import('../route');
      const response = await POST(
        createPostRequest('app-1', { targetEmail: 'test@godaddy.com' }),
        { params: Promise.resolve({ id: 'app-1' }) }
      );
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body.error).toBe('Unable to verify transfer eligibility');
      expect(mockInitiateTransfer).not.toHaveBeenCalled();
    });

    it('should return 503 when agentFetch throws', async function fetchThrows() {
      mockAgentFetch.mockRejectedValue(new Error('Connection refused'));

      const { POST } = await import('../route');
      const response = await POST(
        createPostRequest('app-1', { targetEmail: 'test@godaddy.com' }),
        { params: Promise.resolve({ id: 'app-1' }) }
      );
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body.error).toBe('Unable to verify transfer eligibility');
      expect(mockInitiateTransfer).not.toHaveBeenCalled();
    });

    it('should return 404 when site is not found', async function siteNotFound() {
      mockGetSite.mockResolvedValue(null);

      const { POST } = await import('../route');
      const response = await POST(
        createPostRequest('app-1', { targetEmail: 'test@godaddy.com' }),
        { params: Promise.resolve({ id: 'app-1' }) }
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Site not found');
      expect(mockAgentFetch).not.toHaveBeenCalled();
      expect(mockInitiateTransfer).not.toHaveBeenCalled();
    });

    it('should fall back to localhost when site has no agent_url', async function fallbackUrl() {
      mockGetSite.mockResolvedValue({ id: 'app-1', status: 'running', agent_url: null });
      mockPassingValidation();
      mockInitiateTransfer.mockResolvedValue({ status: 'initiated', transferToken: 'tok-123' });

      const { POST } = await import('../route');
      const response = await POST(
        createPostRequest('app-1', { targetEmail: 'test@godaddy.com' }),
        { params: Promise.resolve({ id: 'app-1' }) }
      );

      expect(response.status).toBe(201);
      expect(mockAgentFetch).toHaveBeenCalledWith(
        'http://localhost:4000/apps/app-1/transfer/validate',
        { siteId: 'app-1' }
      );
    });
  });

  describe('POST - Request validation', function postValidationTests() {
    it('should return 400 when targetEmail is missing', async function missingEmail() {
      const { POST } = await import('../route');
      const response = await POST(
        createPostRequest('app-1', {}),
        { params: Promise.resolve({ id: 'app-1' }) }
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('targetEmail is required');
    });

    it('should return 400 for invalid JSON body', async function invalidJson() {
      const { POST } = await import('../route');
      const response = await POST(
        new NextRequest('http://localhost:3000/api/apps/app-1/transfer', {
          method: 'POST',
          body: 'not-json',
          headers: { 'Content-Type': 'text/plain' },
        }),
        { params: Promise.resolve({ id: 'app-1' }) }
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid JSON request body');
    });

    it('should return 400 for empty request body', async function emptyBody() {
      const { POST } = await import('../route');
      const response = await POST(
        new NextRequest('http://localhost:3000/api/apps/app-1/transfer', { method: 'POST' }),
        { params: Promise.resolve({ id: 'app-1' }) }
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid JSON request body');
    });
  });

  describe('POST - initiateTransfer error handling', function postErrorTests() {
    it('should proxy AiroHttpError status codes', async function proxyError() {
      mockPassingValidation();
      mockInitiateTransfer.mockRejectedValue(
        new AiroHttpError(404, 'Not Found', { message: 'App not found', error: 'App not found' })
      );

      const { POST } = await import('../route');
      const response = await POST(
        createPostRequest('app-1', { targetEmail: 'other@godaddy.com' }),
        { params: Promise.resolve({ id: 'app-1' }) }
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('App not found');
    });

    it('should return 500 for unexpected errors', async function unexpectedError() {
      mockPassingValidation();
      mockInitiateTransfer.mockRejectedValue(new Error('Network failure'));

      const { POST } = await import('../route');
      const response = await POST(
        createPostRequest('app-1', { targetEmail: 'other@godaddy.com' }),
        { params: Promise.resolve({ id: 'app-1' }) }
      );

      expect(response.status).toBe(500);
    });
  });

  describe('GET - Transfer metadata', function getTests() {
    it('should return transfer metadata', async function getMetadata() {
      mockGetTransferMetadata.mockResolvedValue({
        appId: 'app-1',
        transferToken: 'abc123',
        status: 'initiated',
        createdAt: '2026-03-04T12:00:00.000Z',
        expiresAt: '2026-03-07T12:00:00.000Z',
      });

      const { GET } = await import('../route');
      const response = await GET(
        new NextRequest('http://localhost:3000/api/apps/app-1/transfer'),
        { params: Promise.resolve({ id: 'app-1' }) }
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.transferToken).toBe('abc123');
      expect(mockGetTransferMetadata).toHaveBeenCalledWith('app-1', undefined);
    });

    it('should pass transferToken query param', async function withToken() {
      mockGetTransferMetadata.mockResolvedValue({ status: 'initiated' });

      const { GET } = await import('../route');
      await GET(
        new NextRequest('http://localhost:3000/api/apps/app-1/transfer?transferToken=abc123'),
        { params: Promise.resolve({ id: 'app-1' }) }
      );

      expect(mockGetTransferMetadata).toHaveBeenCalledWith('app-1', 'abc123');
    });

    it('should proxy AiroHttpError for metadata', async function metadataError() {
      mockGetTransferMetadata.mockRejectedValue(
        new AiroHttpError(404, 'Not Found', 'No transfer found')
      );

      const { GET } = await import('../route');
      const response = await GET(
        new NextRequest('http://localhost:3000/api/apps/app-1/transfer'),
        { params: Promise.resolve({ id: 'app-1' }) }
      );

      expect(response.status).toBe(404);
    });
  });

  describe('POST - Unpublish after initiate', function postUnpublishTests() {
    // Unpublish is fire-and-forget; flush microtasks so assertions see the side effects
    async function flush() {
      await new Promise(function resolve(r) { setTimeout(r, 0); });
    }

    it('should call agents unpublish and control plane unpublish after successful initiation', async function unpublishBoth() {
      mockGetSite.mockResolvedValue(MOCK_SITE_WITH_SUBSCRIPTION);
      mockPassingValidation();
      mockInitiateTransfer.mockResolvedValue({ status: 'initiated', transferToken: 'tok-123' });
      mockUnpublishApp.mockResolvedValue({ message: 'Unpublished' });

      const { POST } = await import('../route');
      const response = await POST(
        createPostRequest('app-1', { targetEmail: 'test@godaddy.com' }),
        { params: Promise.resolve({ id: 'app-1' }) }
      );
      await flush();

      expect(response.status).toBe(201);
      expect(mockCreateToken).toHaveBeenCalledWith(expect.objectContaining({
        siteId: 'app-1',
        canPublish: true,
      }));
      expect(mockFetch).toHaveBeenCalledWith(
        'https://agent.example.com/apps/app-1/unpublish',
        expect.objectContaining({ method: 'POST' })
      );
      expect(mockUnpublishApp).toHaveBeenCalledWith('sub-1', 'sys-1', 'app-1');
    });

    it('should return 201 even when agents unpublish fails', async function agentsUnpublishFail() {
      mockGetSite.mockResolvedValue(MOCK_SITE_WITH_SUBSCRIPTION);
      mockPassingValidation();
      mockInitiateTransfer.mockResolvedValue({ status: 'initiated', transferToken: 'tok-123' });
      mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'Internal Error' });
      mockUnpublishApp.mockResolvedValue({ message: 'Unpublished' });

      const { POST } = await import('../route');
      const response = await POST(
        createPostRequest('app-1', { targetEmail: 'test@godaddy.com' }),
        { params: Promise.resolve({ id: 'app-1' }) }
      );
      await flush();

      expect(response.status).toBe(201);
      expect(mockUnpublishApp).toHaveBeenCalled();
    });

    it('should return 201 even when control plane unpublish fails', async function controlPlaneUnpublishFail() {
      mockGetSite.mockResolvedValue(MOCK_SITE_WITH_SUBSCRIPTION);
      mockPassingValidation();
      mockInitiateTransfer.mockResolvedValue({ status: 'initiated', transferToken: 'tok-123' });
      mockUnpublishApp.mockRejectedValue(new Error('Control plane down'));

      const { POST } = await import('../route');
      const response = await POST(
        createPostRequest('app-1', { targetEmail: 'test@godaddy.com' }),
        { params: Promise.resolve({ id: 'app-1' }) }
      );
      await flush();

      expect(response.status).toBe(201);
    });

    it('should skip control plane unpublish when subscription_id is missing', async function skipControlPlane() {
      mockPassingValidation();
      mockInitiateTransfer.mockResolvedValue({ status: 'initiated', transferToken: 'tok-123' });

      const { POST } = await import('../route');
      const response = await POST(
        createPostRequest('app-1', { targetEmail: 'test@godaddy.com' }),
        { params: Promise.resolve({ id: 'app-1' }) }
      );
      await flush();

      expect(response.status).toBe(201);
      expect(mockFetch).toHaveBeenCalled();
      expect(mockUnpublishApp).not.toHaveBeenCalled();
    });

    it('should log info instead of error when control plane returns 409', async function alreadyUnpublished() {
      mockGetSite.mockResolvedValue(MOCK_SITE_WITH_SUBSCRIPTION);
      mockPassingValidation();
      mockInitiateTransfer.mockResolvedValue({ status: 'initiated', transferToken: 'tok-123' });
      mockUnpublishApp.mockRejectedValue({ status: 409 });

      const { logger } = await import('@/lib/request-context');
      const { POST } = await import('../route');
      const response = await POST(
        createPostRequest('app-1', { targetEmail: 'test@godaddy.com' }),
        { params: Promise.resolve({ id: 'app-1' }) }
      );
      await flush();

      expect(response.status).toBe(201);
      expect(logger.info).toHaveBeenCalledWith('transfer.unpublish.alreadyUnpublished', { appId: 'app-1' });
      expect(logger.error).not.toHaveBeenCalledWith(
        'transfer.unpublish.controlPlane.error',
        expect.anything()
      );
    });

    it('should use fallback URL when agent_url is missing', async function fallbackUnpublish() {
      mockGetSite.mockResolvedValue({ id: 'app-1', status: 'running', agent_url: null });
      mockPassingValidation();
      mockInitiateTransfer.mockResolvedValue({ status: 'initiated', transferToken: 'tok-123' });

      const { POST } = await import('../route');
      const response = await POST(
        createPostRequest('app-1', { targetEmail: 'test@godaddy.com' }),
        { params: Promise.resolve({ id: 'app-1' }) }
      );
      await flush();

      expect(response.status).toBe(201);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4000/apps/app-1/unpublish',
        expect.objectContaining({ method: 'POST' })
      );
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
      const response = await DELETE(
        new NextRequest('http://localhost:3000/api/apps/app-1/transfer', { method: 'DELETE' }),
        { params: Promise.resolve({ id: 'app-1' }) }
      );
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
      const response = await DELETE(
        new NextRequest('http://localhost:3000/api/apps/app-1/transfer', { method: 'DELETE' }),
        { params: Promise.resolve({ id: 'app-1' }) }
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Transfer not in initiated state');
    });
  });
});
