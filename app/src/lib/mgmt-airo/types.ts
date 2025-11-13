/**
 * Type definitions for mgmt-airo API
 */

/**
 * Subscription response from mgmt-airo
 */
export interface AiroSubscription {
  id: string;
  productId: string;
  customerId: string;
  status: string;
  isTrial: boolean;
  entitlementId: string;
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
  variants?: string[];
}

/**
 * Domain information in app details response
 */
export interface AiroDomain {
  fqdn: string;
  isPrimary: boolean;
  status: string;
  cdnStatus?: string;
  anycastIp?: string;
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
    environments: string[];
    variables: Record<string, any>;
  }>;
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
  environments: string[];
  variables: Record<string, any>;
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
 * HTTP error class with status code
 */
export class AiroHttpError extends Error {
  status: number;
  statusText: string;
  body: AiroApiError | string;

  constructor(status: number, statusText: string, body: AiroApiError | string) {
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
}
