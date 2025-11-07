/**
 * mgmt-airo API client
 *
 * Provides a clean, type-safe interface to the mgmt-airo and mgmt-hosting APIs.
 */

export { AiroMgmtClient } from './client';
export { AiroHttpError } from './types';
export type {
  AiroDeploymentsResponse,
  AiroDeploymentMetadata,
  AiroMgmtClientConfig,
  AiroDeleteAppResponse,
  AiroUpdateAppPayload,
  AiroCreateAppResponse,
  AiroCreateAppPayload,
  AiroSignupResponse,
  AiroDeployAppResponse,
  AiroDeploymentJob,
  AiroDeployment,
  AiroSubscription,
  AiroSignupPayload,
  AiroAppDetails,
  AiroJobStatus,
  AiroCustomer,
  AiroPublishAppResponse,
  AiroDeploymentStatus,
  AiroApiError,
  AiroSystem,
  AiroApp
} from './types';

