/**
 * Control Plane Adapter Types
 *
 * Defines the contract for managing sites across different control planes:
 * - V2: mgmt-airo + mgmt-hosting (customer-facing)
 * - Legacy: Direct database + Nomad/SQS (internal)
 */

import type { SiteVariant } from '@/lib/site-adapters/interfaces/ISiteAdapter';

// Re-export lifecycle types from ISiteAdapter for consumers
export {
  type LifecycleMetadata,
  LifecycleReason,
  LifecycleState,
  type SiteVariant,
  type VariantLifecycle,
} from '@/lib/site-adapters/interfaces/ISiteAdapter';

export type SiteStatus = 'init' | 'creating' | 'created' | 'running' | 'failed' | 'stopped' | 'error';

/**
 * Options for deploying a site
 */
export interface DeploySiteOptions {
  /**
   * Which variant to deploy (e.g., 'preview' or 'publish')
   */
  variant?: string;
  /**
   * Set to true when resuming an app from hibernation
   */
  resumeFromHibernation?: boolean;
}

/**
 * Domain type enum
 */
export enum DomainType {
  PREFIX = 'prefix',
  CUSTOM = 'custom',
}

/**
 * Domain status enum
 */
export enum DomainStatus {
  ACTIVE = 'active',
  PENDING = 'pending',
  INACTIVE = 'inactive',
  FAILED = 'failed',
  DELETING = 'deleting',
}

/**
 * Domain information for a site
 */
export interface SiteDomain {
  fqdn: string;
  isPrimary: boolean;
  domainType: DomainType;
  prefix: string;
  status: DomainStatus;
  createdAt: string;
  updatedAt: string;
}

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
  published_url?: string;
  ceph_mount_id?: string;
  ceph_dir_number?: string;
  created_at: Date;
  updated_at: Date;
  system_id?: string; // V2 only: systemId from mgmt-hosting (needed for deploy/delete/update)
  subscription_id?: string; // V2 only: subscriptionId from mgmt-hosting (needed for hierarchical URLs)
  domains?: SiteDomain[]; // V2 only: Custom domains from mgmt-hosting
  variants?: string[]; // V2 only: Variants with lifecycle state
  variantsWithLifecycle?: SiteVariant[]; // V2 only: Variants with lifecycle state for hibernation
  productId?: string; // V2 only: Product ID (e.g., "aab-v1", "paas-nodejs-v1")
  ownerProduct?: string; // V2 only: Owner product family (e.g., "AiroAppBuilder", "PaaSNodeJS")
  compositionId?: string; // V2 only: Composition type (e.g., "ai-builder", "node-app")
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
  productId?: string; // V2 only: Product ID to create site under (defaults to "aab-v1")
  marketId?: string; // V2 only: Market ID for datacenter selection (e.g., 'en-US', 'de-DE')
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
   * @param owningProduct - Optional owner product filter (defaults to AiroAppBuilder)
   * @returns Site information or null if not found
   */
  getSite(siteId: string, jwt: string, owningProduct?: string): Promise<SiteInfo | null>;

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
   * @param options - Optional deployment options (variant, resumeFromHibernation)
   * @returns Deployment result with updated site status
   */
  deploySite(siteId: string, jwt: string, options?: DeploySiteOptions): Promise<{ success: boolean; site: SiteInfo; message: string; note?: string }>;

  /**
   * Resume site variant from hibernation
   *
   * V2: POST /airo/v1/subscriptions/:subscriptionId/systems/:systemId/apps/:appId/variants/:variant/resume
   * Legacy: Not implemented
   *
   * @param siteId - Site identifier
   * @param variant - Variant to resume (e.g., 'preview', 'publish')
   * @param jwt - Customer JWT token
   * @returns Resume result with success status
   */
  resumeSite(siteId: string, variant: string, jwt: string): Promise<{ success: boolean; message: string }>;

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

  /**
   * Get secrets for an app
   *
   * @param appId - Application identifier
   * @param variant - Variant (preview or publish)
   * @param jwt - Customer JWT token
   * @returns Secrets response with list of secret names and metadata
   */
  getSecrets(appId: string, variant: 'preview' | 'publish', jwt: string): Promise<SecretsResponse>;

  /**
   * Perform bulk secret operations (add/update/delete)
   *
   * @param appId - Application identifier
   * @param variant - Variant (preview or publish)
   * @param operations - Secret operations to perform
   * @param jwt - Customer JWT token
   * @returns Operation results
   */
  updateSecrets(
    appId: string,
    variant: 'preview' | 'publish',
    operations: SecretOperations,
    jwt: string
  ): Promise<SecretOperationsResult>;

  /**
   * Compare secrets between two variants
   *
   * Compares non-system-managed secrets only and returns the differences:
   * - added: Secrets in source variant but not in destination
   * - updated: Secrets in both variants but with different values
   * - deleted: Secrets in destination variant but not in source
   *
   * @param appId - Application identifier
   * @param sourceVariant - Source variant to compare from
   * @param destinationVariant - Destination variant to compare to
   * @param jwt - Customer JWT token
   * @returns Diff result with added, updated, and deleted secret names
   */
  compareSecrets(
    appId: string,
    sourceVariant: 'preview' | 'publish',
    destinationVariant: 'preview' | 'publish',
    jwt: string
  ): Promise<SecretsDiffResult>;

  /**
   * Sync secrets from source variant to destination variant
   *
   * Copies all non-system-managed secrets from source to destination:
   * - Adds secrets that exist only in source
   * - Updates secrets that have different values
   * - Deletes secrets that exist only in destination
   *
   * @param appId - Application identifier
   * @param sourceVariant - Source variant to sync from
   * @param destinationVariant - Destination variant to sync to
   * @param jwt - Customer JWT token
   * @returns Operation results with counts of added, updated, and deleted secrets
   */
  syncSecrets(
    appId: string,
    sourceVariant: 'preview' | 'publish',
    destinationVariant: 'preview' | 'publish',
    jwt: string
  ): Promise<SecretOperationsResult>;
}

/**
 * Secret metadata returned by control plane
 */
export interface SecretMetadata {
  name: string;
  systemManaged: boolean;
  variants: ('preview' | 'publish')[];
}

/**
 * Response from getSecrets
 */
export interface SecretsResponse {
  appId: string;
  secrets: SecretMetadata[];
  count: number;
}

/**
 * Secret update operation
 */
export interface SecretUpdate {
  name: string;
  value: string;
}

/**
 * Bulk secret operations
 */
export interface SecretOperations {
  additions?: SecretUpdate[];
  updates?: SecretUpdate[];
  deletions?: string[];
}

/**
 * Result of secret operations
 */
export interface SecretOperationsResult {
  success: boolean;
  message: string;
  operations: {
    added: number;
    updated: number;
    deleted: number;
  };
}

/**
 * Result of comparing secrets between two variants
 */
export interface SecretsDiffResult {
  /** Secret names added in source variant (not in destination) */
  added: string[];
  /** Secret names updated (exist in both but with different values) */
  updated: string[];
  /** Secret names deleted (exist in destination but not in source) */
  deleted: string[];
}
