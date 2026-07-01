import type { Request, Response } from "express";
import { db } from "../../../../../db/client.js";
import { booking } from "../../../../../db/schema.js";
import { and, eq, lt, isNull, ne, count, desc } from "drizzle-orm";
import { parsePagination, paginatedResponse } from "../../../shared/pagination";

export default async function handler(req: Request, res: Response) {
  try {
    const extContactId = req.query.ext_contact_id as string;
    if (!extContactId) {
      return res.status(400).json({
        error: "Bad Request",
        message: "ext_contact_id query parameter is required",
      });
    }

    const { page, perPage, offset } = parsePagination(req);
    const now = new Date();

    const conditions = and(
      eq(booking.extContactId, extContactId),
      lt(booking.startTime, now),
      isNull(booking.deletedAt),
      ne(booking.status, "cancelled"),
    );

    const [items, totalResult] = await Promise.all([
      db
        .select()
        .from(booking)
        .where(conditions)
        .orderBy(desc(booking.startTime))
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
