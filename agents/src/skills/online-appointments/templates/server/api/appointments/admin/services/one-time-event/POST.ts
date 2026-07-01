import type { Request, Response } from "express";
import { z } from "zod";
import { TZDate } from "@date-fns/tz";
import { db } from "../../../../../db/client";
import { service } from "../../../../../db/schema";
import { generateId } from "../../../../../db/uuid";
import { eq } from "drizzle-orm";
import { getTimezone } from "../../../services/availability";
import { parseDurationMinutes } from "../../../services/recurrence";

const Schema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  event_time: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM"),
  duration: z.string().min(1),
  max_participants: z.number().int().min(1).max(300),
  cost: z.string().optional(),
  cost_type: z.string().optional(),
  location_type: z.string().optional(),
  custom_location_text: z.string().optional(),
  staff_role: z.string().max(100).optional(),
  visible: z.boolean().optional(),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export default async function handler(req: Request, res: Response) {
  try {
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const data = parsed.data;
    const slug = slugify(data.name);
    const now = new Date();

    const timezone = await getTimezone();
    const [year, month, day] = data.event_date.split("-").map(Number) as [number, number, number];
    const [hour, minute] = data.event_time.split(":").map(Number) as [number, number];
    const tzDate = new TZDate(year, month - 1, day, hour, minute, 0, timezone);
    const startTime = new Date(tzDate.getTime());
    const durationMins = parseDurationMinutes(data.duration);
    const endTime = new Date(startTime.getTime() + durationMins * 60000);

    const serviceId = generateId();

    await db.insert(service).values({
      id: serviceId,
      name: data.name,
      slug,
      description: data.description,
      startTime,
      endTime,
      duration: data.duration,
      cost: data.cost,
      costType: data.cost_type,
      capacity: data.max_participants,
      recurrenceType: "one_time",
      locationType: data.location_type,
      customLocationText: data.custom_location_text,
      staffRole: data.staff_role ?? null,
      visible: data.visible ?? true,
      createdAt: now,
      updatedAt: now,
    });

    const [created] = await db.select().from(service).where(eq(service.id, serviceId)).limit(1);
    return res.status(201).json({ service: created });
  } catch (error) {
    console.error("[POST /api/admin/services/one-time-event]", error);
    return res
      .status(500)
      .json({ error: "Internal Server Error", message: "An unexpected error occurred" });
  }
}
