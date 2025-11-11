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
  };
  variables?: Record<string, any>;
}

/**
 * Full app details from mgmt-hosting (via mgmt-airo proxy)
 */
export interface AiroAppDetails extends AiroApp {
  variables: Record<string, any>;
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
 * Deploy app response
 */
export interface AiroDeployAppResponse {
  success: boolean;
  message: string;
  deploymentId?: string;
}

/**
 * Deployment status enum for publish operations
 */
export type AiroDeploymentStatus = 'pending' | 'deploying' | 'deployed' | 'failed';

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
 * Bulk customer apps response
 */
export interface AiroBulkAppsResponse {
  apps: AiroApp[];
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
 * Client configuration
 */
export interface AiroMgmtClientConfig {
  baseUrl: string;
  jwt: string;
  maxRetries?: number;
  retryDelayMs?: number;
}
