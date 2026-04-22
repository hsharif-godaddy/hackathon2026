/**
 * AiroMgmtClient Tests
 * 
 * Tests the low-level HTTP client for mgmt-airo API.
 * Focuses on HTTP concerns, retry logic, and error handling.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiroMgmtClient } from '../client';
import type { 
  AiroApp,
  AiroAppDetails,
  AiroCreateAppPayload,
  AiroJobStatus,
  AiroMgmtClientConfig,
  AiroSignupPayload,
  AiroSubscription,
  AiroSystem,
  AiroUpdateAppPayload
} from '../types';

/**
 * Mock fetch globally
 */
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

/**
 * Mock logger to avoid console noise
 */
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

/**
 * Mock jwt-utils to return test customer ID
 */
vi.mock('@/lib/utils/jwt-utils', () => ({
  extractCustomerId: vi.fn(() => 'customer-123')
}));

/**
 * Test fixtures
 */
const MOCK_CONFIG: AiroMgmtClientConfig = {
  baseUrl: 'https://mgmt.test.com',
  jwt: 'fake-jwt-for-testing-only',
  maxRetries: 3,
  retryDelayMs: 100
};

const MOCK_SUBSCRIPTION: AiroSubscription = {
  id: 'sub-123',
  productId: 'aab-v1',
  customerId: 'customer-123',
  status: 'active',
  isTrial: true,
  entitlementId: 'ent-456',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z'
};

const MOCK_SYSTEM: AiroSystem = {
  subscriptionId: 'sub-123',
  systemId: 'sys-456',
  datacenter: 'sxb1',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z'
};

const MOCK_APP: AiroApp = {
  id: 'app-789',
  systemId: 'sys-456',
  subscriptionId: 'sub-123',
  appTemplateName: 'default',
  status: 'active',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  urls: {
    agent: 'https://agent-app789.ab.sxb1.test-secureserver.net',
    preview: 'https://preview-app789.ab.sxb1.test-secureserver.net'
  },
  variables: {
    title: 'Test App',
    initialPrompt: 'Create a test app'
  }
};

const MOCK_APP_DETAILS: AiroAppDetails = {
  ...MOCK_APP,
  variables: {
    title: 'Test App',
    initialPrompt: 'Create a test app',
    customVar: 'custom value'
  }
};

const MOCK_JOB_STATUS: AiroJobStatus = {
  statusJobId: 'job-123',
  status: 'completed',
  apps: [MOCK_APP]
};

describe('AiroMgmtClient', () => {
  let client: AiroMgmtClient;

  beforeEach(() => {
    client = new AiroMgmtClient(MOCK_CONFIG);
    mockFetch.mockClear();
  });

  afterEach(() => {
    mockFetch.mockReset();
  });

  describe('constructor', () => {
    it('should initialize with provided config', () => {
      expect(client).toBeInstanceOf(AiroMgmtClient);
    });

    it('should use default values for optional config', () => {
      const minimalConfig = {
        baseUrl: 'https://test.com',
        jwt: 'test-jwt'
      };
      const minimalClient = new AiroMgmtClient(minimalConfig);
      expect(minimalClient).toBeInstanceOf(AiroMgmtClient);
    });
  });

  describe('checkCustomer', () => {
    it('should return customer exists when API returns 200', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ customerId: 'customer-123' })
      });

      const result = await client.checkCustomer();

      expect(result.exists).toBe(true);
      expect(result.customerId).toBe('customer-123');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://mgmt.test.com/api/airo/v1/customers/me',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': `sso-jwt ${MOCK_CONFIG.jwt}`
          })
        })
      );
    });

    it('should return customer does not exist when API returns 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Not Found'
      });

      const result = await client.checkCustomer();

      expect(result.exists).toBe(false);
      expect(result.customerId).toBe('customer-123'); // Extracted from JWT
    });

    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.checkCustomer();

      expect(result.exists).toBe(false);
    });
  });

  describe('getSubscriptions', () => {
    it('should return subscriptions array when API returns array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [MOCK_SUBSCRIPTION]
      });

      const result = await client.getSubscriptions();

      expect(result).toEqual([MOCK_SUBSCRIPTION]);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://mgmt.test.com/api/airo/v1/subscriptions?ownerProduct=AiroAppBuilder',
        expect.objectContaining({
          method: 'GET'
        })
      );
    });

    it('should return subscriptions array when API returns object with subscriptions key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ subscriptions: [MOCK_SUBSCRIPTION] })
      });

      const result = await client.getSubscriptions();

      expect(result).toEqual([MOCK_SUBSCRIPTION]);
    });

    it('should return empty array when API returns empty response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({})
      });

      const result = await client.getSubscriptions();

      expect(result).toEqual([]);
    });

    it('should allow custom ownerProduct filter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [MOCK_SUBSCRIPTION]
      });

      await client.getSubscriptions('PaaSNodeJS');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://mgmt.test.com/api/airo/v1/subscriptions?ownerProduct=PaaSNodeJS',
        expect.objectContaining({
          method: 'GET'
        })
      );
    });
  });

  describe('getActiveSubscription', () => {
    it('should return first subscription when subscriptions exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [MOCK_SUBSCRIPTION]
      });

      const result = await client.getActiveSubscription();

      expect(result).toEqual(MOCK_SUBSCRIPTION);
    });

    it('should return null when no subscriptions exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => []
      });

      const result = await client.getActiveSubscription();

      expect(result).toBeNull();
    });
  });

  describe('getSubscription', () => {
    it('should fetch a single subscription by ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_SUBSCRIPTION
      });

      const result = await client.getSubscription('sub-123');

      expect(result).toEqual(MOCK_SUBSCRIPTION);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://mgmt.test.com/api/airo/v1/subscriptions/sub-123',
        expect.objectContaining({
          method: 'GET'
        })
      );
    });

    it('should throw error when subscription not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: 'Subscription not found' })
      });

      await expect(client.getSubscription('non-existent')).rejects.toThrow();
    });
  });

  describe('getSystems', () => {
    it('should return systems with mapped id field', async () => {
      const systemsResponse = [{
        ...MOCK_SYSTEM,
        systemId: 'sys-456'
      }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => systemsResponse
      });

      const result = await client.getSystems('sub-123');

      expect(result).toEqual([{
        ...MOCK_SYSTEM,
        id: 'sys-456'
      }]);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://mgmt.test.com/api/airo/v1/subscriptions/sub-123/systems',
        expect.objectContaining({
          method: 'GET'
        })
      );
    });

    it('should handle systems wrapped in object', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ systems: [MOCK_SYSTEM] })
      });

      const result = await client.getSystems('sub-123');

      expect(result).toEqual([{
        ...MOCK_SYSTEM,
        id: MOCK_SYSTEM.systemId
      }]);
    });
  });

  describe('getAppsForSystem', () => {
    it('should return apps for specific system', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apps: [MOCK_APP] })
      });

      const result = await client.getAppsForSystem('sub-123', 'sys-456');

      expect(result).toEqual([MOCK_APP]);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://mgmt.test.com/api/airo/v1/subscriptions/sub-123/systems/sys-456/apps',
        expect.objectContaining({
          method: 'GET'
        })
      );
    });

    it('should return empty array when no apps exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apps: [] })
      });

      const result = await client.getAppsForSystem('sub-123', 'sys-456');

      expect(result).toEqual([]);
    });
  });

  describe('getAllAppsForCustomer', () => {
    it('should return all apps from bulk endpoint with default ownerProduct filter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apps: [MOCK_APP] })
      });

      const result = await client.getAllAppsForCustomer();

      expect(result).toEqual([MOCK_APP]);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://mgmt.test.com/api/airo/v1/customers/me/apps?ownerProduct=AiroAppBuilder',
        expect.objectContaining({
          method: 'GET'
        })
      );
    });

    it('should return empty array when no apps exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apps: [] })
      });

      const result = await client.getAllAppsForCustomer();

      expect(result).toEqual([]);
    });

    it('should allow custom ownerProduct filter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apps: [MOCK_APP] })
      });

      await client.getAllAppsForCustomer('PaaSNodeJS');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://mgmt.test.com/api/airo/v1/customers/me/apps?ownerProduct=PaaSNodeJS',
        expect.objectContaining({
          method: 'GET'
        })
      );
    });
  });

  describe('getApp', () => {
    it('should return app details with retry on 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_APP_DETAILS
      });

      const result = await client.getApp('sub-123', 'sys-456', 'app-789');

      expect(result).toEqual(MOCK_APP_DETAILS);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://mgmt.test.com/api/airo/v1/subscriptions/sub-123/systems/sys-456/apps/app-789',
        expect.objectContaining({
          method: 'GET'
        })
      );
    });
  });

  describe('getAiroJobApps', () => {
    it('should return job status with apps', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_JOB_STATUS
      });

      const result = await client.getAiroJobApps('job-123');

      expect(result).toEqual(MOCK_JOB_STATUS);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://mgmt.test.com/api/airo/v1/jobs/job-123/apps',
        expect.objectContaining({
          method: 'GET'
        })
      );
    });
  });

  describe('signup', () => {
    it('should create new subscription with app', async () => {
      const signupPayload: AiroSignupPayload = {
        datacenter: 'sxb1',
        isTrial: true,
        productId: 'aab-v1',
        initialPrompt: 'Create a test app',
        appConfigs: [{
          templateName: 'default',
          environments: ['dev'],
          variables: {
            title: 'Test App',
            initialPrompt: 'Create a test app'
          }
        }]
      };

      const signupResponse = { statusJobId: 'job-123' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => signupResponse
      });

      const result = await client.signup(signupPayload);

      expect(result).toEqual(signupResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://mgmt.test.com/api/airo/v1/signup',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          }),
          body: JSON.stringify(signupPayload)
        })
      );
    });
  });

  describe('createApp', () => {
    it('should add app to existing subscription', async () => {
      const createAppPayload: AiroCreateAppPayload = {
        appTemplateName: 'default',
        environments: ['dev'],
        variables: {
          title: 'Test App',
          initialPrompt: 'Create a test app'
        }
      };

      const createAppResponse = { statusJobId: 'job-456' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createAppResponse
      });

      const result = await client.createApp('sub-123', 'sys-456', createAppPayload);

      expect(result).toEqual(createAppResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://mgmt.test.com/api/airo/v1/subscriptions/sub-123/systems/sys-456/apps',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(createAppPayload)
        })
      );
    });
  });

  describe('updateApp', () => {
    it('should update app details', async () => {
      const updatePayload: AiroUpdateAppPayload = {
        status: 'active',
        variables: {
          title: 'Updated App'
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_APP_DETAILS
      });

      const result = await client.updateApp('sub-123', 'sys-456', 'app-789', updatePayload);

      expect(result).toEqual(MOCK_APP_DETAILS);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://mgmt.test.com/api/airo/v1/subscriptions/sub-123/systems/sys-456/apps/app-789',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify(updatePayload)
        })
      );
    });
  });

  describe('deployApp', () => {
    it('should deploy app', async () => {
      const deployResponse = { success: true, message: 'Deployment started' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => deployResponse
      });

      const result = await client.deployApp('sub-123', 'sys-456', 'app-789');

      expect(result).toEqual(deployResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://mgmt.test.com/api/airo/v1/subscriptions/sub-123/systems/sys-456/apps/app-789/deploy',
        expect.objectContaining({
          method: 'PUT'
        })
      );
    });
  });

  describe('deleteApp', () => {
    it('should delete app', async () => {
      const deleteResponse = { success: true, message: 'App deleted' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => deleteResponse
      });

      const result = await client.deleteApp('sub-123', 'sys-456', 'app-789');

      expect(result).toEqual(deleteResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://mgmt.test.com/api/airo/v1/subscriptions/sub-123/systems/sys-456/apps/app-789',
        expect.objectContaining({
          method: 'DELETE'
        })
      );
    });
  });

  describe('error handling', () => {
    it('should throw error on HTTP error response', async () => {
      // Mock all 3 retry attempts with the same error response
      const errorResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        url: 'https://mgmt.test.com/api/airo/v1/subscriptions',
        text: async () => 'Server error'
      } as Response;
      
      mockFetch
        .mockResolvedValueOnce(errorResponse)
        .mockResolvedValueOnce(errorResponse)
        .mockResolvedValueOnce(errorResponse);

      await expect(client.getSubscriptions()).rejects.toThrow(
        'API request failed: 500 Internal Server Error - Server error'
      );
    });

    it('should parse JSON error response', async () => {
      // Mock all 3 retry attempts with the same error response
      const errorResponse = {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        url: 'https://mgmt.test.com/api/airo/v1/subscriptions',
        text: async () => JSON.stringify({ message: 'Invalid request', error: 'VALIDATION_ERROR' })
      } as Response;
      
      mockFetch
        .mockResolvedValueOnce(errorResponse)
        .mockResolvedValueOnce(errorResponse)
        .mockResolvedValueOnce(errorResponse);

      await expect(client.getSubscriptions()).rejects.toThrow(
        'API request failed: 400 Bad Request'
      );
    });

    it('should retry on network error', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ customerId: 'customer-123' })
        });

      const result = await client.checkCustomer();

      expect(result.exists).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should not retry on 401 Unauthorized and log at warn level', async () => {
      const { logger } = await import('@/lib/request-context');
      vi.mocked(logger.warn).mockClear();
      vi.mocked(logger.error).mockClear();

      const errorResponse = {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        url: 'https://mgmt.test.com/api/airo/v1/subscriptions',
        text: async () => 'Unauthorized'
      } as Response;

      mockFetch.mockResolvedValueOnce(errorResponse);

      await expect(client.getSubscriptions()).rejects.toBeInstanceOf(Error);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith('mgmt-airo.api.auth-error.no-retry', expect.objectContaining({ url: expect.any(String) }));
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should not retry on 403 Forbidden and log at warn level', async () => {
      const { logger } = await import('@/lib/request-context');
      vi.mocked(logger.warn).mockClear();
      vi.mocked(logger.error).mockClear();

      const errorResponse = {
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        url: 'https://mgmt.test.com/api/airo/v1/attributes/user/123',
        text: async () => 'Forbidden'
      } as Response;

      mockFetch.mockResolvedValueOnce(errorResponse);

      await expect(client.getSubscriptions()).rejects.toBeInstanceOf(Error);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith('mgmt-airo.api.auth-error.no-retry', expect.objectContaining({ url: expect.any(String) }));
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should retry on 404 when retryOn404 is enabled', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: async () => 'Not Found'
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_APP_DETAILS
        });

      const result = await client.getApp('sub-123', 'sys-456', 'app-789');

      expect(result).toEqual(MOCK_APP_DETAILS);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should fail after max retries', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'));

      await expect(client.getSubscriptions()).rejects.toThrow('Network error');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('authentication', () => {
    it('should include JWT in Authorization header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [MOCK_SUBSCRIPTION]
      });

      await client.getSubscriptions();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': `sso-jwt ${MOCK_CONFIG.jwt}`
          })
        })
      );
    });

    it('should include Content-Type header for POST requests', async () => {
      const payload = { test: 'data' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ statusJobId: 'job-123' })
      });

      await client.signup(payload as any);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': `sso-jwt ${MOCK_CONFIG.jwt}`,
            'Content-Type': 'application/json'
          })
        })
      );
    });
  });

  describe('createBuilderPlan', () => {
    it('should create a free builder plan for subscription', async () => {
      const createPlanResponse = {
        subscriptionId: 'sub-123',
        plan: 'free',
        builderEntitlementId: 'builder-ent-456',
        message: 'Builder plan created'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createPlanResponse
      });

      const result = await client.createBuilderPlan('sub-123', { plan: 'free' as any });

      expect(result).toEqual(createPlanResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://mgmt.test.com/api/airo/v1/subscriptions/sub-123/builder-plan',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          }),
          body: JSON.stringify({ plan: 'free' })
        })
      );
    });

    it('should create builder plan with empty payload when no options provided', async () => {
      const createPlanResponse = {
        subscriptionId: 'sub-123',
        plan: 'free',
        builderEntitlementId: 'builder-ent-456'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createPlanResponse
      });

      await client.createBuilderPlan('sub-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://mgmt.test.com/api/airo/v1/subscriptions/sub-123/builder-plan',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({})
        })
      );
    });
  });

  describe('getCreditGrants', () => {
    const MOCK_GRANTS = {
      grants: [
        {
          id: 'grant-1',
          subscriptionId: 'sub-123',
          type: 'plan-monthly',
          llmBudgetUserId: 'airo-builder:grant:grant-1',
          llmBudgetId: 'budget-123',
          creditsMax: 1500,
          creditsSpent: 500,
          isAvailable: true,
          finalState: null,
          useBefore: '2026-02-09T00:00:00.000Z',
          consumedAt: null,
          createdAt: '2026-01-09T00:00:00.000Z',
          updatedAt: '2026-01-14T00:00:00.000Z',
        },
        {
          id: 'grant-2',
          subscriptionId: 'sub-123',
          type: 'credit-pack',
          llmBudgetUserId: 'airo-builder:grant:grant-2',
          llmBudgetId: 'budget-456',
          creditsMax: 2500,
          creditsSpent: 2500,
          isAvailable: false,
          finalState: 'consumed',
          useBefore: '2026-02-01T00:00:00.000Z',
          consumedAt: '2026-01-05T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-05T00:00:00.000Z',
        }
      ]
    };

    it('should return credit grants for subscription', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_GRANTS
      });

      const result = await client.getCreditGrants('sub-123');

      expect(result).toEqual(MOCK_GRANTS.grants);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://mgmt.test.com/api/airo/v1/subscriptions/sub-123/credits/grants?syncSpend=true',
        expect.objectContaining({
          method: 'GET'
        })
      );
    });

    it('should pass syncSpend=true by default', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_GRANTS
      });

      await client.getCreditGrants('sub-123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('syncSpend=true'),
        expect.any(Object)
      );
    });

    it('should pass syncSpend=false when specified', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_GRANTS
      });

      await client.getCreditGrants('sub-123', false);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('syncSpend=false'),
        expect.any(Object)
      );
    });

    it('should return empty array when no grants exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ grants: [] })
      });

      const result = await client.getCreditGrants('sub-123');

      expect(result).toEqual([]);
    });

    it('should return empty array when grants key is missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({})
      });

      const result = await client.getCreditGrants('sub-123');

      expect(result).toEqual([]);
    });
  });

  describe('#recordExport', () => {
    it('should record an export event', async () => {
      const mockExportResponse = {
        id: 'export-123',
        subscriptionId: 'sub-123',
        appId: 'app-789',
        exportedAt: '2025-01-15T10:00:00Z'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockExportResponse
      });

      const result = await client.recordExport(
        'sub-123',
        'sys-456',
        'app-789',
        {
          initiatedBy: 'customer-123',
          exportedAt: '2025-01-15T10:00:00Z',
          appName: 'my-app'
        }
      );

      expect(result).toEqual(mockExportResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://mgmt.test.com/api/airo/v1/subscriptions/sub-123/systems/sys-456/apps/app-789/exports',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            initiatedBy: 'customer-123',
            exportedAt: '2025-01-15T10:00:00Z',
            appName: 'my-app'
          })
        })
      );
    });

    it('should return null on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error'
      });

      const result = await client.recordExport(
        'sub-123',
        'sys-456',
        'app-789',
        {
          initiatedBy: 'customer-123',
          exportedAt: '2025-01-15T10:00:00Z',
          appName: 'my-app'
        }
      );

      expect(result).toBeNull();
    });

    it('should return null on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.recordExport(
        'sub-123',
        'sys-456',
        'app-789',
        {
          initiatedBy: 'customer-123',
          exportedAt: '2025-01-15T10:00:00Z',
          appName: 'my-app'
        }
      );

      expect(result).toBeNull();
    });
  });

  describe('#getAppExports', () => {
    it('should list exports for an app', async () => {
      const mockExportsResponse = {
        exports: [
          {
            id: 'export-123',
            initiatedBy: 'customer-123',
            exportedAt: '2025-01-15T10:00:00Z'
          },
          {
            id: 'export-456',
            initiatedBy: 'customer-123',
            exportedAt: '2025-01-16T10:00:00Z'
          }
        ],
        total: 2
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockExportsResponse
      });

      const result = await client.getAppExports('sub-123', 'sys-456', 'app-789');

      expect(result).toEqual(mockExportsResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://mgmt.test.com/api/airo/v1/subscriptions/sub-123/systems/sys-456/apps/app-789/exports',
        expect.objectContaining({
          method: 'GET'
        })
      );
    });

    it('should handle empty exports', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ exports: [], total: 0 })
      });

      const result = await client.getAppExports('sub-123', 'sys-456', 'app-789');

      expect(result.exports).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('#getExportsStatus', () => {
    it('should return export status for subscription', async () => {
      const mockStatusResponse = {
        eligibleForRefund: true,
        lastExportedAt: null,
        totalExports: 0
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatusResponse
      });

      const result = await client.getExportsStatus('sub-123');

      expect(result).toEqual(mockStatusResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://mgmt.test.com/api/airo/v1/subscriptions/sub-123/exports/status',
        expect.objectContaining({
          method: 'GET'
        })
      );
    });

    it('should return not eligible when exports exist', async () => {
      const mockStatusResponse = {
        eligibleForRefund: false,
        lastExportedAt: '2025-01-15T10:00:00Z',
        totalExports: 3
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatusResponse
      });

      const result = await client.getExportsStatus('sub-123');

      expect(result.eligibleForRefund).toBe(false);
      expect(result.lastExportedAt).toBe('2025-01-15T10:00:00Z');
      expect(result.totalExports).toBe(3);
    });
  });

  describe('#getImageStatus', () => {
    it('should return image status for an app', async () => {
      const mockResponse = {
        appId: 'app-789',
        compositionId: 'ai-builder',
        compositionVersion: '1.0.0',
        unifiedVariantJob: true,
        status: 'current',
        images: [
          {
            imageType: 'agent',
            deployedTag: 'v1.0.0',
            expectedTag: 'v1.0.0',
            match: true
          }
        ]
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await client.getImageStatus('sub-123', 'sys-456', 'app-789');

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://mgmt.test.com/api/airo/v1/subscriptions/sub-123/systems/sys-456/apps/app-789/image-status',
        expect.objectContaining({
          method: 'GET'
        })
      );
    });

    it('should return stale status when images are outdated', async () => {
      const mockResponse = {
        appId: 'app-789',
        compositionId: 'ai-builder',
        compositionVersion: '1.0.0',
        unifiedVariantJob: true,
        status: 'stale',
        images: [
          {
            imageType: 'agent',
            deployedTag: 'v1.0.0',
            expectedTag: 'v1.1.0',
            match: false
          }
        ]
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await client.getImageStatus('sub-123', 'sys-456', 'app-789');

      expect(result.status).toBe('stale');
      expect(result.images?.[0].match).toBe(false);
    });

    it('should return reloading status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          appId: 'app-789',
          compositionId: 'ai-builder',
          compositionVersion: '1.0.0',
          unifiedVariantJob: true,
          status: 'reloading'
        })
      });

      const result = await client.getImageStatus('sub-123', 'sys-456', 'app-789');

      expect(result.status).toBe('reloading');
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'Internal error' }),
        text: async () => 'Internal error'
      });

      await expect(client.getImageStatus('sub-123', 'sys-456', 'app-789'))
        .rejects.toThrow();
    });
  });

  describe('#reloadImages', () => {
    it('should trigger image reload for an app', async () => {
      const mockResponse = {
        appId: 'app-789',
        status: 'reloading',
        message: 'Image reload initiated',
        jobId: 'job-abc',
        startedAt: '2025-01-01T00:00:00Z'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await client.reloadImages('sub-123', 'sys-456', 'app-789');

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://mgmt.test.com/api/airo/v1/subscriptions/sub-123/systems/sys-456/apps/app-789/reload',
        expect.objectContaining({
          method: 'POST',
          body: '{}',
        })
      );
    });

    it('should handle already reloading status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          appId: 'app-789',
          status: 'reloading',
          message: 'Reload already in progress'
        })
      });

      const result = await client.reloadImages('sub-123', 'sys-456', 'app-789');

      expect(result.status).toBe('reloading');
      expect(result.message).toBe('Reload already in progress');
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'Internal error' }),
        text: async () => 'Internal error'
      });

      await expect(client.reloadImages('sub-123', 'sys-456', 'app-789'))
        .rejects.toThrow();
    });
  });
});
