import type {
  ArchiveRestoreResponse,
  ArchiveStatusResponse,
  CreateSiteParams,
  CreateSiteResult,
  DeploySiteOptions,
  IControlPlaneAdapter,
  ImageStatusResponse,
  ReloadImagesResponse,
  SecretOperations,
  SecretOperationsResult,
  SecretsDiffResult,
  SecretsResponse,
  SiteInfo,
} from './types';
import { SiteStatus } from './types';

const NOW_SARAH = new Date('2026-01-01T02:00:00Z');
const NOW_BEN   = new Date('2026-01-01T01:00:00Z');
const NOW_MARCO = new Date('2026-01-01T00:00:00Z');

const MOCK_SITES: SiteInfo[] = [
  {
    id: 'sarahcandle01',
    name: "Sarah's Candle Shop",
    status: SiteStatus.Running,
    account_id: 'dev-user-123',
    owner_customer_id: 'dev-user-123',
    initial_prompt: 'Create a beautiful candle shop website for Sarah',
    agent_url: 'https://local.gasket.dev-godaddy.com:4000',
    preview_url: undefined,
    published_url: 'http://localhost:3000/sarahcandle-preview.html',
    system_id: 'mock-system-01',
    subscription_id: 'mock-subscription-01',
    created_at: NOW_SARAH,
    updated_at: NOW_SARAH,
    variants: ['preview', 'publish'],
    screenshots: { publish: { desktop: '/images/sarahcandle-thumb.png' } },
  },
  {
    id: 'benbakery01',
    name: "Ben's Bakery",
    status: SiteStatus.Running,
    account_id: 'dev-user-123',
    owner_customer_id: 'dev-user-123',
    initial_prompt: 'Create a website for my artisan bakery',
    agent_url: 'https://local.gasket.dev-godaddy.com:4000',
    preview_url: undefined,
    published_url: 'http://localhost:3000/benbakery-preview.html',
    system_id: 'mock-system-02',
    subscription_id: 'mock-subscription-02',
    created_at: NOW_BEN,
    updated_at: NOW_BEN,
    variants: ['preview', 'publish'],
    screenshots: { publish: { desktop: '/images/benbakery-thumb.png' } },
  },
  {
    id: 'marcospizza01',
    name: "Marco's Pizza",
    status: SiteStatus.Running,
    account_id: 'dev-user-123',
    owner_customer_id: 'dev-user-123',
    initial_prompt: 'Build a website for my neighborhood pizzeria',
    agent_url: 'https://local.gasket.dev-godaddy.com:4000',
    preview_url: undefined,
    published_url: 'http://localhost:3000/marcospizza-preview.html',
    system_id: 'mock-system-03',
    subscription_id: 'mock-subscription-03',
    created_at: NOW_MARCO,
    updated_at: NOW_MARCO,
    variants: ['preview', 'publish'],
    screenshots: { publish: { desktop: '/images/marcospizza-thumb.png' } },
  },
];

function findSite(siteId: string): SiteInfo | null {
  return MOCK_SITES.find((s: SiteInfo) => s.id === siteId) ?? null;
}

export class MockControlPlaneAdapter implements IControlPlaneAdapter {
  async appExists(siteId: string, _jwt?: string, _owningProduct?: string, _multiUserEnabled?: boolean): Promise<boolean> {
    return findSite(siteId) !== null;
  }

  async createSite(_params: CreateSiteParams): Promise<CreateSiteResult> {
    return { success: false, error: 'Mock adapter: createSite not supported', status: SiteStatus.Failed };
  }

  async getSite(siteId: string, _jwt?: string, _owningProduct?: string, _options?: { includeCdn?: boolean; multiUserEnabled?: boolean }): Promise<SiteInfo | null> {
    return findSite(siteId);
  }

  async listSites(_jwt?: string, _multiUserEnabled?: boolean): Promise<SiteInfo[]> {
    return MOCK_SITES;
  }

  async deleteSite(_siteId?: string, _jwt?: string, _systemId?: string, _subscriptionId?: string): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Mock adapter: deleteSite not supported' };
  }

  async deploySite(siteId: string, _jwt?: string, _options?: DeploySiteOptions): Promise<{ success: boolean; site: SiteInfo; message: string; note?: string }> {
    const site = findSite(siteId) ?? MOCK_SITES[0];
    return { success: true, site, message: 'Mock deploy' };
  }

  async resumeSite(_siteId?: string, _variant?: string, _jwt?: string): Promise<{ success: boolean; message: string }> {
    return { success: true, message: 'Mock resume' };
  }

  async getArchiveStatus(): Promise<ArchiveStatusResponse> {
    return { isArchived: false, canRestore: false };
  }

  async startArchiveRestore(): Promise<ArchiveRestoreResponse> {
    return { statusJobId: 'mock-restore-job' };
  }

  async getImageStatus(siteId: string): Promise<ImageStatusResponse> {
    return {
      appId: siteId,
      compositionId: 'ai-builder',
      compositionVersion: '1.0.0',
      unifiedVariantJob: false,
      status: 'current' as ImageStatusResponse['status'],
    };
  }

  async reloadImages(siteId: string): Promise<ReloadImagesResponse> {
    return { appId: siteId, status: 'current' as ReloadImagesResponse['status'], message: 'Mock reload' };
  }

  async updateSite(siteId: string, updates: Partial<SiteInfo>, _jwt?: string): Promise<SiteInfo | null> {
    const site = findSite(siteId);
    if (!site) return null;
    return { ...site, ...updates };
  }

  async updateSiteVariables(siteId: string, variableUpdates: Record<string, unknown>, _jwt?: string): Promise<SiteInfo | null> {
    const site = findSite(siteId);
    if (!site) return null;
    if (variableUpdates.title && typeof variableUpdates.title === 'string') {
      return { ...site, name: variableUpdates.title };
    }
    return site;
  }

  async getSecrets(appId: string, _variant: 'preview' | 'publish', _jwt?: string): Promise<SecretsResponse> {
    return { appId, secrets: [], count: 0 };
  }

  async updateSecrets(_appId: string, _variant: 'preview' | 'publish', _operations: SecretOperations, _jwt: string): Promise<SecretOperationsResult> {
    return { success: true, message: 'Mock', operations: { added: 0, updated: 0, deleted: 0 } };
  }

  async compareSecrets(_appId: string, _sourceVariant: 'preview' | 'publish', _destinationVariant: 'preview' | 'publish', _jwt: string, _multiUserEnabled?: boolean): Promise<SecretsDiffResult> {
    return { added: [], updated: [], deleted: [] };
  }

  async syncSecrets(_appId: string, _sourceVariant: 'preview' | 'publish', _destinationVariant: 'preview' | 'publish', _jwt: string): Promise<SecretOperationsResult> {
    return { success: true, message: 'Mock', operations: { added: 0, updated: 0, deleted: 0 } };
  }

  async getProtectedSecrets(appId: string, _jwt: string): Promise<SecretsResponse> {
    return { appId, secrets: [], count: 0 };
  }

  async updateProtectedSecrets(_appId: string, _variants: ('preview' | 'publish')[], _operations: SecretOperations, _jwt: string): Promise<SecretOperationsResult> {
    return { success: true, message: 'Mock', operations: { added: 0, updated: 0, deleted: 0 } };
  }
}
