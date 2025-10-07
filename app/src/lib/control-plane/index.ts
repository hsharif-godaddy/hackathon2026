/**
 * Control Plane Module
 *
 * Exports control plane adapters and utilities for managing sites
 * across different infrastructure backends (V2 mgmt-airo vs Legacy database)
 */

export { getControlPlaneAdapter, isV2ControlPlaneEnabled } from './adapter-factory';
export { V2ControlPlaneAdapter } from './v2-control-plane-adapter';
export { LegacyControlPlaneAdapter } from './legacy-control-plane-adapter';
export type {
  IControlPlaneAdapter,
  SiteInfo,
  CreateSiteResult,
  SiteStatus
} from './types';

