/**
 * Service for managing service-addon relationships
 *
 * Handles linking and unlinking addons to/from services.
 */

import {
  linkAddonToService,
  unlinkAddonFromService,
  findAddonsByServiceId,
  findAddonById,
  replaceServiceAddonLinks,
} from "./addon-repository";
import type { Addon } from "../../../../db/schema";

/**
 * Custom error for addon not found
 */
export class AddonNotFoundError extends Error {
  constructor(id: string) {
    super(`Addon with ID ${id} not found`);
    this.name = "AddonNotFoundError";
  }
}

/**
 * Link an addon to a service
 *
 * @param serviceId - Service ID
 * @param addonId - Addon ID
 * @throws {AddonNotFoundError} If addon doesn't exist
 */
export async function addAddonToService(serviceId: string, addonId: string): Promise<void> {
  // Verify addon exists
  const addon = await findAddonById(addonId);

  if (!addon || addon.deletedAt) {
    throw new AddonNotFoundError(addonId);
  }

  await linkAddonToService(addonId, serviceId);
}

/**
 * Unlink an addon from a service
 *
 * @param serviceId - Service ID
 * @param addonId - Addon ID
 */
export async function removeAddonFromService(serviceId: string, addonId: string): Promise<void> {
  await unlinkAddonFromService(addonId, serviceId);
}

/**
 * Get all addons for a service
 *
 * @param serviceId - Service ID
 * @returns Array of addons linked to the service
 */
export async function getServiceAddons(serviceId: string): Promise<Addon[]> {
  return findAddonsByServiceId(serviceId);
}

/**
 * Replace the complete set of addons linked to a service (bulk assign).
 *
 * Validates every addon exists and is not soft-deleted, de-duplicates the
 * input, then atomically replaces the service's links with the given set.
 *
 * @param serviceId - Service ID
 * @param addonIds - Full set of addon IDs that should be linked to the service
 * @throws {AddonNotFoundError} If any addon doesn't exist or is soft-deleted
 */
export async function setServiceAddons(serviceId: string, addonIds: string[]): Promise<void> {
  const uniqueAddonIds: string[] = [...new Set(addonIds)];

  for (const addonId of uniqueAddonIds) {
    const addon: Addon | null = await findAddonById(addonId);
    if (!addon || addon.deletedAt) {
      throw new AddonNotFoundError(addonId);
    }
  }

  await replaceServiceAddonLinks(serviceId, uniqueAddonIds);
}
