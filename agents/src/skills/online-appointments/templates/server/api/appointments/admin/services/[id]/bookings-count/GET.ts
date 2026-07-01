import type { Request, Response } from "express";
import { db } from "../../../../../../db/client.js";
import { booking } from "../../../../../../db/schema.js";
import { and, eq, isNull, count } from "drizzle-orm";

export default async function handler(req: Request, res: Response) {
  try {
    const serviceId = req.params.id as string;
    if (!serviceId) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid service ID" });
    }

    const [result] = await db
      .select({ count: count() })
      .from(booking)
      .where(
        and(
          eq(booking.bookableId, serviceId),
          eq(booking.bookableType, "Service"),
          isNull(booking.deletedAt),
        ),
      );

    return res.json({ count: result?.count ?? 0 });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
