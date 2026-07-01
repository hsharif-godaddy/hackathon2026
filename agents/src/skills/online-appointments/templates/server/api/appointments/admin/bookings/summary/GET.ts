import type { Request, Response } from "express";
import { db } from "../../../../../db/client.js";
import { booking } from "../../../../../db/schema.js";
import { count, eq, isNull } from "drizzle-orm";

export default async function handler(_req: Request, res: Response) {
  try {
    const [total] = await db
      .select({ count: count() })
      .from(booking)
      .where(isNull(booking.deletedAt));

    const [unpaid] = await db
      .select({ count: count() })
      .from(booking)
      .where(eq(booking.status, "unpaid"));

    const [paid] = await db
      .select({ count: count() })
      .from(booking)
      .where(eq(booking.status, "paid"));

    const [cancelled] = await db
      .select({ count: count() })
      .from(booking)
      .where(eq(booking.status, "cancelled"));

    return res.json({
      summary: {
        total: total?.count ?? 0,
        unpaid: unpaid?.count ?? 0,
        paid: paid?.count ?? 0,
        cancelled: cancelled?.count ?? 0,
      },
    });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
