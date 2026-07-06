/**
 * Service for managing addon-service assignments
 *
 * Handles assigning and unassigning addons to/from services.
 */

import { findAddonsByServiceId } from "./addon-repository";
import type { Addon } from "../../../../db/schema";

/**
 * Get all active addons for a service
 *
 * Returns only addons that are active and not soft-deleted.
 * Used by the public booking flow.
 *
 * @param serviceId - Service ID
 * @returns Array of active addons linked to the service
 */
export async function getActiveServiceAddons(serviceId: string): Promise<Addon[]> {
  const addons = await findAddonsByServiceId(serviceId);

  // Filter to only active addons (not soft-deleted is already handled in repository)
  return addons.filter((addon) => addon.active);
}
