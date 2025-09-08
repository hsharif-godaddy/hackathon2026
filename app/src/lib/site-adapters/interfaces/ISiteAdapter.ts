/**
 * Site Adapter Interface
 * 
 * Defines the contract for managing sites in both production and development environments.
 * Production uses Nomad/SQS, development uses local processes/Docker.
 */

export interface SiteInfo {
  id: string;
  name: string;
  status: 'creating' | 'created' | 'running' | 'stopped' | 'error' | 'failed';
  agent_url?: string;
  backend_url?: string;
  preview_url?: string;
  account_id?: string;
  initial_prompt?: string;
  created_at: string;
  updated_at: string;
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