/**
 * mgmt-airo API client
 *
 * Provides a clean, type-safe interface to the mgmt-airo and mgmt-hosting APIs.
 */

export { AiroMgmtClient } from './client';
export type {
  AiroApiError,
  AiroApp,
  AiroAppDetails,
  AiroAttribute,
  AiroCreateAppPayload,
  AiroCreateAppResponse,
  AiroCreateAttributePayload,
  AiroCustomer,
  AiroDeleteAppResponse,
  AiroDeployAppResponse,
  AiroDeployment,
  AiroDeploymentJob,
  AiroDeploymentMetadata,
  AiroDeploymentsResponse,
  AiroDeploymentStatus,
  AiroDomainCheckResponse,
  AiroJobStatus,
  AiroMgmtClientConfig,
  AiroOwnerProduct,
  AiroProductId,
  AiroPublishAppResponse,
  AiroSignupPayload,
  AiroSignupResponse,
  AiroSubscription,
  AiroSystem,
  AiroUpdateAppPayload,
  AiroUpdateAttributePayload,
  AiroUpdateProjectDomainPayload,
  AiroUpdateProjectDomainResponse,
  CustomerTree,
  DomainValidationErrorObject} from './types';
export {
  AIRO_OWNER_PRODUCTS,
  AIRO_PRODUCT_IDS,
  AiroHttpError,
  DEFAULT_OWNER_PRODUCT,
  DomainMode,
  DomainValidationError} from './types';
