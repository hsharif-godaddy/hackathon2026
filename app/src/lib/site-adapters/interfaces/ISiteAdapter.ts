import type { SiteDomain } from '@/lib/control-plane/types';

/**
 * Site Adapter Interface
 *
 * Defines the contract for managing sites in both production and development environments.
 * Production uses Nomad/SQS, development uses local processes/Docker.
 */

/**
 * Lifecycle state for a site variant (from hosting_app_lifecycle table)
 */
export enum LifecycleState {
  RUNNING = 'running',
  PAUSED = 'paused',
  PROVISIONING = 'provisioning',
  DELETING = 'deleting',
  FAILED = 'failed',
}

/**
 * Reason for the current lifecycle state
 */
export enum LifecycleReason {
  HIBERNATION = 'hibernation',
  USER_REQUEST = 'user_request',
  MAINTENANCE = 'maintenance',
  DEPLOYMENT_COMPLETE = 'deployment_complete',
  USER_RESUMED = 'user_resumed',
}

/**
 * Lifecycle metadata providing additional context
 */
export interface LifecycleMetadata {
  pausedBy?: 'system' | 'user';
  daysSinceActivity?: number;
  hibernatedAt?: string;
  thresholdDays?: number;
}

/**
 * Lifecycle information for a site variant
 */
export interface VariantLifecycle {
  lifecycleState: LifecycleState;
  reason?: LifecycleReason;
  stateChangedAt?: string;
  metadata?: LifecycleMetadata;
}

/**
 * Site variant with lifecycle information
 */
export interface SiteVariant {
  variant: string;
  status: string;
  lifecycle?: VariantLifecycle;
  lastActivityTime?: string;
}

export interface SiteInfo {
  id: string;
  name: string;
  status: 'init' | 'creating' | 'created' | 'running' | 'stopped' | 'error' | 'failed';
  agent_url?: string;
  backend_url?: string;
  preview_url?: string;
  published_url?: string;
  account_id: string;
  initial_prompt?: string;
  created_at: string;
  updated_at: string;
  system_id?: string; // V2 only: systemId from mgmt-hosting
  subscription_id?: string; // V2 only: subscriptionId from mgmt-hosting
  controlPlane?: 'v2' | 'legacy'; // Control plane type (v2 or legacy)
  domains?: SiteDomain[]; // Custom domains from mgmt-hosting
  variants?: string[]; // V2 only: Simple variant names ['preview', 'publish']
  variantsWithLifecycle?: SiteVariant[]; // V2 only: Variants with lifecycle state for hibernation
}

export interface CreateSiteRequest {
  siteId?: string;
  name?: string;
  initialPrompt?: string;
  prompt?: string; // Support both initialPrompt and prompt
  accountId?: string;
}

export interface SiteLimitCheck {
  canCreate: boolean;
  currentCount: number;
  limit: number;
}

export interface ServerInfo {
  appId: string;
  port: number;
  url: string;
  status: 'running' | 'stopped' | 'error';
  type: 'process' | 'docker' | 'nomad';
  metadata?: any;
}

export interface ISiteAdapter {
  /**
   * Create a new site
   */
  createSite(request: CreateSiteRequest): Promise<SiteInfo>;

  /**
   * Get site by ID
   */
  getSiteById(siteId: string): Promise<SiteInfo | null>;

  /**
   * Get all sites for an account
   */
  getSitesByAccountId(accountId: string): Promise<SiteInfo[]>;

  /**
   * Update site
   */
  updateSite(siteId: string, updates: Partial<SiteInfo>): Promise<SiteInfo | null>;

  /**
   * Delete site (database record only)
   */
  deleteSite(siteId: string): Promise<boolean>;

  /**
   * Destroy site (handles both infrastructure cleanup and database deletion)
   */
  destroySite(siteId: string): Promise<boolean>;

  /**
   * Get running servers for all sites
   */
  getRunningServers(): Promise<ServerInfo[]>;

  /**
   * Check site creation limits for an account
   */
  checkSiteLimit(accountId: string): Promise<SiteLimitCheck>;

  /**
   * Check if this adapter handles authentication
   */
  requiresAuth(): boolean;

  /**
   * Get adapter capabilities
   */
  getCapabilities(): {
    supportsCustomDomains: boolean;
    supportsScaling: boolean;
    supportsLogs: boolean;
  };
}
