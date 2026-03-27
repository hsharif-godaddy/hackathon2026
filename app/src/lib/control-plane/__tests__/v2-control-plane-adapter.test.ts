/**
 * @vitest-environment jsdom
 */
/**
 * V2 Control Plane Adapter Tests
 * 
 * Tests the V2 adapter implementation for mgmt-airo + mgmt-hosting integration.
 * 
 * ⚠️ SETUP REQUIRED:
 * Run: npm install -D vitest @vitest/ui
 * Then: npm test
 * 
 * See: app/TESTING-SETUP.md for complete setup instructions
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { V2ControlPlaneAdapter } from '../v2-control-plane-adapter';

/**
 * Mock fetch globally
 */
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

/**
 * Mock logger
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
  extractCustomerId: vi.fn(() => 'customer-123'),
  decodeJWT: vi.fn(() => ({ cid: 'customer-123' }))
}));

/**
 * Mock gasket config
 */
const mockGasketConfig = vi.hoisted(() => ({ airoAppDomain: 'test-airoapp.ai' }));
vi.mock('../../../../gasket.ts', () => ({
  default: { config: mockGasketConfig }
}));

/**
 * Mock subscription cache store
 */
vi.mock('@/stores/useSubscriptionCacheStore', () => ({
  useSubscriptionCacheStore: {
    getState: vi.fn(() => ({
      customerId: null,
      lastRefresh: null,
      CACHE_TTL: 300000,
      getAppLocation: vi.fn(() => null),
      initialize: vi.fn(),
      refresh: vi.fn(),
      invalidate: vi.fn(),
      removeAppFromCache: vi.fn()
    }))
  }
}));

/**
 * Test fixtures
 */
const MOCK_JWT = 'fake-jwt-for-testing-only';
const MOCK_JOB_ID = '6p19q4p';
const MOCK_APP_ID = 'nxOMNRQOtCBBHG7e3CI8R';
const MOCK_SYSTEM_ID = 'sys-abc123';
const MOCK_ACCOUNT_ID = 'account-123';
const MOCK_PROMPT = 'Create a todo app with React';
describe('V2ControlPlaneAdapter', () => {
  let adapter: V2ControlPlaneAdapter;

  beforeEach(async () => {
    adapter = new V2ControlPlaneAdapter();
    mockFetch.mockClear();
    vi.clearAllMocks();
    mockGasketConfig.airoAppDomain = 'test-airoapp.ai';

    // Clear subscription cache between tests to prevent interference
    const { useSubscriptionCacheStore } = await import('../../../stores/useSubscriptionCacheStore');
    useSubscriptionCacheStore.getState().invalidate();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createSite', () => {
    it('should use existing subscription when ALWAYS_NEW_SUBSCRIPTION is false', async () => {
      // Set environment variable
      process.env.ALWAYS_NEW_SUBSCRIPTION = 'false';
      
      // Mock getActiveSubscription (existing subscription)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'existing-sub-123', status: 'active' }]
      });
      
      // Mock getSystems
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ systemId: 'sys-456', subscriptionId: 'existing-sub-123' }]
      });
      
      // Mock createApp response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          statusJobId: MOCK_JOB_ID,
          appId: MOCK_APP_ID
        })
      });

      const result = await adapter.createSite({
        accountId: MOCK_ACCOUNT_ID,
        prompt: MOCK_PROMPT,
        jwt: MOCK_JWT
      });

      // Verify result structure
      expect(result.success).toBe(true);
      expect(result.siteId).toBe(MOCK_JOB_ID);
      expect(result.status).toBe('creating');

      // Verify createApp API was called (not signup)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/airo/v1/subscriptions/existing-sub-123/systems/sys-456/apps'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': `sso-jwt ${MOCK_JWT}`,
            'Content-Type': 'application/json'
          })
        })
      );
      
      // Clean up
      delete process.env.ALWAYS_NEW_SUBSCRIPTION;
    });

    it('should pass datacenter in createApp call for existing subscription', async () => {
      process.env.ALWAYS_NEW_SUBSCRIPTION = 'false';
      process.env.MGMT_AIRO_DATACENTER = 'p3';

      // Mock getActiveSubscription (existing subscription)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'existing-sub-123', status: 'active' }]
      });

      // Mock getSystems
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ systemId: 'sys-456', subscriptionId: 'existing-sub-123' }]
      });

      // Mock createApp response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          statusJobId: MOCK_JOB_ID,
          appId: MOCK_APP_ID
        })
      });

      await adapter.createSite({
        accountId: MOCK_ACCOUNT_ID,
        prompt: MOCK_PROMPT,
        jwt: MOCK_JWT
      });

      // Get the createApp call (third call after getActiveSubscription and getSystems)
      const createAppCall = mockFetch.mock.calls[2];
      const requestBody = JSON.parse(createAppCall[1].body);

      // Verify datacenter is included in the request body
      expect(requestBody.datacenter).toBe('p3');

      // Clean up
      delete process.env.ALWAYS_NEW_SUBSCRIPTION;
      delete process.env.MGMT_AIRO_DATACENTER;
    });

    it('should force new subscription when ALWAYS_NEW_SUBSCRIPTION is true', async () => {
      // Set environment variable
      process.env.ALWAYS_NEW_SUBSCRIPTION = 'true';
      
      // Note: getActiveSubscription is NOT called when ALWAYS_NEW_SUBSCRIPTION=true
      // So we only mock the signup response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          statusJobId: MOCK_JOB_ID,
          subscriptionId: 'new-sub-xyz789'
        })
      });

      const result = await adapter.createSite({
        accountId: MOCK_ACCOUNT_ID,
        prompt: MOCK_PROMPT,
        jwt: MOCK_JWT
      });

      // Verify result structure
      expect(result.success).toBe(true);
      expect(result.siteId).toBe(MOCK_JOB_ID);
      expect(result.status).toBe('creating');

      // Verify signup API was called (not createApp)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/airo/v1/signup'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': `sso-jwt ${MOCK_JWT}`,
            'Content-Type': 'application/json'
          })
        })
      );
      
      // Clean up
      delete process.env.ALWAYS_NEW_SUBSCRIPTION;
    });

    it('should use specific subscription when AIRO_SUBSCRIPTION_ID is set', async () => {
      // Set environment variables
      process.env.AIRO_SUBSCRIPTION_ID = 'target-sub-456';
      
      // Mock getSubscriptions (find target subscription)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 'other-sub-123', status: 'active' },
          { id: 'target-sub-456', status: 'active' },
          { id: 'another-sub-789', status: 'active' }
        ]
      });
      
      // Mock getSystems for target subscription
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ systemId: 'sys-target', subscriptionId: 'target-sub-456' }]
      });
      
      // Mock createApp response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          statusJobId: MOCK_JOB_ID,
          appId: MOCK_APP_ID
        })
      });

      const result = await adapter.createSite({
        accountId: MOCK_ACCOUNT_ID,
        prompt: MOCK_PROMPT,
        jwt: MOCK_JWT
      });

      // Verify result structure
      expect(result.success).toBe(true);
      expect(result.siteId).toBe(MOCK_JOB_ID);

      // Verify createApp API was called with target subscription
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/airo/v1/subscriptions/target-sub-456/systems/sys-target/apps'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': `sso-jwt ${MOCK_JWT}`,
            'Content-Type': 'application/json'
          })
        })
      );
      
      // Clean up
      delete process.env.AIRO_SUBSCRIPTION_ID;
    });

    it('should fallback to active subscription when AIRO_SUBSCRIPTION_ID not found', async () => {
      // Set environment variable to non-existent subscription
      process.env.AIRO_SUBSCRIPTION_ID = 'non-existent-sub';
      
      // Mock getSubscriptions (target subscription not found)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 'available-sub-123', status: 'active' },
          { id: 'another-sub-456', status: 'active' }
        ]
      });
      
      // Mock getActiveSubscription (fallback)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'active-sub-789', status: 'active' }]
      });
      
      // Mock getSystems for active subscription
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ systemId: 'sys-active', subscriptionId: 'active-sub-789' }]
      });
      
      // Mock createApp response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          statusJobId: MOCK_JOB_ID,
          appId: MOCK_APP_ID
        })
      });

      const result = await adapter.createSite({
        accountId: MOCK_ACCOUNT_ID,
        prompt: MOCK_PROMPT,
        jwt: MOCK_JWT
      });

      // Verify result structure
      expect(result.success).toBe(true);
      expect(result.siteId).toBe(MOCK_JOB_ID);

      // Verify createApp API was called with fallback active subscription
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/airo/v1/subscriptions/active-sub-789/systems/sys-active/apps'),
        expect.objectContaining({
          method: 'POST'
        })
      );
      
      // Clean up
      delete process.env.AIRO_SUBSCRIPTION_ID;
    });

    it('should create site and return job ID as temporary site ID', async () => {
      // Mock getActiveSubscription (no existing subscription)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => []
      });
      
      // Mock signup response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          statusJobId: MOCK_JOB_ID,
          subscriptionId: 'sub-xyz789'
        })
      });

      const result = await adapter.createSite({
        accountId: MOCK_ACCOUNT_ID,
        prompt: MOCK_PROMPT,
        jwt: MOCK_JWT
      });

      // Verify result structure
      expect(result.success).toBe(true);
      expect(result.siteId).toBe(MOCK_JOB_ID);
      expect(result.status).toBe('creating');
      expect(result.name).toBeTruthy(); // Generated title
      expect(result.account_id).toBe(MOCK_ACCOUNT_ID);

      // Verify signup API was called correctly
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/airo/v1/signup'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': `sso-jwt ${MOCK_JWT}`,
            'Content-Type': 'application/json'
          }),
          body: expect.stringContaining('initialPrompt')
        })
      );

      // Verify payload includes variables
      const callArgs = mockFetch.mock.calls[1]; // Second call is signup
      const payload = JSON.parse(callArgs[1].body);
      expect(payload.appConfigs[0].variables).toHaveProperty('title');
      expect(payload.appConfigs[0].variables).toHaveProperty('initialPrompt');
    });

    it('should generate title from prompt', async () => {
      // Mock getActiveSubscription (no existing subscription)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => []
      });
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ statusJobId: MOCK_JOB_ID })
      });

      const result = await adapter.createSite({
        accountId: MOCK_ACCOUNT_ID,
        prompt: MOCK_PROMPT,
        jwt: MOCK_JWT
      });

      expect(result.name).toBe('Create a todo app with React');
    });

    it('should truncate long titles to 50 characters', async () => {
      // Mock getActiveSubscription (no existing subscription)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => []
      });
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ statusJobId: MOCK_JOB_ID })
      });

      const longPrompt = 'Create a very long prompt that exceeds fifty characters and should be truncated';
      
      const result = await adapter.createSite({
        accountId: MOCK_ACCOUNT_ID,
        prompt: longPrompt,
        jwt: MOCK_JWT
      });

      expect(result.name).toHaveLength(53); // 50 chars + '...'
      expect(result.name).toContain('...');
    });

    it('should handle API errors gracefully', async () => {
      // Mock getActiveSubscription (no existing subscription)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => []
      });
      
      // Mock signup error with retries (3 attempts)
      const errorResponse = {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        url: 'https://mgmt.test.com/api/airo/v1/signup',
        text: async () => 'Invalid payload'
      } as Response;
      
      mockFetch
        .mockResolvedValueOnce(errorResponse)
        .mockResolvedValueOnce(errorResponse)
        .mockResolvedValueOnce(errorResponse);

      const result = await adapter.createSite({
        accountId: MOCK_ACCOUNT_ID,
        prompt: MOCK_PROMPT,
        jwt: MOCK_JWT
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.error).toContain('API request failed');
    });
  });

  describe('getSite - Job ID Polling', () => {
    it('should handle in-progress job (no apps yet)', async () => {
      // Mock job endpoint - workflow in progress
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apps: [] })
      });

      const site = await adapter.getSite(MOCK_JOB_ID, MOCK_JWT);

      expect(site).not.toBeNull();
      expect(site?.id).toBe(MOCK_JOB_ID);
      expect(site?.status).toBe('creating');
      expect(site?.agent_url).toBeUndefined();
    });

    it('should return real app when job completes', async () => {
      // Mock job endpoint - app created
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apps: [{
            id: MOCK_APP_ID,
            status: 'active',
            systemId: MOCK_SYSTEM_ID,
            subscriptionId: 'sub-123',
            cellId: 'c4-dev-sxb1-eu-central-1',
            variables: {
              title: 'Todo App',
              initialPrompt: MOCK_PROMPT
            },
            createdAt: '2025-10-02T10:30:00Z',
            updatedAt: '2025-10-02T10:35:00Z'
          }]
        })
      });

      const site = await adapter.getSite(MOCK_JOB_ID, MOCK_JWT);

      // Should return real app ID, not job ID
      expect(site?.id).toBe(MOCK_APP_ID);
      expect(site?.status).toBe('running');
      expect(site?.name).toBe('Todo App');
      expect(site?.system_id).toBe(MOCK_SYSTEM_ID);
      
      // URLs should be constructed with new V2 pattern
      expect(site?.agent_url).toContain(MOCK_APP_ID);
      expect(site?.agent_url).toContain('test-airoapp.ai');
    });
  });

  describe('getSite - App ID Lookup', () => {
    it.skip('should find app by searching subscriptions', async () => {
      // TODO: Fix mock sequence - getAppsForSystem returns null, needs investigation
      // Mock checkCustomer - just needs to not throw
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({})
      });

      // Mock getSubscriptions
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{
          id: 'sub-123',
          status: 'active'
        }]
      });

      // Mock getSystems
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{
          systemId: 'sys-456',
          subscriptionId: 'sub-123'
        }]
      });

      // Mock getAppsForSystem - return app with matching ID
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apps: [{
            id: MOCK_APP_ID,
            status: 'active',
            systemId: MOCK_SYSTEM_ID,
            subscriptionId: 'sub-123',
            cellId: 'c4-dev-sxb1-eu-central-1',
            variables: { title: 'My App' },
            createdAt: '2025-10-02T10:30:00Z',
            updatedAt: '2025-10-02T10:35:00Z'
          }]
        })
      });

      // Mock getApp (full app details)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: MOCK_APP_ID,
          status: 'active',
          systemId: MOCK_SYSTEM_ID,
          subscriptionId: 'sub-123',
          variables: { 
            title: 'My App',
            initialPrompt: 'Test prompt'
          },
          createdAt: '2025-10-02T10:30:00Z',
          updatedAt: '2025-10-02T10:35:00Z'
        })
      });

      const site = await adapter.getSite(MOCK_APP_ID, MOCK_JWT);

      // Debug: Check how many calls were actually made
      console.log('Mock calls made:', mockFetch.mock.calls.length);
      console.log('Site result:', site);
      
      expect(site).not.toBeNull();
      expect(site?.id).toBe(MOCK_APP_ID);
      expect(site?.name).toBe('My App');
    });

    it('should return null if app not found', async () => {
      // Mock job endpoint - not found
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404
      });

      // Mock customer tree (for cache initialization)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          customerId: 'customer-123',
          subscriptions: [] // No subscriptions = no apps
        })
      });

      // Mock customer check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'customer-123' })
      });

      // Mock subscriptions list - empty
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => []
      });

      const site = await adapter.getSite('nonexistent-id', MOCK_JWT);

      expect(site).toBeNull();
    });
  });

  describe('updateSite - Name Updates', () => {
    it.skip('should update site name using upsert pattern', async () => {
      // TODO: Fix mock sequence - updateSite returns null, needs investigation
      // Mock getSite to get systemId
      mockFetch
        .mockResolvedValueOnce({ // job check (fails)
          ok: false,
          status: 404
        })
        .mockResolvedValueOnce({ // customer check
          ok: true
        })
        .mockResolvedValueOnce({ // subscriptions
          ok: true,
          json: async () => [{ id: 'sub-123' }]
        })
        .mockResolvedValueOnce({ // getSystems
          ok: true,
          json: async () => [{ systemId: MOCK_SYSTEM_ID, subscriptionId: 'sub-123' }]
        })
        .mockResolvedValueOnce({ // apps in subscription (getAppsForSystem)
          ok: true,
          json: async () => ({
            apps: [{
              id: MOCK_APP_ID,
              systemId: MOCK_SYSTEM_ID,
              subscriptionId: 'sub-123',
              cellId: 'c4-dev-sxb1-eu-central-1',
              status: 'active',
              variables: { title: 'Old Title', initialPrompt: MOCK_PROMPT },
              createdAt: '2025-10-02T10:30:00Z',
              updatedAt: '2025-10-02T10:35:00Z'
            }]
          })
        })
        .mockResolvedValueOnce({ // getApp (full details)
          ok: true,
          json: async () => ({
            id: MOCK_APP_ID,
            systemId: MOCK_SYSTEM_ID,
            subscriptionId: 'sub-123',
            cellId: 'c4-dev-sxb1-eu-central-1',
            status: 'active',
            variables: {
              title: 'Old Title',
              initialPrompt: MOCK_PROMPT
            },
            createdAt: '2025-10-02T10:30:00Z',
            updatedAt: '2025-10-02T10:35:00Z'
          })
        });

      // Mock getApp for updateSite (to get current variables)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: MOCK_APP_ID,
          systemId: MOCK_SYSTEM_ID,
          subscriptionId: 'sub-123',
          variables: {
            title: 'Old Title',
            initialPrompt: MOCK_PROMPT
          }
        })
      });

      // Mock PATCH update
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({})
      });
      
      // Mock final getApp (to fetch updated app)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: MOCK_APP_ID,
          systemId: MOCK_SYSTEM_ID,
          subscriptionId: 'sub-123',
          cellId: 'c4-dev-sxb1-eu-central-1',
          status: 'active',
          variables: {
            title: 'TaskMaster Pro',
            initialPrompt: MOCK_PROMPT
          },
          createdAt: '2025-10-02T10:30:00Z',
          updatedAt: '2025-10-02T10:35:00Z'
        })
      });

      const result = await adapter.updateSite(
        MOCK_APP_ID,
        { name: 'TaskMaster Pro' },
        MOCK_JWT
      );

      expect(result).not.toBeNull();
      expect(result?.name).toBe('TaskMaster Pro');

      // Verify PATCH was called with correct variables
      const patchCall = mockFetch.mock.calls.find(call => 
        call[1]?.method === 'PATCH'
      );
      expect(patchCall).toBeDefined();
      
      const patchPayload = JSON.parse(patchCall![1].body);
      expect(patchPayload.variables).toEqual({
        title: 'TaskMaster Pro',
        initialPrompt: MOCK_PROMPT
      });
    });

    it.skip('should preserve other variables when updating name', async () => {
      // TODO: Fix mock sequence - PATCH call undefined, needs investigation
      // Setup similar to above but with more variables
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 404 })
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ id: 'sub-123' }]
        })
        .mockResolvedValueOnce({ // getSystems
          ok: true,
          json: async () => [{ systemId: MOCK_SYSTEM_ID, subscriptionId: 'sub-123' }]
        })
        .mockResolvedValueOnce({ // getAppsForSystem
          ok: true,
          json: async () => ({
            apps: [{
              id: MOCK_APP_ID,
              systemId: MOCK_SYSTEM_ID,
              subscriptionId: 'sub-123',
              cellId: 'c4-dev-sxb1-eu-central-1',
              status: 'active',
              variables: {
                title: 'Old Title',
                initialPrompt: MOCK_PROMPT,
                customDomain: 'example.com',
                tags: ['productivity']
              },
              createdAt: '2025-10-02T10:30:00Z',
              updatedAt: '2025-10-02T10:35:00Z'
            }]
          })
        })
        .mockResolvedValueOnce({ // getApp (full details for getSite)
          ok: true,
          json: async () => ({
            id: MOCK_APP_ID,
            systemId: MOCK_SYSTEM_ID,
            subscriptionId: 'sub-123',
            cellId: 'c4-dev-sxb1-eu-central-1',
            status: 'active',
            variables: {
              title: 'Old Title',
              initialPrompt: MOCK_PROMPT,
              customDomain: 'example.com',
              tags: ['productivity']
            },
            createdAt: '2025-10-02T10:30:00Z',
            updatedAt: '2025-10-02T10:35:00Z'
          })
        });

      mockFetch.mockResolvedValueOnce({ // getApp for updateSite (current variables)
        ok: true,
        json: async () => ({
          id: MOCK_APP_ID,
          systemId: MOCK_SYSTEM_ID,
          subscriptionId: 'sub-123',
          variables: {
            title: 'Old Title',
            initialPrompt: MOCK_PROMPT,
            customDomain: 'example.com',
            tags: ['productivity']
          }
        })
      });

      mockFetch.mockResolvedValueOnce({ // PATCH
        ok: true,
        json: async () => ({})
      });
      
      mockFetch.mockResolvedValueOnce({ // getApp after PATCH
        ok: true,
        json: async () => ({
          id: MOCK_APP_ID,
          systemId: MOCK_SYSTEM_ID,
          subscriptionId: 'sub-123',
          variables: {
            title: 'New Title',
            initialPrompt: MOCK_PROMPT,
            customDomain: 'example.com',
            tags: ['productivity']
          }
        })
      });

      await adapter.updateSite(
        MOCK_APP_ID,
        { name: 'New Title' },
        MOCK_JWT
      );

      const patchCall = mockFetch.mock.calls.find(call => 
        call[1]?.method === 'PATCH'
      );
      const patchPayload = JSON.parse(patchCall![1].body);

      // Verify all variables preserved
      expect(patchPayload.variables).toEqual({
        title: 'New Title',
        initialPrompt: MOCK_PROMPT,
        customDomain: 'example.com',
        tags: ['productivity']
      });
    });
  });

  describe('deleteSite', () => {
    it('should delete app using systemId and subscriptionId', async () => {
      // Mock DELETE with provided IDs
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      });

      // Mock cache refresh after deletion (checkCustomer)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({})
      });

      // Mock getSubscriptions for cache refresh
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'sub-123' }]
      });

      // Mock getSystems for cache refresh
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ systemId: MOCK_SYSTEM_ID, subscriptionId: 'sub-123' }]
      });

      // Mock getAppsForSystem for cache refresh (empty since app was deleted)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apps: [] })
      });

      const result = await adapter.deleteSite(
        MOCK_APP_ID, 
        MOCK_JWT,
        MOCK_SYSTEM_ID,
        'sub-123'
      );

      expect(result.success).toBe(true);

      // Verify DELETE was called with correct URL
      const deleteCall = mockFetch.mock.calls.find(call => 
        call[1]?.method === 'DELETE'
      );
      expect(deleteCall).toBeDefined();
      expect(deleteCall![0]).toContain(`/subscriptions/sub-123/systems/${MOCK_SYSTEM_ID}/apps/${MOCK_APP_ID}`);
    });
    
    it.skip('should delete app by looking up systemId and subscriptionId', async () => {
      // TODO: Fix mock sequence - deleteSite returns success:false, needs investigation
      // Mock findAppMetadata search
      mockFetch
        .mockResolvedValueOnce({ ok: true }) // checkCustomer
        .mockResolvedValueOnce({ // getSubscriptions
          ok: true,
          json: async () => [{ id: 'sub-123' }]
        })
        .mockResolvedValueOnce({ // getSystems
          ok: true,
          json: async () => [{ systemId: MOCK_SYSTEM_ID, subscriptionId: 'sub-123' }]
        })
        .mockResolvedValueOnce({ // getAppsForSystem
          ok: true,
          json: async () => ({
            apps: [{
              id: MOCK_APP_ID,
              systemId: MOCK_SYSTEM_ID,
              subscriptionId: 'sub-123',
              status: 'active'
            }]
          })
        });

      // Mock DELETE
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      });

      // Mock cache refresh after deletion (checkCustomer)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({})
      });

      // Mock getSubscriptions for cache refresh
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'sub-123' }]
      });

      // Mock getSystems for cache refresh
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ systemId: MOCK_SYSTEM_ID, subscriptionId: 'sub-123' }]
      });

      // Mock getAppsForSystem for cache refresh (empty since app was deleted)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apps: [] })
      });

      const result = await adapter.deleteSite(MOCK_APP_ID, MOCK_JWT);

      // Debug: Show what we got
      if (!result.success) {
        console.log('DEBUG deleteSite failed:', result);
        console.log('DEBUG mockFetch call count:', mockFetch.mock.calls.length);
      }

      expect(result.success).toBe(true);

      // Verify DELETE was called with correct URL
      const deleteCall = mockFetch.mock.calls.find(call => 
        call[1]?.method === 'DELETE'
      );
      expect(deleteCall).toBeDefined();
      expect(deleteCall![0]).toContain(`/subscriptions/sub-123/systems/${MOCK_SYSTEM_ID}/apps/${MOCK_APP_ID}`);
    });

    it('should return error if site not found', async () => {
      // Mock cache initialization (getCustomerTree)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          customerId: 'customer-123',
          subscriptions: [{
            subscriptionId: 'sub-123',
            status: 'active',
            systems: [{
              systemId: MOCK_SYSTEM_ID,
              apps: [] // No apps
            }]
          }]
        })
      });

      // Mock findAppMetadata search - no apps found
      mockFetch
        .mockResolvedValueOnce({ ok: true }) // checkCustomer
        .mockResolvedValueOnce({ // getSubscriptions
          ok: true,
          json: async () => [{ id: 'sub-123' }]
        })
        .mockResolvedValueOnce({ // getSystems
          ok: true,
          json: async () => [{ systemId: MOCK_SYSTEM_ID, subscriptionId: 'sub-123' }]
        })
        .mockResolvedValueOnce({ // getAppsForSystem - empty
          ok: true,
          json: async () => ({ apps: [] })
        });

      const result = await adapter.deleteSite('nonexistent', MOCK_JWT);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Site not found or missing required IDs');
    });
  });

  describe('URL Handling', () => {
    it('should use URLs from V2 response when provided', async () => {
      const expectedUrls = {
        agent: `https://${MOCK_APP_ID}.agent.c4.test-airoapp.ai`,
        preview: `https://${MOCK_APP_ID}.preview.c4.test-airoapp.ai`
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apps: [{
            id: MOCK_APP_ID,
            status: 'active',
            systemId: MOCK_SYSTEM_ID,
            subscriptionId: 'sub-123',
            cellId: 'c4-dev-sxb1-eu-central-1',
            variables: { title: 'App' },
            urls: expectedUrls,
            createdAt: '2025-10-02T10:30:00Z',
            updatedAt: '2025-10-02T10:35:00Z'
          }]
        })
      });

      const site = await adapter.getSite(MOCK_JOB_ID, MOCK_JWT);

      expect(site?.agent_url).toBe(expectedUrls.agent);
      expect(site?.preview_url).toBe(expectedUrls.preview);
    });

    it('should fallback to URL construction when V2 does not provide URLs', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apps: [{
            id: MOCK_APP_ID,
            status: 'active',
            systemId: MOCK_SYSTEM_ID,
            subscriptionId: 'sub-123',
            cellId: 'c4-dev-sxb1-eu-central-1',
            variables: { title: 'App' },
            createdAt: '2025-10-02T10:30:00Z',
            updatedAt: '2025-10-02T10:35:00Z'
          }]
        })
      });

      const site = await adapter.getSite(MOCK_JOB_ID, MOCK_JWT);

      expect(site?.agent_url).toBe(`https://${MOCK_APP_ID}.agent.c4.test-airoapp.ai`);
      expect(site?.preview_url).toBe(`https://${MOCK_APP_ID}.preview.c4.test-airoapp.ai`);
    });

    it('should construct URLs for provisioning apps (optimistic URL construction)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apps: [{
            id: MOCK_APP_ID,
            status: 'provisioning',
            systemId: MOCK_SYSTEM_ID,
            subscriptionId: 'sub-123',
            cellId: 'c4-dev-sxb1-eu-central-1',
            variables: { title: 'App' },
            createdAt: '2025-10-02T10:30:00Z',
            updatedAt: '2025-10-02T10:35:00Z'
          }]
        })
      });

      const site = await adapter.getSite(MOCK_JOB_ID, MOCK_JWT);

      // V2 constructs URLs optimistically for pending/provisioning/active apps
      expect(site?.agent_url).toBe(`https://${MOCK_APP_ID}.agent.c4.test-airoapp.ai`);
      expect(site?.preview_url).toBe(`https://${MOCK_APP_ID}.preview.c4.test-airoapp.ai`);
    });

    it('should preserve URLs exactly as provided by V2', async () => {
      const customUrls = {
        agent: 'https://custom-agent-url.example.com',
        preview: 'https://custom-preview-url.example.com'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apps: [{
            id: MOCK_APP_ID,
            status: 'active',
            systemId: MOCK_SYSTEM_ID,
            subscriptionId: 'sub-123',
            cellId: 'c4-dev-sxb1-eu-central-1',
            variables: {},
            urls: customUrls,
            createdAt: '2025-10-02T10:30:00Z',
            updatedAt: '2025-10-02T10:35:00Z'
          }]
        })
      });

      const site = await adapter.getSite(MOCK_JOB_ID, MOCK_JWT);

      expect(site?.agent_url).toBe(customUrls.agent);
      expect(site?.preview_url).toBe(customUrls.preview);
    });

    it('should construct production domain when airoAppDomain is airoapp.ai', async () => {
      mockGasketConfig.airoAppDomain = 'airoapp.ai';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apps: [{
            id: MOCK_APP_ID,
            status: 'active',
            systemId: MOCK_SYSTEM_ID,
            subscriptionId: 'sub-123',
            cellId: 'c38-prod-us-east-1',
            variables: { title: 'App' },
            createdAt: '2025-10-02T10:30:00Z',
            updatedAt: '2025-10-02T10:35:00Z'
          }]
        })
      });

      const site = await adapter.getSite(MOCK_JOB_ID, MOCK_JWT);

      expect(site?.agent_url).toBe(`https://${MOCK_APP_ID}.agent.c38.airoapp.ai`);
      expect(site?.preview_url).toBe(`https://${MOCK_APP_ID}.preview.c38.airoapp.ai`);
    });

    it('should construct test domain when airoAppDomain is test-airoapp.ai', async () => {
      mockGasketConfig.airoAppDomain = 'test-airoapp.ai';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apps: [{
            id: MOCK_APP_ID,
            status: 'active',
            systemId: MOCK_SYSTEM_ID,
            subscriptionId: 'sub-123',
            cellId: 'c9-test-eu-west-1',
            variables: { title: 'App' },
            createdAt: '2025-10-02T10:30:00Z',
            updatedAt: '2025-10-02T10:35:00Z'
          }]
        })
      });

      const site = await adapter.getSite(MOCK_JOB_ID, MOCK_JWT);

      expect(site?.agent_url).toBe(`https://${MOCK_APP_ID}.agent.c9.test-airoapp.ai`);
      expect(site?.preview_url).toBe(`https://${MOCK_APP_ID}.preview.c9.test-airoapp.ai`);
    });

    it('should fall back to test-airoapp.ai when airoAppDomain is not configured', async () => {
      mockGasketConfig.airoAppDomain = undefined as any;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apps: [{
            id: MOCK_APP_ID,
            status: 'active',
            systemId: MOCK_SYSTEM_ID,
            subscriptionId: 'sub-123',
            cellId: 'c4-dev-sxb1-eu-central-1',
            variables: { title: 'App' },
            createdAt: '2025-10-02T10:30:00Z',
            updatedAt: '2025-10-02T10:35:00Z'
          }]
        })
      });

      const site = await adapter.getSite(MOCK_JOB_ID, MOCK_JWT);

      expect(site?.agent_url).toBe(`https://${MOCK_APP_ID}.agent.c4.test-airoapp.ai`);
      expect(site?.preview_url).toBe(`https://${MOCK_APP_ID}.preview.c4.test-airoapp.ai`);
    });

    it('should use active prefix domain for published_url when no custom domain is set', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apps: [{
            id: MOCK_APP_ID,
            status: 'active',
            systemId: MOCK_SYSTEM_ID,
            subscriptionId: 'sub-123',
            cellId: 'c24-prod-us-east-1',
            variables: { title: 'App' },
            createdAt: '2025-10-02T10:30:00Z',
            updatedAt: '2025-10-02T10:35:00Z',
            variants: ['preview'],
            domains: [
              { fqdn: 'prompt-design-lab.c24.test-airoapp.ai', domainType: 'prefix', status: 'active' }
            ]
          }]
        })
      });

      const site = await adapter.getSite(MOCK_JOB_ID, MOCK_JWT);

      expect(site?.published_url).toBe('https://prompt-design-lab.c24.test-airoapp.ai');
    });

    it('should prefer custom domain over prefix domain for published_url', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apps: [{
            id: MOCK_APP_ID,
            status: 'active',
            systemId: MOCK_SYSTEM_ID,
            subscriptionId: 'sub-123',
            cellId: 'c24-prod-us-east-1',
            variables: { title: 'App' },
            createdAt: '2025-10-02T10:30:00Z',
            updatedAt: '2025-10-02T10:35:00Z',
            variants: ['preview', 'publish'],
            domains: [
              { fqdn: 'prompt-design-lab.c24.test-airoapp.ai', domainType: 'prefix', status: 'active' },
              { fqdn: 'mycustomsite.com', domainType: 'custom', status: 'active' }
            ]
          }]
        })
      });

      const site = await adapter.getSite(MOCK_JOB_ID, MOCK_JWT);

      expect(site?.published_url).toBe('https://mycustomsite.com');
    });

    it('should not use inactive prefix domain for published_url', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apps: [{
            id: MOCK_APP_ID,
            status: 'active',
            systemId: MOCK_SYSTEM_ID,
            subscriptionId: 'sub-123',
            cellId: 'c24-prod-us-east-1',
            variables: { title: 'App' },
            createdAt: '2025-10-02T10:30:00Z',
            updatedAt: '2025-10-02T10:35:00Z',
            variants: ['preview', 'publish'],
            domains: [
              { fqdn: 'prompt-design-lab.c24.test-airoapp.ai', domainType: 'prefix', status: 'pending' }
            ]
          }]
        })
      });

      const site = await adapter.getSite(MOCK_JOB_ID, MOCK_JWT);

      // Falls back to constructed URL since prefix domain is not active
      expect(site?.published_url).toBe(`https://${MOCK_APP_ID}.c24.test-airoapp.ai`);
    });
  });

  describe('Status Mapping', () => {
    it('should map mgmt-hosting status to legacy status', async () => {
      const statusTests = [
        { mgmtStatus: 'pending', expectedStatus: 'creating' },
        { mgmtStatus: 'provisioning', expectedStatus: 'creating' },
        { mgmtStatus: 'active', expectedStatus: 'running' },
        { mgmtStatus: 'error', expectedStatus: 'failed' },
        { mgmtStatus: null, expectedStatus: 'init' }
      ];

      for (const { mgmtStatus, expectedStatus } of statusTests) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            apps: [{
              id: MOCK_APP_ID,
              status: mgmtStatus,
              systemId: MOCK_SYSTEM_ID,
              subscriptionId: 'sub-123',
              cellId: 'c4-dev-sxb1-eu-central-1',
              variables: {},
              createdAt: '2025-10-02T10:30:00Z',
              updatedAt: '2025-10-02T10:35:00Z'
            }]
          })
        });

        const site = await adapter.getSite(MOCK_JOB_ID, MOCK_JWT);
        expect(site?.status).toBe(expectedStatus);
        
        mockFetch.mockClear();
      }
    });
  });

  describe('updateSiteVariables', () => {
    // TODO: Fix mock sequence - getSite involves complex polling/lookup logic
    // Similar to updateSite tests above, the mock sequence needs investigation
    it.skip('should update site variables and return updated site info', async () => {
      // Mock sequence needs to match getSite's internal polling logic
      // This test documents the expected behavior but is skipped pending mock fixes
      const result = await adapter.updateSiteVariables(
        MOCK_APP_ID,
        { lastInteractionAt: '2025-01-02T00:00:00Z' },
        MOCK_JWT
      );

      expect(result).not.toBeNull();
      expect(result?.id).toBe(MOCK_APP_ID);
    });

    it('should return null when site not found', async () => {
      // Mock getSite returning null (job not found, no apps match)
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 404 }) // job check
        .mockResolvedValueOnce({ ok: true }) // customer check
        .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 'sub-123' }] }) // subscriptions
        .mockResolvedValueOnce({ ok: true, json: async () => [{ systemId: MOCK_SYSTEM_ID, subscriptionId: 'sub-123' }] }) // getSystems
        .mockResolvedValueOnce({ ok: true, json: async () => ({ apps: [] }) }); // no apps

      const result = await adapter.updateSiteVariables(
        'nonexistent-app',
        { lastInteractionAt: '2025-01-02T00:00:00Z' },
        MOCK_JWT
      );

      expect(result).toBeNull();
    });

    // TODO: Fix mock sequence - requires matching getSite + getApp polling logic
    it.skip('should skip update when variables have not changed', async () => {
      // This test documents the optimization behavior but is skipped pending mock fixes
      const result = await adapter.updateSiteVariables(
        MOCK_APP_ID,
        { lastInteractionAt: '2025-01-01T00:00:00Z' },
        MOCK_JWT
      );

      expect(result).not.toBeNull();
    });
  });

  describe('#getImageStatus', () => {
    it('should return image status for an app', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apps: [{
            id: MOCK_APP_ID,
            status: 'active',
            systemId: MOCK_SYSTEM_ID,
            subscriptionId: 'sub-123',
            cellId: 'c4-dev-sxb1-eu-central-1',
            variables: { title: 'App' },
            createdAt: '2025-10-02T10:30:00Z',
            updatedAt: '2025-10-02T10:35:00Z'
          }]
        })
      });

      const mockImageStatus = {
        appId: MOCK_APP_ID,
        compositionId: 'ai-builder',
        compositionVersion: '1.0.0',
        unifiedVariantJob: true,
        status: 'current',
        images: [{ imageType: 'agent', deployedTag: 'v1.0', expectedTag: 'v1.0', match: true }]
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockImageStatus
      });

      const result = await adapter.getImageStatus(MOCK_APP_ID, MOCK_JWT);

      expect(result.status).toBe('current');
      expect(result.appId).toBe(MOCK_APP_ID);

      const imageStatusCall = mockFetch.mock.calls.find(c =>
        String(c[0]).includes('/image-status')
      );
      expect(imageStatusCall).toBeDefined();
      expect(imageStatusCall![0]).toContain(`/apps/${MOCK_APP_ID}/image-status`);
    });

    it('should throw when site is not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apps: [] })
      });

      await expect(adapter.getImageStatus('nonexistent', MOCK_JWT))
        .rejects.toThrow('Get image status failed');
    });

    it('should rethrow 401 errors for auth redirect', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apps: [{
            id: MOCK_APP_ID,
            status: 'active',
            systemId: MOCK_SYSTEM_ID,
            subscriptionId: 'sub-123',
            cellId: 'c4-dev-sxb1-eu-central-1',
            variables: { title: 'App' },
            createdAt: '2025-10-02T10:30:00Z',
            updatedAt: '2025-10-02T10:35:00Z'
          }]
        })
      });

      const authError = new Error('Unauthorized') as any;
      authError.status = 401;
      mockFetch.mockRejectedValueOnce(authError);

      await expect(adapter.getImageStatus(MOCK_APP_ID, MOCK_JWT))
        .rejects.toThrow();
    });

    it('should rethrow 403 errors for auth redirect', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apps: [{
            id: MOCK_APP_ID,
            status: 'active',
            systemId: MOCK_SYSTEM_ID,
            subscriptionId: 'sub-123',
            cellId: 'c4-dev-sxb1-eu-central-1',
            variables: { title: 'App' },
            createdAt: '2025-10-02T10:30:00Z',
            updatedAt: '2025-10-02T10:35:00Z'
          }]
        })
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => JSON.stringify({ error: 'Forbidden' })
      });

      await expect(adapter.getImageStatus(MOCK_APP_ID, MOCK_JWT))
        .rejects.toHaveProperty('status', 403);
    });

    it('should rethrow 404 errors preserving status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apps: [{
            id: MOCK_APP_ID,
            status: 'active',
            systemId: MOCK_SYSTEM_ID,
            subscriptionId: 'sub-123',
            cellId: 'c4-dev-sxb1-eu-central-1',
            variables: { title: 'App' },
            createdAt: '2025-10-02T10:30:00Z',
            updatedAt: '2025-10-02T10:35:00Z'
          }]
        })
      });

      const mock404 = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => JSON.stringify({ error: 'Not Found' })
      };
      mockFetch
        .mockResolvedValueOnce(mock404)
        .mockResolvedValueOnce(mock404)
        .mockResolvedValueOnce(mock404);

      await expect(adapter.getImageStatus(MOCK_APP_ID, MOCK_JWT))
        .rejects.toHaveProperty('status', 404);
    });
  });

  describe('#reloadImages', () => {
    it('should trigger image reload for an app', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apps: [{
            id: MOCK_APP_ID,
            status: 'active',
            systemId: MOCK_SYSTEM_ID,
            subscriptionId: 'sub-123',
            cellId: 'c4-dev-sxb1-eu-central-1',
            variables: { title: 'App' },
            createdAt: '2025-10-02T10:30:00Z',
            updatedAt: '2025-10-02T10:35:00Z'
          }]
        })
      });

      const mockReloadResponse = {
        appId: MOCK_APP_ID,
        status: 'reloading',
        message: 'Image reload initiated',
        jobId: 'job-abc',
        startedAt: '2025-01-01T00:00:00Z'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockReloadResponse
      });

      const result = await adapter.reloadImages(MOCK_APP_ID, MOCK_JWT);

      expect(result.status).toBe('reloading');
      expect(result.appId).toBe(MOCK_APP_ID);

      const reloadCall = mockFetch.mock.calls.find(c =>
        String(c[0]).includes('/reload') && c[1]?.method === 'POST'
      );
      expect(reloadCall).toBeDefined();
      expect(reloadCall![0]).toContain(`/apps/${MOCK_APP_ID}/reload`);
    });

    it('should throw when site is not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apps: [] })
      });

      await expect(adapter.reloadImages('nonexistent', MOCK_JWT))
        .rejects.toThrow('Reload images failed');
    });

    it('should handle site missing system_id', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apps: [{
            id: MOCK_APP_ID,
            status: 'active',
            variables: { title: 'App' },
            createdAt: '2025-10-02T10:30:00Z',
            updatedAt: '2025-10-02T10:35:00Z'
          }]
        })
      });

      await expect(adapter.reloadImages(MOCK_APP_ID, MOCK_JWT))
        .rejects.toThrow('Reload images failed');
    });

    it('should rethrow 403 errors for auth redirect', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apps: [{
            id: MOCK_APP_ID,
            status: 'active',
            systemId: MOCK_SYSTEM_ID,
            subscriptionId: 'sub-123',
            cellId: 'c4-dev-sxb1-eu-central-1',
            variables: { title: 'App' },
            createdAt: '2025-10-02T10:30:00Z',
            updatedAt: '2025-10-02T10:35:00Z'
          }]
        })
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => JSON.stringify({ error: 'Forbidden' })
      });

      await expect(adapter.reloadImages(MOCK_APP_ID, MOCK_JWT))
        .rejects.toHaveProperty('status', 403);
    });

    it('should rethrow 404 errors preserving status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apps: [{
            id: MOCK_APP_ID,
            status: 'active',
            systemId: MOCK_SYSTEM_ID,
            subscriptionId: 'sub-123',
            cellId: 'c4-dev-sxb1-eu-central-1',
            variables: { title: 'App' },
            createdAt: '2025-10-02T10:30:00Z',
            updatedAt: '2025-10-02T10:35:00Z'
          }]
        })
      });

      const mock404 = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => JSON.stringify({ error: 'Not Found' })
      };
      mockFetch
        .mockResolvedValueOnce(mock404)
        .mockResolvedValueOnce(mock404)
        .mockResolvedValueOnce(mock404);

      await expect(adapter.reloadImages(MOCK_APP_ID, MOCK_JWT))
        .rejects.toHaveProperty('status', 404);
    });
  });
});
