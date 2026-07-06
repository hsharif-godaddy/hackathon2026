/**
 * Service for updating addons
 *
 * Handles business logic for addon updates including:
 * - Validation that addon exists
 * - Data normalization
 * - Database update
 */

import { findAddonById, updateAddonById } from "./addon-repository";
import type { Addon } from "../../../../db/schema";

/**
 * Input type for updating an addon
 */
export type UpdateAddonInput = {
  title?: string;
  description?: string | null;
  price?: number;
  duration?: string;
  active?: boolean;
};

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
 * Update an addon
 *
 * Validates that:
 * - Addon exists and is not soft-deleted
 * Then updates the addon in the database.
 *
 * @param id - Addon ID
 * @param input - Updated addon data from request
 * @returns The updated addon
 * @throws {AddonNotFoundError} If addon doesn't exist or is deleted
 */
export async function updateAddon(id: string, input: UpdateAddonInput): Promise<Addon> {
  // Check if addon exists
  const existing = await findAddonById(id);

  if (!existing || existing.deletedAt) {
    throw new AddonNotFoundError(id);
  }

  // Build update object with only provided fields
  const updates: Partial<Addon> = {};

  if (input.title !== undefined) {
    updates.title = input.title;
  }
  if (input.description !== undefined) {
    updates.description = input.description;
  }
  if (input.price !== undefined) {
    updates.price = String(input.price);
  }
  if (input.duration !== undefined) {
    updates.duration = input.duration;
  }
  if (input.active !== undefined) {
    updates.active = input.active;
  }

  // Update the addon
  const updated = await updateAddonById(id, updates);

  if (!updated) {
    throw new AddonNotFoundError(id);
  }

  return updated;
}
