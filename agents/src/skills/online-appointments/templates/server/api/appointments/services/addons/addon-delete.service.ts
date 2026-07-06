/**
 * Service for deleting addons
 *
 * Handles soft deletion of addons from the system.
 */

import { softDeleteAddon } from "./addon-repository";

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
 * Delete an addon (soft delete)
 *
 * Sets the deletedAt timestamp on the addon without physically removing it.
 *
 * @param id - Addon ID
 * @throws {AddonNotFoundError} If addon doesn't exist or is already deleted
 */
export async function deleteAddon(id: string): Promise<void> {
  const success = await softDeleteAddon(id);

  if (!success) {
    throw new AddonNotFoundError(id);
  }
}
