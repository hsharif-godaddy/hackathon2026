import type { Request, Response } from "express";
import { db } from "../../../../../../db/client.js";
import { service as serviceTable } from "../../../../../../db/schema.js";
import { eq, isNull, and } from "drizzle-orm";
import {
  parseSchedule,
  expandOccurrences,
  parseDurationMinutes,
} from "../../../../services/recurrence";

export default async function handler(req: Request, res: Response) {
  try {
    const serviceId = req.params.id as string;
    if (!serviceId) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid service ID" });
    }

    const startDate = req.query.start_date as string;
    const endDate = req.query.end_date as string;
    if (!startDate || !endDate) {
      return res.status(400).json({
        error: "Bad Request",
        message: "start_date and end_date query parameters are required",
      });
    }

    const [svc] = await db
      .select()
      .from(serviceTable)
      .where(and(eq(serviceTable.id, serviceId), isNull(serviceTable.deletedAt)))
      .limit(1);

    if (!svc) {
      return res.status(404).json({ error: "Not found" });
    }

    const schedule = parseSchedule(svc.schedule);
    if (!schedule) {
      return res.json({ events: [] });
    }

    const rangeStart = new Date(startDate);
    const rangeEnd = new Date(endDate);
    const durationMinutes = parseDurationMinutes(svc.duration ?? "PT60M");

    const occurrences = expandOccurrences(schedule, rangeStart, rangeEnd, "UTC");

    const events = occurrences.map((start) => ({
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + durationMinutes * 60000).toISOString(),
      service_id: svc.id,
      service_name: svc.name,
    }));

    return res.json({ events });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
