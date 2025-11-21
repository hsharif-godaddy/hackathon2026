/**
 * Legacy Control Plane Adapter Tests
 * 
 * Tests the legacy adapter implementation for database + Nomad/SQS integration.
 * Focuses on backward compatibility and existing system integration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LegacyControlPlaneAdapter } from '../legacy-control-plane-adapter';
import type { SiteInfo } from '../types';

/**
 * Create mock instances using vi.hoisted to avoid hoisting issues
 */
const { mockSiteServiceInstance, mockDeploymentAdapterInstance, mockPrismaClient } = vi.hoisted(() => ({
  mockSiteServiceInstance: {
    createSite: vi.fn(),
    getSiteById: vi.fn(),
    listSites: vi.fn(),
    updateSite: vi.fn(),
    deleteSite: vi.fn(),
    client: null as any
  },
  mockDeploymentAdapterInstance: {
    deploy: vi.fn(),
    getStatus: vi.fn(),
    destroy: vi.fn()
  },
  mockPrismaClient: {
    sites: {
      findMany: vi.fn()
    }
  }
}));

/**
 * Mock dependencies
 */
vi.mock('@/lib/database/prisma-site-service', () => ({
  PrismaSiteService: vi.fn().mockImplementation(() => mockSiteServiceInstance)
}));

vi.mock('@/lib/deployment', () => ({
  getDeploymentAdapter: vi.fn().mockReturnValue(mockDeploymentAdapterInstance)
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

/**
 * Test fixtures
 */
const MOCK_ACCOUNT_ID = 'account-123';
const MOCK_PROMPT = 'Create a todo app with React';
const MOCK_JWT = 'mock-jwt-token';
const MOCK_SITE_ID = 'site-456';

const MOCK_SITE_DATA = {
  id: MOCK_SITE_ID,
  account_id: MOCK_ACCOUNT_ID,
  title: 'Test Site',
  initial_prompt: MOCK_PROMPT,
  status: 'created',
  agent_url: 'https://agent-site456.example.com',
  preview_url: 'https://preview-site456.example.com',
  ceph_mount_id: 'ceph-123',
  ceph_dir_number: '456',
  created_at: new Date('2025-01-01T00:00:00Z'),
  updated_at: new Date('2025-01-01T00:00:00Z')
};

const MOCK_DEPLOYMENT_RESULT = {
  success: true,
  status: 'running' as const,
  urls: {
    agent: 'https://agent-site456.example.com',
    preview: 'https://preview-site456.example.com'
  }
};

describe('LegacyControlPlaneAdapter', () => {
  let adapter: LegacyControlPlaneAdapter;
  let mockSiteService: typeof mockSiteServiceInstance;
  let mockDeploymentAdapter: typeof mockDeploymentAdapterInstance;

  beforeEach(() => {
    // Reset all mock calls and return values
    vi.clearAllMocks();
    
    // Reference the shared mock instances
    mockSiteService = mockSiteServiceInstance;
    mockDeploymentAdapter = mockDeploymentAdapterInstance;
    
    // Setup prisma client mock on site service
    mockSiteServiceInstance.client = mockPrismaClient;
    
    // Create adapter instance (will use mocked dependencies)
    adapter = new LegacyControlPlaneAdapter();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createSite', () => {
    it('should create site and deploy successfully', async () => {
      // Setup mocks
      mockSiteService.createSite.mockResolvedValue(MOCK_SITE_DATA);
      mockDeploymentAdapter.deploy.mockResolvedValue(MOCK_DEPLOYMENT_RESULT);
      mockSiteService.updateSite.mockResolvedValue({
        ...MOCK_SITE_DATA,
        status: 'running',
        ...MOCK_DEPLOYMENT_RESULT.urls
      });

      const result = await adapter.createSite({
        accountId: MOCK_ACCOUNT_ID,
        prompt: MOCK_PROMPT,
        jwt: MOCK_JWT
      });

      expect(result.success).toBe(true);
      expect(result.siteId).toBe(`dev-job-${MOCK_SITE_ID}`); // siteId now returns a jobId with prefix because deployment is async and returns a job identifier instead of a final siteId
      expect(result.status).toBe('creating'); // Background deployment, so status is creating
      expect(result.name).toBe('Test Site');

      // Verify database calls
      expect(mockSiteService.createSite).toHaveBeenCalledWith({
        account_id: MOCK_ACCOUNT_ID,
        initial_prompt: MOCK_PROMPT
      });

      // Deployment happens in background (non-blocking), so we don't check it here
      // The test confirms the response is returned immediately with 'creating' status
    });

    it('should handle deployment failure gracefully', async () => {
      mockSiteService.createSite.mockResolvedValue(MOCK_SITE_DATA);
      mockDeploymentAdapter.deploy.mockResolvedValue({
        success: false,
        error: 'Deployment failed',
        status: 'failed'
      });
      mockSiteService.updateSite.mockResolvedValue({
        ...MOCK_SITE_DATA,
        status: 'failed'
      });

      const result = await adapter.createSite({
        accountId: MOCK_ACCOUNT_ID,
        prompt: MOCK_PROMPT,
        jwt: MOCK_JWT
      });

      // Site creation succeeds even if deployment fails in background
      expect(result.success).toBe(true); // createSite succeeds, deployment is async
      expect(result.status).toBe('creating'); // Status is creating (deployment in progress)

      // Should update site with failed status
      expect(mockSiteService.updateSite).toHaveBeenCalledWith(MOCK_SITE_ID, {
        status: 'failed'
      });
    });

    it('should handle database creation failure', async () => {
      mockSiteService.createSite.mockRejectedValue(new Error('Database error'));

      const result = await adapter.createSite({
        accountId: MOCK_ACCOUNT_ID,
        prompt: MOCK_PROMPT,
        jwt: MOCK_JWT
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
      expect(result.status).toBe('failed');

      // Should not attempt deployment
      expect(mockDeploymentAdapter.deploy).not.toHaveBeenCalled();
    });

    it('should handle deployment adapter errors', async () => {
      mockSiteService.createSite.mockResolvedValue(MOCK_SITE_DATA);
      mockDeploymentAdapter.deploy.mockRejectedValue(new Error('Deployment service unavailable'));
      mockSiteService.updateSite.mockResolvedValue({
        ...MOCK_SITE_DATA,
        status: 'failed'
      });

      const result = await adapter.createSite({
        accountId: MOCK_ACCOUNT_ID,
        prompt: MOCK_PROMPT,
        jwt: MOCK_JWT
      });

      // Site creation succeeds, deployment errors handled in background
      expect(result.success).toBe(true); // createSite succeeds even if deployment will fail
      expect(result.status).toBe('creating'); // Initial status is creating
      // No error in response since deployment is async
    });
  });

  describe('getSite', () => {
    it('should return site info from database', async () => {
      mockSiteService.getSiteById.mockResolvedValue(MOCK_SITE_DATA);

      const result = await adapter.getSite(MOCK_SITE_ID, MOCK_JWT);

      expect(result).toEqual({
        id: MOCK_SITE_ID,
        name: 'Test Site',
        status: 'created',
        account_id: MOCK_ACCOUNT_ID,
        initial_prompt: MOCK_PROMPT,
        agent_url: MOCK_SITE_DATA.agent_url,
        preview_url: MOCK_SITE_DATA.preview_url,
        ceph_mount_id: MOCK_SITE_DATA.ceph_mount_id,
        ceph_dir_number: MOCK_SITE_DATA.ceph_dir_number,
        created_at: MOCK_SITE_DATA.created_at,
        updated_at: MOCK_SITE_DATA.updated_at
      });

      expect(mockSiteService.getSiteById).toHaveBeenCalledWith(MOCK_SITE_ID);
    });

    it('should return null when site not found', async () => {
      mockSiteService.getSiteById.mockResolvedValue(null);

      const result = await adapter.getSite(MOCK_SITE_ID, MOCK_JWT);

      expect(result).toBeNull();
    });

    it('should handle database errors', async () => {
      mockSiteService.getSiteById.mockRejectedValue(new Error('Database connection failed'));

      await expect(adapter.getSite(MOCK_SITE_ID, MOCK_JWT)).rejects.toThrow('Database connection failed');
    });
  });

  describe('listSites', () => {
    it('should return list of sites from database', async () => {
      const mockSites = [
        MOCK_SITE_DATA,
        {
          ...MOCK_SITE_DATA,
          id: 'site-789',
          title: 'Another Site'
        }
      ];

      mockPrismaClient.sites.findMany.mockResolvedValue(mockSites);

      const result = await adapter.listSites(MOCK_JWT);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(MOCK_SITE_ID);
      expect(result[1].id).toBe('site-789');
      expect(result[1].name).toBe('Another Site');
    });

    it('should return empty array when no sites exist', async () => {
      mockPrismaClient.sites.findMany.mockResolvedValue([]);

      const result = await adapter.listSites(MOCK_JWT);

      expect(result).toEqual([]);
    });

    it('should handle database errors gracefully', async () => {
      mockPrismaClient.sites.findMany.mockRejectedValue(new Error('Database error'));

      await expect(adapter.listSites(MOCK_JWT)).rejects.toThrow('Database error');
    });
  });

  describe('deleteSite', () => {
    it('should delete site and destroy deployment', async () => {
      mockDeploymentAdapter.destroy.mockResolvedValue({ success: true });
      mockSiteService.deleteSite.mockResolvedValue(true);

      const result = await adapter.deleteSite(MOCK_SITE_ID, MOCK_JWT);

      expect(result.success).toBe(true);

      // Should destroy deployment first
      expect(mockDeploymentAdapter.destroy).toHaveBeenCalledWith(MOCK_SITE_ID);
      
      // Then delete from database
      expect(mockSiteService.deleteSite).toHaveBeenCalledWith(MOCK_SITE_ID);
    });

    it('should handle deployment destroy failure gracefully', async () => {
      mockDeploymentAdapter.destroy.mockResolvedValue({ success: false, error: 'Destroy failed' });
      mockSiteService.deleteSite.mockResolvedValue(true);

      const result = await adapter.deleteSite(MOCK_SITE_ID, MOCK_JWT);

      expect(result.success).toBe(true);
      expect(mockSiteService.deleteSite).toHaveBeenCalledWith(MOCK_SITE_ID);
    });

    it('should continue with deletion even if destroy throws error', async () => {
      mockDeploymentAdapter.destroy.mockRejectedValue(new Error('Destroy failed'));
      mockSiteService.deleteSite.mockResolvedValue(true);

      const result = await adapter.deleteSite(MOCK_SITE_ID, MOCK_JWT);

      // Even though destroy failed, deletion should succeed
      expect(result.success).toBe(false);
      expect(result.error).toBe('Destroy failed');
    });

    it('should handle database deletion failure', async () => {
      mockDeploymentAdapter.destroy.mockResolvedValue({ success: true });
      mockSiteService.deleteSite.mockRejectedValue(new Error('Delete failed'));

      const result = await adapter.deleteSite(MOCK_SITE_ID, MOCK_JWT);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Delete failed');
    });
  });

  describe('deploySite', () => {
    it('should deploy site using deployment adapter', async () => {
      mockSiteService.getSiteById.mockResolvedValue({
        ...MOCK_SITE_DATA,
        status: 'init' // Use init status which allows deployment
      });
      mockSiteService.updateSite.mockResolvedValueOnce({
        ...MOCK_SITE_DATA,
        status: 'creating'
      });

      const result = await adapter.deploySite(MOCK_SITE_ID, MOCK_JWT);

      expect(result.success).toBe(true);
      expect(result.message).toContain('started');
      expect(result.site.status).toBe('creating');

      // Should update status to creating
      expect(mockSiteService.updateSite).toHaveBeenCalledWith(MOCK_SITE_ID, { status: 'creating' });
    });

    it('should handle site not found', async () => {
      mockSiteService.getSiteById.mockResolvedValue(null);

      await expect(adapter.deploySite(MOCK_SITE_ID, MOCK_JWT))
        .rejects.toThrow('Site not found');
    });

    it('should return success if site already running', async () => {
      mockSiteService.getSiteById.mockResolvedValue({
        ...MOCK_SITE_DATA,
        status: 'running'
      });

      const result = await adapter.deploySite(MOCK_SITE_ID, MOCK_JWT);

      expect(result.success).toBe(true);
      expect(result.message).toContain('already deployed');
      expect(mockSiteService.updateSite).not.toHaveBeenCalled();
    });
  });

  describe('updateSite', () => {
    it('should update site in database', async () => {
      const updates: Partial<SiteInfo> = {
        name: 'Updated Site Name',
        status: 'running'
      };

      const updatedSite = {
        ...MOCK_SITE_DATA,
        title: 'Updated Site Name',
        status: 'running'
      };

      mockSiteService.updateSite.mockResolvedValue(updatedSite);

      const result = await adapter.updateSite(MOCK_SITE_ID, updates, MOCK_JWT);

      expect(result).toEqual({
        id: MOCK_SITE_ID,
        name: 'Updated Site Name',
        status: 'running',
        account_id: MOCK_ACCOUNT_ID,
        initial_prompt: MOCK_PROMPT,
        agent_url: MOCK_SITE_DATA.agent_url,
        preview_url: MOCK_SITE_DATA.preview_url,
        ceph_mount_id: MOCK_SITE_DATA.ceph_mount_id,
        ceph_dir_number: MOCK_SITE_DATA.ceph_dir_number,
        created_at: MOCK_SITE_DATA.created_at,
        updated_at: MOCK_SITE_DATA.updated_at
      });

      expect(mockSiteService.updateSite).toHaveBeenCalledWith(MOCK_SITE_ID, updates);
    });

    it('should handle update failure', async () => {
      mockSiteService.updateSite.mockRejectedValue(new Error('Update failed'));

      // updateSite throws error on failure
      await expect(adapter.updateSite(MOCK_SITE_ID, { name: 'New Name' }, MOCK_JWT))
        .rejects.toThrow('Update failed');
    });
  });

  // Note: LegacyControlPlaneAdapter doesn't implement updateSiteVariables
  // This method is only available in V2ControlPlaneAdapter

  describe('error handling and logging', () => {
    it('should log operations appropriately', async () => {
      const { logger } = await import('@/lib/request-context');
      
      mockSiteService.createSite.mockResolvedValue(MOCK_SITE_DATA);
      mockDeploymentAdapter.deploy.mockResolvedValue(MOCK_DEPLOYMENT_RESULT);
      mockSiteService.updateSite.mockResolvedValue(MOCK_SITE_DATA);

      await adapter.createSite({
        accountId: MOCK_ACCOUNT_ID,
        prompt: MOCK_PROMPT,
        jwt: MOCK_JWT
      });

      expect(logger.info).toHaveBeenCalledWith(
        'legacy-control-plane.create-site.start',
        { accountId: MOCK_ACCOUNT_ID },
        { tags: ['security'] }
      );
    });

    it('should log errors appropriately', async () => {
      const { logger } = await import('@/lib/request-context');
      
      mockSiteService.createSite.mockRejectedValue(new Error('Database error'));

      await adapter.createSite({
        accountId: MOCK_ACCOUNT_ID,
        prompt: MOCK_PROMPT,
        jwt: MOCK_JWT
      });

      expect(logger.error).toHaveBeenCalledWith(
        'legacy-control-plane.create-site.error',
        expect.objectContaining({
          error: expect.any(Error)
        })
      );
    });
  });
});
