import type { Request, Response } from "express";
import { db } from "../../../../../../db/client.js";
import { booking } from "../../../../../../db/schema.js";
import { and, eq, isNull } from "drizzle-orm";
import { parsePagination, paginatedResponse } from "../../../../shared/pagination";
import { count } from "drizzle-orm";

export default async function handler(req: Request, res: Response) {
  try {
    const clientId = req.params.id as string;
    if (!clientId) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid client ID" });
    }

    const { page, perPage, offset } = parsePagination(req);

    const conditions = and(
      eq(booking.bookerId, clientId),
      eq(booking.bookerType, "Client"),
      isNull(booking.deletedAt),
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
