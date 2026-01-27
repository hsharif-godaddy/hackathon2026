import { getNomadAllocConfig } from './nomad-config.js';

/**
 * Check if a capability is enabled.
 * Reads from /alloc/config.json CAPABILITIES.VALUE array.
 *
 * @param capability - The capability name to check (case-insensitive)
 * @returns true if capability exists, false otherwise
 */
export function isCapabilityEnabled(capability: string): boolean {
  if (typeof capability !== 'string') {
    return false;
  }

  const config = getNomadAllocConfig();
  const capabilities = (config?.CAPABILITIES as { VALUE?: unknown } | undefined)?.VALUE;

  if (!Array.isArray(capabilities)) {
    return false;
  }

  const normalizedCapability = capability.toUpperCase();
  return capabilities.some(
    (cap) => typeof cap === 'string' && cap.toUpperCase() === normalizedCapability
  );
}
