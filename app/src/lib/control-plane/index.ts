/**
 * Control Plane Module
 *
 * Exports control plane adapter and types for managing sites
 * via the V2 mgmt-airo backend.
 */

export { getControlPlaneAdapter } from './adapter-factory';
export type {
  CreateSiteResult,
  IControlPlaneAdapter,
  SiteInfo,
  SiteStatus
} from './types';
export { V2ControlPlaneAdapter } from './v2-control-plane-adapter';
