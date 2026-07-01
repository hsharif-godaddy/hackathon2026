import type { Request, Response } from "express";
import { db } from "../../../../../../db/client.js";
import { exceptionTime, booking } from "../../../../../../db/schema.js";
import { and, eq, gte, lte, isNull, ne } from "drizzle-orm";

export default async function handler(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    if (!id) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid exception time ID" });
    }

    const [exception] = await db
      .select()
      .from(exceptionTime)
      .where(eq(exceptionTime.id, id))
      .limit(1);

    if (!exception?.startTime || !exception.endTime) {
      return res.status(404).json({ error: "Not found" });
    }

    const overlapping = await db
      .select()
      .from(booking)
      .where(
        and(
          lte(booking.startTime, exception.endTime),
          gte(booking.endTime, exception.startTime),
          isNull(booking.deletedAt),
          ne(booking.status, "cancelled"),
        ),
      );

    return res.json({ bookings: overlapping });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
