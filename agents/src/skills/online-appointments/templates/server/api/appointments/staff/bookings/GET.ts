import type { Request, Response } from "express";
import { db } from "../../../../db/client.js";
import { bookedInstance } from "../../../../db/schema.js";
import { and, count, eq, gte } from "drizzle-orm";
import { parsePagination, paginatedResponse } from "../../shared/pagination";

// Expects req.staffId to be set by upstream auth middleware.
export default async function handler(req: Request, res: Response) {
  try {
    const staffId = (req as Request & { staffId?: string }).staffId;
    if (!staffId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { page, perPage, offset } = parsePagination(req);
    const now = new Date();

    const conditions = [eq(bookedInstance.staffId, staffId), gte(bookedInstance.startTime, now)];

    const [items, totalResult] = await Promise.all([
      db
        .select()
        .from(bookedInstance)
        .where(and(...conditions))
        .limit(perPage)
        .offset(offset),
      db
        .select({ count: count() })
        .from(bookedInstance)
        .where(and(...conditions)),
    ]);

    const totalCount = totalResult[0]?.count ?? 0;
    return res.json(paginatedResponse(items, totalCount, page, perPage));
  } catch (_error) {
    return res
      .status(500)
      .json({ error: "Internal Server Error", message: "An unexpected error occurred" });
  }
}
