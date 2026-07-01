import type { Request, Response } from "express";
import { z } from "zod";
import { TZDate } from "@date-fns/tz";
import { db } from "../../../../../db/client";
import { service } from "../../../../../db/schema";
import { generateId } from "../../../../../db/uuid";
import { eq } from "drizzle-orm";
import { getTimezone } from "../../../services/availability";

const Schema = z
  .object({
    name: z.string().min(1).max(255),
    description: z.string().optional(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
    start_time_of_day: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM"),
    duration: z.string().min(1),
    repeat: z.enum(["weekly", "monthly", "yearly"]),
    days_of_week: z.array(z.number().int().min(0).max(6)).optional(),
    end_type: z.enum(["by_date", "by_count"]),
    end_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    end_occurrences: z.number().int().min(1).optional(),
    cost: z.string().optional(),
    cost_type: z.string().optional(),
    capacity: z.number().int().min(1).optional(),
    location_type: z.string().optional(),
    custom_location_text: z.string().optional(),
    staff_role: z.string().max(100).optional(),
    visible: z.boolean().optional(),
  })
  .refine(
    (d) =>
      (d.end_type === "by_date" && Boolean(d.end_date)) ||
      (d.end_type === "by_count" && d.end_occurrences !== undefined),
    { message: "end_date required for by_date, end_occurrences required for by_count" },
  )
  .refine((d) => d.repeat !== "weekly" || (d.days_of_week && d.days_of_week.length > 0), {
    message: "days_of_week required for weekly repeat",
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

    const startHour = parseInt(data.start_time_of_day.split(":")[0] ?? "0");
    const scheduleStartTime = `${data.start_date}T${data.start_time_of_day}:00`;
    const scheduleEndTime =
      data.end_type === "by_date" ? `${data.end_date}T23:59:59` : "2030-12-31T23:59:59";

    const validations: Record<string, unknown> = {
      hour_of_day: [startHour],
    };
    if (data.repeat === "weekly" && data.days_of_week) {
      validations.day_of_week = data.days_of_week;
    }

    const schedule = JSON.stringify({
      start_time: scheduleStartTime,
      end_time: scheduleEndTime,
      rrules: [
        {
          rule_type: data.repeat,
          interval: 1,
          validations,
        },
      ],
    });

    const timezone = await getTimezone();
    const startTime = new Date(new TZDate(scheduleStartTime, timezone).getTime());

    const serviceId = generateId();

    await db.insert(service).values({
      id: serviceId,
      name: data.name,
      slug,
      description: data.description,
      startTime,
      duration: data.duration,
      cost: data.cost,
      costType: data.cost_type,
      capacity: data.capacity ?? 1,
      schedule,
      recurrenceType: "recurring_event",
      recurrenceLimit: data.end_type === "by_count" ? data.end_occurrences : null,
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
    console.error("[POST /api/admin/services/recurring-event]", error);
    return res
      .status(500)
      .json({ error: "Internal Server Error", message: "An unexpected error occurred" });
  }
}
