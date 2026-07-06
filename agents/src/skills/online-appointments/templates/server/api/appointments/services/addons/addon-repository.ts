/**
 * Addon repository
 *
 * Database access layer for addons. Handles all database queries
 * for addon CRUD operations.
 */

import { db } from "../../../../db/client";
import { addon, serviceAddon } from "../../../../db/schema";
import type { Addon } from "../../../../db/schema";
import { generateId } from "../../../../db/uuid";
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";

/**
 * Returns the database instance.
 */
function ensureDatabase() {
  return db;
}

/**
 * Filter type for querying addons
 */
export type AddonFilter = Partial<Addon>;

/**
 * Build SQL conditions from filter object
 */
function buildConditions(filters: AddonFilter): SQL[] {
  const conditions: SQL[] = [];

  // Map filter keys to actual column references
  if (filters.id !== undefined) {
    conditions.push(eq(addon.id, filters.id));
  }
  if (filters.title !== undefined) {
    conditions.push(eq(addon.title, filters.title));
  }
  if (filters.active !== undefined) {
    if (filters.active === null) {
      conditions.push(isNull(addon.active));
    } else {
      conditions.push(eq(addon.active, filters.active));
    }
  }
  if (filters.deletedAt !== undefined) {
    if (filters.deletedAt === null) {
      conditions.push(isNull(addon.deletedAt));
    } else {
      conditions.push(eq(addon.deletedAt, filters.deletedAt));
    }
  }

  return conditions;
}

/**
 * Find addons matching the given filters
 */
export async function findAddons(filters: AddonFilter): Promise<Addon[]> {
  const database = ensureDatabase();
  const conditions = buildConditions(filters);

  if (conditions.length === 0) {
    return database.select().from(addon);
  }

  return database
    .select()
    .from(addon)
    .where(and(...conditions));
}

/**
 * Find a single addon by ID
 */
export async function findAddonById(id: string): Promise<Addon | null> {
  const database = ensureDatabase();
  const result = await database.select().from(addon).where(eq(addon.id, id)).limit(1);

  return result[0] ?? null;
}

/**
 * Count addons matching the given filters
 */
export async function countAddons(filters: AddonFilter): Promise<number> {
  const database = ensureDatabase();
  const conditions = buildConditions(filters);

  const result = await database
    .select({ count: sql<number>`count(*)` })
    .from(addon)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  return result[0]?.count ?? 0;
}

/**
 * Insert a new addon into the database
 */
export async function insertAddon(addonData: {
  title: string;
  description: string | null;
  price: string;
  duration: string;
  active: boolean;
}): Promise<Addon> {
  const database = ensureDatabase();
  const id = generateId();
  await database.insert(addon).values({
    id,
    ...addonData,
  });

  const inserted = await findAddonById(id);

  if (!inserted) {
    throw new Error("Failed to retrieve inserted addon");
  }

  return inserted;
}

/**
 * Soft delete an addon by ID
 * Sets deletedAt timestamp without removing the record
 */
export async function softDeleteAddon(id: string): Promise<boolean> {
  const database = ensureDatabase();
  const result = await database
    .update(addon)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(addon.id, id), isNull(addon.deletedAt)));

  return result[0].affectedRows > 0;
}

/**
 * Update an addon by ID
 * Updates specified fields and returns the updated addon
 */
export async function updateAddonById(id: string, updates: Partial<Addon>): Promise<Addon | null> {
  const database = ensureDatabase();

  // Update the addon
  await database
    .update(addon)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(and(eq(addon.id, id), isNull(addon.deletedAt)));

  // Fetch and return the updated addon
  return findAddonById(id);
}

/**
 * Link an addon to a service
 */
export async function linkAddonToService(addonId: string, serviceId: string): Promise<void> {
  const database = ensureDatabase();
  const id = generateId();

  await database.insert(serviceAddon).values({
    id,
    addonId,
    serviceId,
  });
}

/**
 * Unlink an addon from a service
 */
export async function unlinkAddonFromService(addonId: string, serviceId: string): Promise<void> {
  const database = ensureDatabase();

  await database
    .delete(serviceAddon)
    .where(and(eq(serviceAddon.addonId, addonId), eq(serviceAddon.serviceId, serviceId)));
}

/**
 * Replace the full set of addon links for a service.
 *
 * Deletes all existing links for the service and inserts the provided set in a
 * single transaction, giving the bulk "assign these add-ons" flow replace
 * semantics. Caller is responsible for de-duplicating and validating addonIds.
 */
export async function replaceServiceAddonLinks(
  serviceId: string,
  addonIds: string[],
): Promise<void> {
  const database = ensureDatabase();

  await database.transaction(async (tx): Promise<void> => {
    await tx.delete(serviceAddon).where(eq(serviceAddon.serviceId, serviceId));
    if (addonIds.length > 0) {
      await tx.insert(serviceAddon).values(
        addonIds.map((addonId: string) => ({
          id: generateId(),
          serviceId,
          addonId,
        })),
      );
    }
  });
}

/**
 * Get all addons linked to a service
 */
export async function findAddonsByServiceId(serviceId: string): Promise<Addon[]> {
  const database = ensureDatabase();

  const result = await database
    .select({
      id: addon.id,
      title: addon.title,
      description: addon.description,
      price: addon.price,
      duration: addon.duration,
      active: addon.active,
      createdAt: addon.createdAt,
      updatedAt: addon.updatedAt,
      deletedAt: addon.deletedAt,
    })
    .from(serviceAddon)
    .innerJoin(addon, eq(serviceAddon.addonId, addon.id))
    .where(and(eq(serviceAddon.serviceId, serviceId), isNull(addon.deletedAt)));

  return result;
}
