/**
 * Service for creating addons
 *
 * Handles business logic for addon creation including:
 * - Maximum addon count validation
 * - Data normalization
 * - Database insertion
 */

import { insertAddon, countAddons } from "./addon-repository";
import type { Addon } from "../../../../db/schema";

/**
 * Input type for creating an addon
 */
export type CreateAddonInput = {
  title: string;
  description: string | null;
  price: number;
  duration: string;
  active: boolean;
};

/**
 * Maximum number of addons allowed per account
 */
const MAX_ADDON_COUNT = 50;

/**
 * Custom error for exceeding maximum addon count
 */
export class MaxAddonCountError extends Error {
  constructor(max: number) {
    super(`Maximum number of addons (${max}) reached`);
    this.name = "MaxAddonCountError";
  }
}

/**
 * Create a new addon
 *
 * Validates that:
 * - Maximum addon count hasn't been exceeded
 * Then inserts the addon into the database.
 *
 * @param input - Addon data from request
 * @returns The created addon
 * @throws {MaxAddonCountError} If maximum addon count has been reached
 */
export async function createAddon(input: CreateAddonInput): Promise<Addon> {
  // Check if maximum addon count has been reached
  const count = await countAddons({
    deletedAt: null,
  });

  if (count >= MAX_ADDON_COUNT) {
    throw new MaxAddonCountError(MAX_ADDON_COUNT);
  }

  // Insert the addon. Convert price to a string so it matches the decimal
  // column contract (every other decimal write uses strings) — see update.service.ts.
  const newAddon = await insertAddon({
    title: input.title,
    description: input.description,
    price: String(input.price),
    duration: input.duration,
    active: input.active,
  });

  return newAddon;
}
