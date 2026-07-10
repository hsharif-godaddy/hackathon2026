import { MockControlPlaneAdapter } from './mock-control-plane-adapter';
import { IControlPlaneAdapter } from './types';
import { V2ControlPlaneAdapter } from './v2-control-plane-adapter';

/**
 * Control Plane Adapter Factory
 *
 * Returns the V2 control plane adapter backed by mgmt-airo
 * (local-control-plane in local dev, production mgmt-airo in prod).
 * In mock-auth mode, returns a stub adapter with hardcoded demo data.
 */
export function getControlPlaneAdapter(): IControlPlaneAdapter {
  if (process.env.AUTH_TYPE === 'mock') {
    return new MockControlPlaneAdapter();
  }
  return new V2ControlPlaneAdapter();
}
