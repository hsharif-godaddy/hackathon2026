import type { Request, Response } from "express";
import { db } from "../../../../../db/client.js";
import { booking } from "../../../../../db/schema.js";
import { and, gte, isNull, ne, count } from "drizzle-orm";
import { parsePagination, paginatedResponse } from "../../../shared/pagination";

export default async function handler(req: Request, res: Response) {
  try {
    const { page, perPage, offset } = parsePagination(req);
    const now = new Date();

    const conditions = and(
      gte(booking.startTime, now),
      isNull(booking.deletedAt),
      ne(booking.status, "cancelled"),
    );

    const [items, totalResult] = await Promise.all([
      db
        .select()
        .from(booking)
        .where(conditions)
        .orderBy(booking.startTime)
        .limit(perPage)
        .offset(offset),
      db.select({ count: count() }).from(booking).where(conditions),
    ]);

    const totalCount = totalResult[0]?.count ?? 0;
    return res.json(paginatedResponse(items, totalCount, page, perPage));
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
