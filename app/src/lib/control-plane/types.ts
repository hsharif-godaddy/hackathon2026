/**
 * Control Plane Adapter Types
 *
 * Defines the contract for managing sites via the V2 control plane
 * (mgmt-airo + mgmt-hosting).
 */

import type {
  AiroImageStatus as ImageStatus,
  AiroImageStatusEntry as ImageStatusEntry,
} from '@/lib/mgmt-airo';
/**
 * Lifecycle state for a site variant (from hosting_app_lifecycle table)
 */
export enum LifecycleState {
  RUNNING = 'running',
  PAUSED = 'paused',
  ARCHIVED = 'archived',
  RELOADING = 'reloading',
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
  FLEET_RELOAD = 'fleet_reload',
  DEPLOYMENT = 'deployment',
  RELOAD_COMPLETE = 'reload_complete',
  ON_DEMAND_STALE_IMAGES = 'on_demand_stale_images',
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

/**
 * Site status states
 */
export enum SiteStatus {
  Init = 'init',
  Creating = 'creating',
  Created = 'created',
  Running = 'running',
  Failed = 'failed',
  Stopped = 'stopped',
  Error = 'error',
  Suspended = 'suspended',
  Paused = 'paused',
}

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
 *
 * Note: The mgmt service may return `null` or `'fqdn'` for custom domains,
 * not just `'custom'`. Use `domainType !== DomainType.PREFIX` to detect
 * custom domains rather than `domainType === DomainType.CUSTOM`.
 */
export enum DomainType {
  PREFIX = 'prefix',
  CUSTOM = 'custom',
  FQDN = 'fqdn',
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
  ERROR = 'error',
}

/**
 * Domain information for a site
 */
export interface SiteDomain {
  fqdn: string;
  isPrimary: boolean;
  /** Domain type - may be null for custom domains from mgmt service */
  domainType: DomainType | null;
  prefix: string;
  status: DomainStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Pre-rendered screenshot URLs for one app variant (desktop/mobile).
 * Mirrors the mgmt-airo `ScreenshotPair`; defined here to keep SiteInfo
 * self-contained (same convention as SiteDomain vs AiroDomain).
 */
export interface SiteScreenshotPair {
  desktop?: string;
  mobile?: string;
}

/**
 * Per-variant screenshot URLs carried through from mgmt-airo to the browser.
 * Shape: { preview: { desktop, mobile }, publish: { desktop, mobile } }.
 */
export interface SiteScreenshots {
  preview?: SiteScreenshotPair;
  publish?: SiteScreenshotPair;
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
  /** FQDN attached to this app at create time (e.g. via DPP). Provenance-neutral. */
  fqdn?: string;
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
  cellId?: string; // V2 only: Cell identifier (e.g., "c35-prod-sxb1-eu-central-1" or "c36-prod-p3-us-west-2")
  screenshots?: SiteScreenshots; // V2 only: Pre-rendered screenshot URLs from mgmt-hosting (preview/publish × desktop/mobile)
  published?: boolean; // V2 only: Authoritative publish state from mgmt-airo (airo_apps enrichment). See getAppScreenshotUrl for usage.
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
  /** When set, used for mgmt-airo createApp/signup; otherwise env + marketId mapping */
  datacenter?: string;
  headers?: Headers; // Request headers for feature flag checks
  itc?: string;
  /** Optional FQDN to attach in parallel with app creation. */
  fqdn?: string;
  /** Hivemind cohort for the grants-holdout experiment, already normalized by getGrantsHoldoutCohort. When 'holdout', forces bmsActive: false at signup. */
  grantsHoldoutCohort?: string;
  /** Hivemind cohort for the BMS A/A experiment (homepage users only). Logged as exposure after the BMS flag check in the adapter. */
  bmsLaunchAACohort?: string;
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
  name?: string;
  account_id?: string;
  updated_at?: Date;    // Last update timestamp
  type?: IdType;        // 'job' for V2 job IDs, 'site' for real site IDs
}

export type { ImageStatus, ImageStatusEntry };

/**
 * Response from image status check
 */
export interface ImageStatusResponse {
  appId: string;
  compositionId: string;
  compositionVersion: string;
  unifiedVariantJob: boolean;
  status: ImageStatus;
  images?: ImageStatusEntry[];
}

/**
 * Response from image reload trigger
 */
export interface ReloadImagesResponse {
  appId: string;
  status: ImageStatus;
  message: string;
  jobId?: string;
  startedAt?: string;
  failedAt?: string;
}

/**
 * Cold archive status for an app
 */
export interface ArchiveStatusResponse {
  isArchived: boolean;
  canRestore: boolean;
  status?: string;
  inProgress?: boolean;
  archiveId?: number;
  backupId?: string;
  backupRegion?: string;
  originalCellId?: string;
  originalDatabaseId?: string;
  originalFilesystemId?: string;
  archiveRequestedAt?: string;
  archivedAt?: string;
}

/**
 * Response when starting archive restore (async job)
 */
export interface ArchiveRestoreResponse {
  statusJobId: string;
  estimatedRestoreTime?: string;
  message?: string;
}

/**
 * Control Plane Adapter Interface
 */
export interface IControlPlaneAdapter {
  /**
   * Check if an app exists for a customer (lightweight validation)
   *
   * Unlike getSite(), this does NOT fetch full app details. On subscription cache miss,
   * it initializes the cache but does NOT do a forced refresh + retry, avoiding redundant
   * tree refetches (saves p99=7.4s on the miss path).
   *
   * @param siteId - Site identifier
   * @param jwt - Customer JWT token
   * @param owningProduct - Optional owner product filter
   * @returns true if app exists, false otherwise
   */
  appExists(siteId: string, jwt: string, owningProduct?: string): Promise<boolean>;

  /**
   * Create a new site
   *
   * @param params - Site creation parameters
   * @returns Result with siteId (statusJobId during provisioning, appId once ready)
   */
  createSite(params: CreateSiteParams): Promise<CreateSiteResult>;

  /**
   * Get site by ID
   *
   * Handles both statusJobId (temporary) and appId (permanent).
   *
   * @param siteId - Site identifier (statusJobId or appId)
   * @param jwt - Customer JWT token
   * @param owningProduct - Optional owner product filter (defaults to AiroAppBuilder)
   * @param options - Optional flags; `includeCdn` (default: false) controls whether CDN-related data (cdnStatus, anycastIp) is included in the response
   * @returns Site information or null if not found
   */
  getSite(siteId: string, jwt: string, owningProduct?: string, options?: { includeCdn?: boolean }): Promise<SiteInfo | null>;

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
   * @param siteId - Site identifier
   * @param jwt - Customer JWT token
   * @param options - Optional deployment options (variant, resumeFromHibernation)
   * @returns Deployment result with updated site status
   */
  deploySite(siteId: string, jwt: string, options?: DeploySiteOptions): Promise<{ success: boolean; site: SiteInfo; message: string; note?: string }>;

  /**
   * Resume site variant from hibernation
   *
   * @param siteId - Site identifier
   * @param variant - Variant to resume (e.g., 'preview', 'publish')
   * @param jwt - Customer JWT token
   * @returns Resume result with success status
   */
  resumeSite(siteId: string, variant: string, jwt: string): Promise<{ success: boolean; message: string }>;

  /**
   * Cold archive status (whether the app is archived and may be restored)
   */
  getArchiveStatus(siteId: string, jwt: string): Promise<ArchiveStatusResponse>;

  /**
   * Start async restore from cold archive
   */
  startArchiveRestore(siteId: string, jwt: string, options?: { targetCell?: string }): Promise<ArchiveRestoreResponse>;

  /**
   * Get image status for an app
   *
   * @param siteId - Site identifier
   * @param jwt - Customer JWT token
   * @param katanaVersion - Optional x-katana-version selector forwarded to the image-status call
   * @returns Image status response
   */
  getImageStatus(siteId: string, jwt: string, katanaVersion?: string): Promise<ImageStatusResponse>;

  /**
   * Reload images for an app
   *
   * @param siteId - Site identifier
   * @param jwt - Customer JWT token
   * @returns Reload response with status
   */
  reloadImages(siteId: string, jwt: string): Promise<ReloadImagesResponse>;

  /**
   * Update site
   *
   * @param siteId - Site identifier
   * @param updates - Partial site data to update
   * @param jwt - Customer JWT token
   * @returns Updated site information or null if not found
   */
  updateSite(siteId: string, updates: Partial<SiteInfo>, jwt: string): Promise<SiteInfo | null>;

  /**
   * Update site variables (metadata)
   *
   * @param siteId - Site identifier
   * @param variableUpdates - Variables to update
   * @param jwt - Customer JWT token
   * @returns Updated site information or null if not found
   */
  updateSiteVariables(siteId: string, variableUpdates: Record<string, any>, jwt: string): Promise<SiteInfo | null>;

  /**
   * Get secrets for an app
   *
   * @param appId - Application identifier
   * @param variant - Variant (preview or publish)
   * @param jwt - Customer JWT token
   * @returns Secrets response with metadata and values when the upstream API provides them
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

  /**
   * Get protected secrets for an app (e.g. GitHub tokens).
   * Calls the API without a variant filter and returns secrets from
   * the `protected` bucket merged with variant secrets.
   */
  getProtectedSecrets(appId: string, jwt: string): Promise<SecretsResponse>;

  /**
   * Upsert or delete protected secrets across one or more variants.
   * Each operation is sent with `protected: true` so the control plane
   * delivers them via the protected-secrets pipeline.
   */
  updateProtectedSecrets(
    appId: string,
    variants: ('preview' | 'publish')[],
    operations: SecretOperations,
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
  /** Decrypted/plain value when the backend returns it (customer GET with includeValues). */
  value?: string;
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
