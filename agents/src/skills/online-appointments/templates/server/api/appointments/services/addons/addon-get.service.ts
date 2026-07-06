/**
 * Service for getting a single addon by ID
 *
 * Fetches an addon from the database.
 */

import { findAddonById } from "./addon-repository";
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
 * Get a single addon by ID
 *
 * Fetches the addon from database.
 *
 * @param id - Addon ID
 * @returns Addon
 * @throws {AddonNotFoundError} If addon doesn't exist
 */
export async function getAddon(id: string): Promise<Addon> {
  const addon = await findAddonById(id);

  if (!addon) {
    throw new AddonNotFoundError(id);
  }

  return addon;
}
