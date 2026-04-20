/**
 * Type definitions for mgmt-airo API
 */

import { SubscriptionPlan, SubscriptionSuspendReason } from '@/types/credits';

// Product constants (AIRO_PRODUCT_IDS, AIRO_OWNER_PRODUCTS, DEFAULT_OWNER_PRODUCT)
// and their derived types (AiroProductId, AiroOwnerProduct, ProductType)
// are defined in @airo/shared/auth and re-exported from this module's index.ts
export type { AiroOwnerProduct, AiroProductId, ProductType } from '@airo/shared/auth';
export { AIRO_OWNER_PRODUCTS, AIRO_PRODUCT_IDS, DEFAULT_OWNER_PRODUCT } from '@airo/shared/auth';

/**
 * Subscription response from mgmt-airo
 */
export interface AiroSubscription {
  id: string;
  productId: string;
  ownerProduct?: string;
  customerId: string;
  status: string;
  isTrial: boolean;
  /** Airo Plus entitlement ID (legacy paid users) */
  entitlementId?: string;
  /** Airo Builder entitlement ID (new airo builder plans) */
  builderEntitlementId?: string;
  /** Whether the user previously had an Airo Plus subscription (legacy users converted to Starter) */
  hadAiroPlus?: boolean;
  /** Subscription plan type (new airo builder plans) */
  plan?: SubscriptionPlan;
  /** When the subscription renews (new airo builder plans) */
  renewsAt?: string;
  downgradedPlan?: SubscriptionPlan;
  downgradedAt?: string;
  /** Reason for current status (e.g., 'NON_PAYMENT' when suspended) */
  reason?: SubscriptionSuspendReason | string;
  createdAt: string;
  updatedAt: string;
}

/**
 * System response from mgmt-airo
 */
export interface AiroSystem {
  subscriptionId: string;
  systemId: string;
  datacenter?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * App response from mgmt-airo (summary from list endpoints)
 */
export interface AiroApp {
  id: string;
  name?: string;
  systemId: string;
  subscriptionId: string;
  appTemplateName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  urls?: {
    agent?: string;
    preview?: string;
    publish?: string;
  };
  variables?: Record<string, any>;
  productId?: string; // Product ID (e.g., "aab-v1", "paas-nodejs-v1") - inherited from the system object
  ownerProduct?: string; // Owner product family (e.g., "AiroAppBuilder", "PaaSNodeJS") - inherited from the system object
  variants?: string[];
  variantsWithLifecycle?: Array<{
    variant: string;
    status: string;
    lifecycle?: {
      lifecycleState: string;
      reason?: string;
      stateChangedAt?: string;
      metadata?: {
        pausedBy?: string;
        daysSinceActivity?: number;
        hibernatedAt?: string;
      };
    };
    lastActivityTime?: string;
  }>;
  cellId?: string;
}

/**
 * Domain status values
 */
export enum DomainStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  DELETING = 'deleting',
}

/**
 * CDN status values (numeric)
 */
export enum CdnStatus {
  INIT = 1,
  PENDING = 2,
  ACTIVE = 3,
  ERROR = 4,
  DELETED = 5,
}

/**
 * Domain information in app details response
 */
export interface AiroDomain {
  fqdn: string;
  isPrimary: boolean;
  status: DomainStatus;
  cdnStatus?: CdnStatus;
  anycastIp?: string;
  certificateValidationCname?: string;
  domainType: string;
  prefix: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Full app details from mgmt-hosting (via mgmt-airo proxy)
 */
export interface AiroAppDetails extends AiroApp {
  variables: Record<string, any>;
  fqdns?: AiroDomain[];
}

/**
 * Job status response from mgmt-airo
 */
export interface AiroJobStatus {
  statusJobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  apps?: AiroApp[];
  error?: string;
}

/**
 * Customer check response
 */
export interface AiroCustomer {
  customerId: string;
  exists: boolean;
}

/**
 * Signup (provision) request payload
 */
export interface AiroSignupPayload {
  datacenter: string;
  isTrial: boolean;
  productId: string;
  initialPrompt: string;
  appConfigs: Array<{
    templateName: string;
    environments?: string[];
    variants?: string[];
    variables: Record<string, any>;
  }>;
  /** Request BMS integration for new subscription (requires feature flag) */
  bmsActive?: boolean;
}

/**
 * Signup response
 */
export interface AiroSignupResponse {
  statusJobId: string;
}

/**
 * Create app (add-app) request payload
 */
export interface AiroCreateAppPayload {
  appTemplateName: string;
  environments?: string[];
  variants?: string[];
  variables: Record<string, any>;
  datacenter?: string;
}

/**
 * Create app response
 */
export interface AiroCreateAppResponse {
  statusJobId: string;
}

/**
 * Update app request payload
 */
export interface AiroUpdateAppPayload {
  status?: string;
  variables?: Record<string, any>;
}

/**
 * Update project domain request payload
 */
export interface AiroUpdateProjectDomainPayload {
  projectPrefix: string | null;
}

/**
 * Update project domain response
 */
export interface AiroUpdateProjectDomainResponse {
  statusJobId: string;
  status: string;
  message: string;
  projectPrefix: string | null;
  domain?: string | null;
}

/**
 * Domain mode types for validation
 *
 * Determines which type of domain is being validated
 */
export enum DomainMode {
  /** Project domain (subdomain prefix) */
  PROJECT = 'project',
  /** Custom domain (fully qualified domain name) */
  CUSTOM = 'custom',
}

/**
 * Domain validation error codes from mgmt-airo API
 *
 * Error codes returned when domain availability check fails
 */
export enum DomainValidationError {
  /** Project prefix format validation failure */
  DOMAIN_FORMAT_INVALID = 'DOMAIN_FORMAT_INVALID',
  /** Project prefix RFC 1123 validation failure */
  DOMAIN_LABEL_INVALID = 'DOMAIN_LABEL_INVALID',
  /** Project prefix is too short (5-character minimum) */
  DOMAIN_TOO_SHORT = 'DOMAIN_TOO_SHORT',
  /** Domain is on the deny list (reserved) */
  DOMAIN_RESERVED = 'DOMAIN_RESERVED',
  /** Domain contains profanity */
  DOMAIN_PROFANITY = 'DOMAIN_PROFANITY',
  /** Full FQDN format validation failure (custom domains) */
  DOMAIN_FQDN_INVALID = 'DOMAIN_FQDN_INVALID',
  /** Subdomain label validation failure (custom domains) */
  DOMAIN_SUBDOMAIN_INVALID = 'DOMAIN_SUBDOMAIN_INVALID',
  /** Domain label exceeds 63-character limit (custom domains) */
  DOMAIN_LABEL_TOO_LONG = 'DOMAIN_LABEL_TOO_LONG',
  /** Domain is not unique (already in use) */
  DOMAIN_NOT_UNIQUE = 'DOMAIN_NOT_UNIQUE',
  /** Domain is already owned by this account */
  DOMAIN_ALREADY_OWNED = 'DOMAIN_ALREADY_OWNED',
}

/**
 * Domain validation error object from mgmt-airo API
 *
 * Detailed error information when domain validation fails
 */
export interface DomainValidationErrorObject {
  /** Error code (e.g., DOMAIN_NOT_UNIQUE, DOMAIN_RESERVED) */
  code: DomainValidationError;
  /** Human-readable error message from the API */
  message: string;
  /** Field that caused the error (e.g., projectPrefix, fqdn) */
  field: string;
  /** Value that was rejected */
  value: string;
}

/**
 * Domain check response
 *
 * Response from domain availability validation endpoint
 */
export interface AiroDomainCheckResponse {
  available: boolean;
  mode: DomainMode;
  projectPrefix?: string;
  fqdn?: string;
  domain?: string;
  errors?: DomainValidationErrorObject[];
}

/**
 * Deploy app options
 */
export interface AiroDeployAppOptions {
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
 * Deploy app response
 */
export interface AiroDeployAppResponse {
  success: boolean;
  message: string;
  deploymentId?: string;
}

/**
 * Deployment status constants
 * Represents the actual statuses from mgmt-hosting deployment records
 */
export enum DeploymentStatus {
  DEPLOYED = 'deployed',
  FAILED = 'failed',
  PENDING = 'pending',
  DEPLOYING = 'deploying'
}

/**
 * Deployment status type for publish operations (derived from enum)
 */
export type AiroDeploymentStatus = keyof typeof DeploymentStatus;

/**
 * Publish app response - notifies mgmt-airo of new git archive
 */
export interface AiroPublishAppResponse {
  statusJobId: string;
  deploymentId: string;
  status: AiroDeploymentStatus;
  message: string;
  subscriptionId: string;
  systemId: string;
  appId: string;
  gitHash: string;
}

/**
 * Unpublish app response - marks publish variant as inactive
 *
 * POST /airo/v1/subscriptions/:subscriptionId/systems/:systemId/apps/:appId/unpublish
 */
export interface AiroUnpublishAppResponse {
  message: string;
  subscriptionId: string;
  systemId: string;
  appId: string;
}

/**
 * Delete app response
 */
export interface AiroDeleteAppResponse {
  success: boolean;
  message: string;
}

/**
 * Domain to create for an app
 */
export interface DomainToCreate {
  fqdn: string;
  primary?: boolean;
}

/**
 * Domain to delete from an app
 */
export interface DomainToDelete {
  fqdn: string;
}

/**
 * Modify domains request payload
 */
export interface AiroModifyDomainsPayload {
  domainsToCreate?: DomainToCreate[];
  domainsToDelete?: DomainToDelete[];
  createCdn?: boolean;
  isWildcardDomain?: boolean;
}

/**
 * Modify domains response
 */
export interface AiroModifyDomainsResponse {
  statusJobId: string;
  status: string;
  message: string;
}

/**
 * Domain error details
 */
export interface AiroDomainError {
  code: string;
  message: string;
  action: 'RETRY' | 'SELF_SERVICE' | 'CONTACT_SUPPORT';
  canRetry: boolean;
}

/**
 * Domain error response
 */
export interface AiroDomainErrorResponse {
  appId: string;
  fqdn: string;
  jobId: string;
  status: string;
  error: AiroDomainError;
  affectedDomains: string[];
  failedStep: string;
  completedAt: string;
}

/**
 * Domain modification job status (mgmt-airo domain-job)
 */
export interface AiroDomainJobResponse {
  id: string;
  type: string;
  overallStatus: string;
  dynamic: {
    current: { id?: string; label?: string; status?: string } | null;
    steps: unknown[];
    stepDefinitions: unknown[];
  };
}

/**
 * Response from domain DNS ownership check (mgmt-airo)
 */
export interface AiroDomainDnsOwnershipResponse {
  isGdDomain: boolean;
  isGDDomainOwner: boolean;
  isGoDaddyDns: boolean;
  pendingNsPropagation: boolean;
  domainCreatedAt: string | null;
  zoneMatchedAt: string | null;
  nameserverType: string;
  nameservers: string[];
  dnsApiResponseCode: number | null;
  domainsApiResponseCode: number | null;
}

/**
 * Bulk customer apps response
 */
export interface AiroBulkAppsResponse {
  apps: AiroApp[];
}

/**
 * Deployment job data structure
 */
export interface AiroDeploymentJob {
  id: string;
  status: string;
  completedAt: string;
  errorMessage: string | null;
}

/**
 * Deployment metadata structure
 */
export interface AiroDeploymentMetadata {
  errorMessage?: string | null;
  deploymentNotes?: string;
  triggeredBy?: string;
  lastAttemptAt?: string;
  [key: string]: any;
}

/**
 * Deployment data structure
 */
export interface AiroDeployment {
  id: string;
  appId: string;
  gitHash: string;
  variant: string;
  status: string;
  statusJobId: string;
  attempts: number;
  metadata: AiroDeploymentMetadata;
  createdAt: string;
  updatedAt: string;
  job?: AiroDeploymentJob;
}

/**
 * Deployments response
 */
export interface AiroDeploymentsResponse {
  appId: string;
  deployments: AiroDeployment[];
  total: number;
}

/**
 * Customer tree response - optimized endpoint that returns complete hierarchy
 * Replaces 119 sequential API calls with a single request
 */
export interface CustomerTree {
  customerId: string;
  subscriptions: Array<{
    subscriptionId: string;
    productId: string;
    ownerProduct?: string;
    status: string;
    isTrial: boolean;
    entitlementId?: string;
    systems: Array<{
      systemId: string;
      datacenter: string;
      apps: Array<{
        id: string;
        status: string;
        appTemplateName: string;
        urls: {
          agent: string;
          backend: string;
          preview: string;
          publish?: string;
        };
        variables: Record<string, any>;
        createdAt: string;
        updatedAt: string;
      }>;
    }>;
  }>;
}

/**
 * API error response
 */
export interface AiroApiError {
  message: string;
  error?: string;
  statusCode?: number;
}

/**
 * Standardized error response contract from mgmt-airo API
 */
export interface AiroApiErrorV2 {
  error: {
    code: string;
    message: string;
    correlationId?: string;
    timestamp?: string;
    details?: Record<string, unknown>;
  };
}

/**
 * HTTP error class with status code
 */
export class AiroHttpError extends Error {
  status: number;
  statusText: string;
  body: AiroApiError | AiroApiErrorV2 | string;

  constructor(status: number, statusText: string, body: AiroApiError | AiroApiErrorV2 | string) {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    super(`API request failed: ${status} ${statusText} - ${bodyStr}`);
    this.name = 'AiroHttpError';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

/**
 * Attribute response from mgmt-airo
 */
export interface AiroAttribute {
  id: string;
  ownerType: string;
  ownerId: string;
  key: string;
  value: Record<string, any>;
  customerId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Create attribute request payload
 */
export interface AiroCreateAttributePayload {
  key: string;
  value: Record<string, any>;
}

/**
 * Update attribute request payload
 */
export interface AiroUpdateAttributePayload {
  value: Record<string, any>;
}

/**
 * Client configuration
 */
export interface AiroMgmtClientConfig {
  baseUrl: string;
  jwt: string;
  maxRetries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
}

/**
 * Secret metadata from mgmt-airo
 */
export interface AiroSecretMetadata {
  name: string;
  systemManaged: boolean;
  variants: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Raw secret from control plane API (nested structure)
 */
export interface AiroRawSecret {
  name: string;
  value: string | object;
  systemManaged: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Raw secrets response from control plane API (actual API structure)
 */
export interface AiroRawSecretsResponse {
  appId: string;
  cellId?: string;
  shared: {
    secrets: AiroRawSecret[];
  };
  variants: {
    preview?: {
      secrets: AiroRawSecret[];
    };
    publish?: {
      secrets: AiroRawSecret[];
    };
  };
  metadata?: any;
}

/**
 * Get secrets response from mgmt-airo (transformed structure)
 */
export interface AiroGetSecretsResponse {
  appId: string;
  secrets: AiroSecretMetadata[];
  count: number;
}

/**
 * Secret operation for update secrets
 */
export interface AiroSecretOperation {
  type: 'upsert' | 'delete';
  secret: {
    name: string;
    value?: string;
    variants: string[];
    systemManaged?: boolean;
  };
}

/**
 * Update secrets request payload
 */
export interface AiroUpdateSecretsPayload {
  operations: AiroSecretOperation[];
  workflowName: string;
}

/**
 * Update secrets response from mgmt-airo
 */
export interface AiroUpdateSecretsResponse {
  message: string;
  appId: string;
  cellId?: string;
  variants: string[];
  workflowStatus: string;
  secretsUpdated: boolean;
  s3Bucket?: string;
  s3Key?: string;
  s3VersionId?: string;
  contentHash?: string;
  artifactId?: string;
  statusJobId?: string;
}

/**
 * Token budget response from mgmt-airo
 * GET /airo/v1/subscriptions/token-budget
 */
export interface AiroTokenBudgetResponse {
  userId: string;
  spend: number;
  budget: {
    budgetId: string;
    budgetDuration: string;
    maxBudget: number;
  };
}

/**
 * Create builder plan request payload
 */
export interface AiroCreateBuilderPlanPayload {
  plan?: SubscriptionPlan;
}

/**
 * Create builder plan response
 */
export interface AiroCreateBuilderPlanResponse {
  subscriptionId: string;
  plan: SubscriptionPlan;
  builderEntitlementId: string;
  message?: string;
}

/**
 * Grant type enum from the control plane API
 */
export enum AiroGrantType {
  PlanMonthly = 'plan-monthly',
  CreditPack = 'credit-pack',
}

/**
 * Final state of a grant
 */
export enum AiroGrantFinalState {
  Consumed = 'consumed',
  Expired = 'expired',
}

/**
 * Credit grant from the control plane API
 */
export interface AiroCreditGrant {
  id: string;
  subscriptionId: string;
  type: AiroGrantType;
  llmBudgetUserId: string;
  llmBudgetId: string;
  creditsMax: number;
  creditsSpent: number;
  isAvailable: boolean;
  finalState: AiroGrantFinalState | null;
  useBefore: string;
  consumedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Get credit grants response from mgmt-airo
 */
export interface AiroGetCreditGrantsResponse {
  grants: AiroCreditGrant[];
}

/**
 * Image status values
 */
export type AiroImageStatus = 'current' | 'stale' | 'reloading' | 'unknown' | 'unavailable';

/**
 * Individual image entry in status response
 */
export interface AiroImageStatusEntry {
  imageType: string;
  deployedTag: string;
  expectedTag: string;
  match: boolean;
}

/**
 * Response from GET image-status endpoint
 */
export interface AiroImageStatusResponse {
  appId: string;
  compositionId: string;
  compositionVersion: string;
  unifiedVariantJob: boolean;
  status: AiroImageStatus;
  images?: AiroImageStatusEntry[];
}

/**
 * Response from POST reload endpoint
 */
export interface AiroReloadImagesResponse {
  appId: string;
  status: AiroImageStatus;
  message: string;
  jobId?: string;
  startedAt?: string;
  failedAt?: string;
}

/**
 * Transfer initiation response from mgmt-airo
 */
export interface AiroTransferInitiateResponse {
  transferToken: string;
  appId: string;
  status: string;
  createdAt: string;
  expiresAt: string;
}

/**
 * Transfer metadata response from mgmt-airo
 */
export interface AiroTransferMetadata {
  appId: string;
  transferToken: string;
  status: string;
  createdAt: string;
  expiresAt: string;
}

/**
 * Transfer accept response from mgmt-airo
 */
export interface AiroTransferAcceptResponse {
  requestId: string;
  status: string;
  hostingTransferId: string | null;
  message: string;
  appId: string;
}

/**
 * Transfer cancel response from mgmt-airo
 */
export interface AiroTransferCancelResponse {
  status: string;
  appId: string;
  message: string;
}

/**
 * Purge cache response from POST .../purge-cache
 */
export interface AiroPurgeCacheResponse {
  statusJobId: string;
  message?: string;
  error?: string;
}

/**
 * Generic job status from GET /jobs/:jobId
 */
export interface AiroJob {
  id: string;
  jobType: string;
  status: 'queued' | 'in_progress' | 'success' | 'failure';
  ownerType?: string;
  ownerId?: string;
  customerId?: string;
  errorMessage?: string;
  resultData?: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
}
