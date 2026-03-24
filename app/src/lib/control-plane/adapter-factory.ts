import { IControlPlaneAdapter } from './types';
import { V2ControlPlaneAdapter } from './v2-control-plane-adapter';

/**
 * Control Plane Adapter Factory
 *
 * Returns the V2 control plane adapter backed by mgmt-airo
 * (local-control-plane in local dev, production mgmt-airo in prod).
 */
export function getControlPlaneAdapter(): IControlPlaneAdapter {
  return new V2ControlPlaneAdapter();
}
