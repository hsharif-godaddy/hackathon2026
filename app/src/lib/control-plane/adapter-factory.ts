import { IControlPlaneAdapter } from './types';
import { V2ControlPlaneAdapter } from './v2-control-plane-adapter';
import { LegacyControlPlaneAdapter } from './legacy-control-plane-adapter';

/**
 * Control Plane Adapter Factory
 *
 * Determines which control plane adapter to use based on feature flag.
 * Enables gradual migration from legacy (database + Nomad/SQS) to V2 (mgmt-airo).
 *
 * Feature Flag: USE_V2_CONTROL_PLANE
 * - true: Use V2ControlPlaneAdapter (mgmt-airo + mgmt-hosting)
 * - false: Use LegacyControlPlaneAdapter (database + Nomad/SQS)
 */
export function getControlPlaneAdapter(): IControlPlaneAdapter {
  if (process.env.USE_V2_CONTROL_PLANE === 'true') {
    return new V2ControlPlaneAdapter();
  }
  return new LegacyControlPlaneAdapter();
}

/**
 * Check if V2 control plane is enabled
 */
export function isV2ControlPlaneEnabled(): boolean {
  return process.env.USE_V2_CONTROL_PLANE === 'true';
}

