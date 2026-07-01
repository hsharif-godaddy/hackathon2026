/**
 * Coupon repository
 *
 * Database access layer for coupons. Handles all database queries
 * for coupon CRUD operations.
 */

import { db } from "../../../../db/client";
import { coupons } from "../../../../db/schema";
import type { Coupon } from "../../../../db/schema";
import { generateId } from "../../../../db/uuid";
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";

/**
 * Returns the database instance.
 */
function ensureDatabase() {
  return db;
}

/**
 * Filter type for querying coupons
 */
export type CouponFilter = Partial<Coupon>;

/**
 * Build SQL conditions from filter object
 */
function buildConditions(filters: CouponFilter): SQL[] {
  const conditions: SQL[] = [];

  // Map filter keys to actual column references
  if (filters.id !== undefined) {
    conditions.push(eq(coupons.id, filters.id));
  }
  if (filters.code !== undefined) {
    conditions.push(eq(coupons.code, filters.code));
  }
  if (filters.type !== undefined) {
    conditions.push(eq(coupons.type, filters.type));
  }
  if (filters.isActive !== undefined) {
    if (filters.isActive === null) {
      conditions.push(isNull(coupons.isActive));
    } else {
      conditions.push(eq(coupons.isActive, filters.isActive));
    }
  }
  if (filters.deletedAt !== undefined) {
    if (filters.deletedAt === null) {
      conditions.push(isNull(coupons.deletedAt));
    } else {
      conditions.push(eq(coupons.deletedAt, filters.deletedAt));
    }
  }

  return conditions;
}

/**
 * Find coupons matching the given filters
 */
export async function findCoupons(filters: CouponFilter): Promise<Coupon[]> {
  const database = ensureDatabase();
  const conditions = buildConditions(filters);

  if (conditions.length === 0) {
    return database.select().from(coupons);
  }

  return database
    .select()
    .from(coupons)
    .where(and(...conditions));
}

/**
 * Find a single coupon by ID
 */
export async function findCouponById(id: string): Promise<Coupon | null> {
  const database = ensureDatabase();
  const result = await database.select().from(coupons).where(eq(coupons.id, id)).limit(1);

  return result[0] ?? null;
}

/**
 * Find a single coupon by code
 * Excludes soft-deleted coupons
 */
export async function findCouponByCode(code: string): Promise<Coupon | null> {
  const database = ensureDatabase();
  const result = await database
    .select()
    .from(coupons)
    .where(and(eq(coupons.code, code), isNull(coupons.deletedAt)))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Count coupons matching the given filters
 */
export async function countCoupons(filters: CouponFilter): Promise<number> {
  const database = ensureDatabase();
  const conditions = buildConditions(filters);

  const result = await database
    .select({ count: sql<number>`count(*)` })
    .from(coupons)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  return result[0]?.count ?? 0;
}

/**
 * Increment the usage count for a coupon
 */
export async function incrementCouponUsage(code: string): Promise<void> {
  const database = ensureDatabase();
  await database
    .update(coupons)
    .set({
      currentUsage: sql`${coupons.currentUsage} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(coupons.code, code));
}

/**
 * Decrement the usage count for a coupon
 */
export async function decrementCouponUsage(code: string): Promise<void> {
  const database = ensureDatabase();
  await database
    .update(coupons)
    .set({
      currentUsage: sql`GREATEST(0, ${coupons.currentUsage} - 1)`,
      updatedAt: new Date(),
    })
    .where(eq(coupons.code, code));
}

/**
 * Insert a new coupon into the database
 */
export async function insertCoupon(coupon: {
  code: string;
  type: string;
  minimumCartValue: number;
  discountPrice?: number;
  discountPercentage?: number;
  startDate: Date;
  endDate: Date;
  limitUses: boolean;
  limit?: number;
  isActive: boolean;
}): Promise<Coupon> {
  const database = ensureDatabase();
  const id = generateId();
  await database.insert(coupons).values({
    id,
    ...coupon,
    currentUsage: 0,
    discountPrice: coupon.discountPrice ?? null,
    discountPercentage: coupon.discountPercentage ?? null,
    limit: coupon.limit ?? null,
  });

  const inserted = await findCouponById(id);

  if (!inserted) {
    throw new Error("Failed to retrieve inserted coupon");
  }

  return inserted;
}

/**
 * Soft delete a coupon by ID
 * Sets deletedAt timestamp without removing the record
 */
export async function softDeleteCoupon(id: string): Promise<boolean> {
  const database = ensureDatabase();
  const result = await database
    .update(coupons)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(coupons.id, id), isNull(coupons.deletedAt)));

  return result[0].affectedRows > 0;
}

/**
 * Update a coupon by ID
 * Updates specified fields and returns the updated coupon
 */
export async function updateCouponById(
  id: string,
  updates: Partial<Coupon>,
): Promise<Coupon | null> {
  const database = ensureDatabase();

  // Update the coupon
  await database
    .update(coupons)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(and(eq(coupons.id, id), isNull(coupons.deletedAt)));

  // Fetch and return the updated coupon
  return findCouponById(id);
}
