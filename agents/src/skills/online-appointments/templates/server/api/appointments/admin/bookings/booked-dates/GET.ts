import type { Request, Response } from "express";
import { db } from "../../../../../db/client.js";
import { booking } from "../../../../../db/schema.js";
import { and, gte, lte, isNull, ne } from "drizzle-orm";

export default async function handler(req: Request, res: Response) {
  try {
    const startDate = req.query.start_date as string;
    const endDate = req.query.end_date as string;

    if (!startDate || !endDate) {
      return res.status(400).json({
        error: "Bad Request",
        message: "start_date and end_date query parameters are required",
      });
    }

    const bookings = await db
      .select({ startTime: booking.startTime })
      .from(booking)
      .where(
        and(
          gte(booking.startTime, new Date(startDate)),
          lte(booking.startTime, new Date(endDate)),
          isNull(booking.deletedAt),
          ne(booking.status, "cancelled"),
        ),
      );

    const dates = new Set<string>();
    for (const b of bookings) {
      if (b.startTime) {
        dates.add(b.startTime.toISOString().slice(0, 10));
      }
    }

    return res.json({ booked_dates: Array.from(dates).sort() });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
