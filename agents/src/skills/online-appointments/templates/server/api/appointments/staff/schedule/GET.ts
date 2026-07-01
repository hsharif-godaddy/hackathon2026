import type { Request, Response } from "express";
import { db } from "../../../../db/client.js";
import { bookedInstance, exceptionTime } from "../../../../db/schema.js";
import { and, between, eq } from "drizzle-orm";

// Returns booked slots and blocked times for a staff member within a date range.
// Expects req.staffId to be set by upstream auth middleware.
export default async function handler(req: Request, res: Response) {
  try {
    const staffId = (req as Request & { staffId?: string }).staffId;
    if (!staffId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { start_date, end_date } = req.query as { start_date?: string; end_date?: string };
    if (!start_date || !end_date) {
      return res
        .status(400)
        .json({ error: "Bad Request", message: "start_date and end_date are required" });
    }

    const start = new Date(start_date);
    const end = new Date(end_date);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid date format" });
    }

    const [bookings, blocks] = await Promise.all([
      db
        .select()
        .from(bookedInstance)
        .where(
          and(eq(bookedInstance.staffId, staffId), between(bookedInstance.startTime, start, end)),
        ),
      db
        .select()
        .from(exceptionTime)
        .where(
          and(eq(exceptionTime.staffId, staffId), between(exceptionTime.startTime, start, end)),
        ),
    ]);

    return res.json({ bookings, blocks });
  } catch (_error) {
    return res
      .status(500)
      .json({ error: "Internal Server Error", message: "An unexpected error occurred" });
  }
}
