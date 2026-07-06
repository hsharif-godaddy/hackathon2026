/**
 * Service for listing addons
 *
 * Fetches addons for an account with optional filters.
 */

import { findAddons, type AddonFilter } from "./addon-repository";
import type { Addon } from "../../../../db/schema";

/**
 * Query parameters for listing addons
 */
export type ListAddonsQuery = {
  active?: boolean;
};

/**
 * Get list of addons
 *
 * Fetches addons from database and optionally filters to only active addons.
 *
 * @param query - Query parameters (filters)
 * @returns Array of addons
 */
export async function getAddons(query: ListAddonsQuery): Promise<Addon[]> {
  // Build filter object for repository
  const filter: AddonFilter = {
    deletedAt: null, // Exclude soft-deleted addons
  };

  // Add optional filters
  if (query.active !== undefined) {
    filter.active = query.active;
  }

  // Fetch addons from database
  const addons = await findAddons(filter);

  return addons;
}
