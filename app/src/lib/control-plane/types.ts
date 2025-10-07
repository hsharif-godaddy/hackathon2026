/**
 * Control Plane Adapter Types
 *
 * Defines the contract for managing sites across different control planes:
 * - V2: mgmt-airo + mgmt-hosting (customer-facing)
 * - Legacy: Direct database + Nomad/SQS (internal)
 */

export type SiteStatus = 'init' | 'creating' | 'created' | 'running' | 'failed' | 'stopped' | 'error';

/**
 * Site information returned by control plane
 */
export interface SiteInfo {
  id: string;
  name?: string;
  status: SiteStatus;
  account_id: string;
  initial_prompt?: string;
  agent_url?: string;
  backend_url?: string;
  preview_url?: string;
  ceph_mount_id?: string;
  ceph_dir_number?: string;
  created_at: Date;
  updated_at: Date;
  system_id?: string; // V2 only: systemId from mgmt-hosting (needed for deploy/delete/update)
  subscription_id?: string; // V2 only: subscriptionId from mgmt-hosting (needed for hierarchical URLs)
}

/**
 * ID type to distinguish between temporary job IDs and real site IDs
 */
export type IdType = 'job' | 'site';

/**
 * Parameters for site creation
 */
export interface CreateSiteParams {
  accountId: string;
  prompt: string;
  jwt: string;
}

/**
 * Result of site creation
 */
export interface CreateSiteResult {
  success: boolean;
  siteId?: string;
  status: SiteStatus;
  error?: string;
  created_at?: Date;
  // Additional fields to match Legacy response format
  name?: string;        // Site title (placeholder in V2, real in Legacy)
  account_id?: string;  // Account ID
  updated_at?: Date;    // Last update timestamp
  type?: IdType;        // 'job' for V2 job IDs, 'site' for real site IDs
}

/**
 * Control Plane Adapter Interface
 *
 * Abstracts the control plane implementation (V2 mgmt-airo vs Legacy database)
 */
export interface IControlPlaneAdapter {
  /**
   * Create a new site
   *
   * @param params - Site creation parameters
   * @returns Result with siteId (statusJobId for V2, database ID for legacy)
   */
  createSite(params: CreateSiteParams): Promise<CreateSiteResult>;

  /**
   * Get site by ID
   *
   * V2: Handles both statusJobId (temporary) and appId (permanent)
   * Legacy: Uses database site ID
   *
   * @param siteId - Site identifier (statusJobId or appId for V2, db ID for legacy)
   * @param jwt - Customer JWT token
   * @returns Site information or null if not found
   */
  getSite(siteId: string, jwt: string): Promise<SiteInfo | null>;

  /**
   * List all sites for customer
   *
   * @param jwt - Customer JWT token
   * @returns Array of site information
   */
  listSites(jwt: string): Promise<SiteInfo[]>;

  /**
   * Delete site
   *
   * @param siteId - Site identifier
   * @param jwt - Customer JWT token
   * @param systemId - Optional system ID (if already known, avoids expensive lookup)
   * @returns Success result
   */
  deleteSite(siteId: string, jwt: string, systemId?: string, subscriptionId?: string): Promise<{ success: boolean; error?: string }>;

  /**
   * Deploy site
   *
   * V2: No-op (deployment happens automatically during signup)
   * Legacy: Triggers manual deployment via background task
   *
   * @param siteId - Site identifier
   * @param jwt - Customer JWT token
   * @returns Deployment result with updated site status
   */
  deploySite(siteId: string, jwt: string): Promise<{ success: boolean; site: SiteInfo; message: string; note?: string }>;

  /**
   * Update site
   *
   * V2: Not implemented (sites are immutable in V2)
   * Legacy: Updates site metadata in database
   *
   * @param siteId - Site identifier
   * @param updates - Partial site data to update
   * @param jwt - Customer JWT token
   * @returns Updated site information or null if not found
   */
  updateSite(siteId: string, updates: Partial<SiteInfo>, jwt: string): Promise<SiteInfo | null>;
}

