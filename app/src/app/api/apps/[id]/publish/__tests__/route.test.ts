/**
 * Publish API Route Tests
 *
 * Tests the /api/apps/[id]/publish endpoint with server-side
 * paywall enforcement to prevent bypassing subscription checks.
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Mock modules before importing the route
 */
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
    return async (request: any, params: any) => {
      const mockAuthContext = {
        jwt: 'test-jwt-token',
        user: {
          accountId: 'test-account',
          customerId: 'customer-123',
          shopperId: 'shopper-123',
          email: 'test@example.com',
        },
      };
      return handler(request, mockAuthContext, params);
    };
  },
  customerHasAccount: vi.fn(() => true),
  createCustomerAuthError: vi.fn(),
}));

vi.mock('@/lib/paywall/core', () => ({
  checkPaywallEligibility: vi.fn(),
}));

vi.mock('@/lib/paywall/server-provider', () => ({
  ServerPaywallProvider: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn(),
}));

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: vi.fn(),
}));

vi.mock('@/lib/mgmt-airo', () => ({
  AiroMgmtClient: vi.fn(),
}));

vi.mock('@/lib/control-plane/error-handler', () => ({
  handleControlPlaneError: vi.fn(),
}));

describe('/api/apps/[id]/publish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST - Server-side paywall enforcement', () => {
    it('should block publish when user has no access', async () => {
      const { checkPaywallEligibility } = await import(
        '@/lib/paywall/core'
      );
      const { getControlPlaneAdapter } = await import('@/lib/control-plane');
      const { POST } = await import('../route');

      // Mock control plane adapter to verify ownership first
      const mockAdapter = {
        getSite: vi.fn().mockResolvedValue({
          id: 'app-123',
          agent_url: 'http://localhost:4000',
          subscription_id: 'sub-123',
          system_id: 'sys-123',
        }),
      };
      (getControlPlaneAdapter as any).mockReturnValue(mockAdapter);

      // Mock paywall check returning no access
      (checkPaywallEligibility as any).mockResolvedValue({
        hasAccess: false,
        statusCode: 402,
        reason: 'Airo Plus subscription required',
        details: {
          hasSubscription: false,
          hasEntitlements: false,
          hasMatchingProject: false,
        },
      });

      const request = new NextRequest(
        'http://localhost:3000/api/apps/app-123/publish',
        {
          method: 'POST',
          body: JSON.stringify({ commitHash: 'abc123' }),
        }
      );

      const response = await POST(request, { params: Promise.resolve({ id: 'app-123' }) });
      const body = await response.json();

      expect(response.status).toBe(402);
      expect(body.error).toBe('Airo Plus subscription required');
      expect(checkPaywallEligibility).toHaveBeenCalledWith(
        'app-123',
        expect.any(Object) // Provider instance
      );
    });

    it('should allow publish when user has access via entitlements', async () => {
      const { checkPaywallEligibility } = await import(
        '@/lib/paywall/core'
      );
      const { getControlPlaneAdapter } = await import('@/lib/control-plane');
      const { agentFetch } = await import('@/lib/agent-fetch');
      const { POST } = await import('../route');

      // Mock paywall check returning access
      (checkPaywallEligibility as any).mockResolvedValue({
        hasAccess: true,
        statusCode: 200,
        details: {
          hasSubscription: true,
          hasEntitlements: true,
          hasMatchingProject: false,
          subscriptionId: 'sub-123',
          entitlementId: 'ent-123',
        },
      });

      // Mock control plane adapter
      const mockAdapter = {
        getSite: vi.fn().mockResolvedValue({
          id: 'app-123',
          agent_url: 'http://localhost:4000',
          subscription_id: 'sub-123',
          system_id: 'sys-123',
        }),
      };
      (getControlPlaneAdapter as any).mockReturnValue(mockAdapter);

      // Mock agent fetch
      (agentFetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          commitHash: 'abc123',
          archive: { path: '/path/to/archive.tar.gz' },
        }),
      });

      // Mock AiroMgmtClient
      const { AiroMgmtClient } = await import('@/lib/mgmt-airo');
      (AiroMgmtClient as any).mockImplementation(() => ({
        publishApp: vi.fn().mockResolvedValue({
          deploymentId: 'deploy-123',
          statusJobId: 'job-123',
          status: 'PENDING',
          message: 'Deployment started',
        }),
      }));

      const request = new NextRequest(
        'http://localhost:3000/api/apps/app-123/publish',
        {
          method: 'POST',
          body: JSON.stringify({ commitHash: 'abc123' }),
        }
      );

      const response = await POST(request, { params: Promise.resolve({ id: 'app-123' }) });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.commitHash).toBe('abc123');
      expect(checkPaywallEligibility).toHaveBeenCalled();
    });

    it('should allow publish when user has access via matching project', async () => {
      const { checkPaywallEligibility } = await import(
        '@/lib/paywall/core'
      );
      const { getControlPlaneAdapter } = await import('@/lib/control-plane');
      const { agentFetch } = await import('@/lib/agent-fetch');
      const { POST } = await import('../route');

      // Mock paywall check returning access via project
      (checkPaywallEligibility as any).mockResolvedValue({
        hasAccess: true,
        statusCode: 200,
        details: {
          hasSubscription: true,
          hasEntitlements: false,
          hasMatchingProject: true,
          subscriptionId: 'sub-123',
          billingId: 'billing-123',
        },
      });

      // Mock control plane adapter
      const mockAdapter = {
        getSite: vi.fn().mockResolvedValue({
          id: 'app-123',
          agent_url: 'http://localhost:4000',
          subscription_id: 'sub-123',
          system_id: 'sys-123',
        }),
      };
      (getControlPlaneAdapter as any).mockReturnValue(mockAdapter);

      // Mock agent fetch
      (agentFetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          commitHash: 'abc123',
          archive: { path: '/path/to/archive.tar.gz' },
        }),
      });

      // Mock AiroMgmtClient
      const { AiroMgmtClient } = await import('@/lib/mgmt-airo');
      (AiroMgmtClient as any).mockImplementation(() => ({
        publishApp: vi.fn().mockResolvedValue({
          deploymentId: 'deploy-123',
          statusJobId: 'job-123',
          status: 'PENDING',
          message: 'Deployment started',
        }),
      }));

      const request = new NextRequest(
        'http://localhost:3000/api/apps/app-123/publish',
        {
          method: 'POST',
          body: JSON.stringify({ commitHash: 'abc123' }),
        }
      );

      const response = await POST(request, { params: Promise.resolve({ id: 'app-123' }) });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.commitHash).toBe('abc123');
      expect(checkPaywallEligibility).toHaveBeenCalled();
    });

    it('should block publish when paywall check returns 500 error', async () => {
      const { checkPaywallEligibility } = await import(
        '@/lib/paywall/core'
      );
      const { getControlPlaneAdapter } = await import('@/lib/control-plane');
      const { POST } = await import('../route');

      // Mock control plane adapter to verify ownership first
      const mockAdapter = {
        getSite: vi.fn().mockResolvedValue({
          id: 'app-123',
          agent_url: 'http://localhost:4000',
          subscription_id: 'sub-123',
          system_id: 'sys-123',
        }),
      };
      (getControlPlaneAdapter as any).mockReturnValue(mockAdapter);

      // Mock paywall check returning server error
      (checkPaywallEligibility as any).mockResolvedValue({
        hasAccess: false,
        statusCode: 500,
        reason: 'Unable to verify subscription status',
        details: {
          hasSubscription: false,
          hasEntitlements: false,
          hasMatchingProject: false,
        },
      });

      const request = new NextRequest(
        'http://localhost:3000/api/apps/app-123/publish',
        {
          method: 'POST',
          body: JSON.stringify({ commitHash: 'abc123' }),
        }
      );

      const response = await POST(request, { params: Promise.resolve({ id: 'app-123' }) });
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Unable to verify subscription status');
    });

    it('should block publish when paywall is enabled but no subscription', async () => {
      const { checkPaywallEligibility } = await import(
        '@/lib/paywall/core'
      );
      const { getControlPlaneAdapter } = await import('@/lib/control-plane');
      const { POST } = await import('../route');

      // Mock control plane adapter to verify ownership first
      const mockAdapter = {
        getSite: vi.fn().mockResolvedValue({
          id: 'app-123',
          agent_url: 'http://localhost:4000',
          subscription_id: 'sub-123',
          system_id: 'sys-123',
        }),
      };
      (getControlPlaneAdapter as any).mockReturnValue(mockAdapter);

      // Mock paywall check returning no subscription
      (checkPaywallEligibility as any).mockResolvedValue({
        hasAccess: false,
        statusCode: 402,
        reason: 'No active subscription found',
        details: {
          hasSubscription: false,
          hasEntitlements: false,
          hasMatchingProject: false,
        },
      });

      const request = new NextRequest(
        'http://localhost:3000/api/apps/app-123/publish',
        {
          method: 'POST',
          body: JSON.stringify({ commitHash: 'abc123' }),
        }
      );

      const response = await POST(request, { params: Promise.resolve({ id: 'app-123' }) });
      const body = await response.json();

      expect(response.status).toBe(402);
      expect(body.error).toBe('No active subscription found');
      expect(body.details.hasSubscription).toBe(false);
    });

    // Note: JWT validation is handled by withCustomerAuth middleware
    // The route checks for JWT presence as an additional safety measure
    // Testing this would require complex mock overrides, and the core
    // paywall functionality is already covered by the tests above
  });
});
