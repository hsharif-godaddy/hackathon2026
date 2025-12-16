/**
 * mgmt-airo API client
 *
 * Provides a clean, type-safe interface to the mgmt-airo and mgmt-hosting APIs.
 */

export { AiroMgmtClient } from './client';
export {
  AiroHttpError,
  DomainValidationError,
  DomainMode,
  AIRO_OWNER_PRODUCTS,
  AIRO_PRODUCT_IDS,
  DEFAULT_OWNER_PRODUCT
} from './types';
export type {
  AiroDeploymentsResponse,
  AiroDeploymentMetadata,
  AiroMgmtClientConfig,
  AiroDeleteAppResponse,
  AiroUpdateAppPayload,
  AiroUpdateProjectDomainPayload,
  AiroUpdateProjectDomainResponse,
  AiroDomainCheckResponse,
  DomainValidationErrorObject,
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
  AiroAttribute,
  AiroCreateAttributePayload,
  AiroUpdateAttributePayload,
  AiroApiError,
  AiroSystem,
  AiroApp,
  AiroOwnerProduct,
  AiroProductId,
  CustomerTree
} from './types';
