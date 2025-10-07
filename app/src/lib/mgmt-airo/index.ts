/**
 * mgmt-airo API client
 * 
 * Provides a clean, type-safe interface to the mgmt-airo and mgmt-hosting APIs.
 */

export { AiroMgmtClient } from './client';
export type {
  AiroMgmtClientConfig,
  AiroSubscription,
  AiroSystem,
  AiroApp,
  AiroAppDetails,
  AiroJobStatus,
  AiroCustomer,
  AiroSignupPayload,
  AiroSignupResponse,
  AiroCreateAppPayload,
  AiroCreateAppResponse,
  AiroUpdateAppPayload,
  AiroDeployAppResponse,
  AiroDeleteAppResponse,
  AiroApiError
} from './types';

