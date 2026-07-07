import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../../../../db/client.js";
import { booking, service as serviceTable } from "../../../../../db/schema.js";
import { and, eq, isNull } from "drizzle-orm";
import { addMinutes, isBefore } from "date-fns";
import { TZDate } from "@date-fns/tz";
import {
  getAvailableTimeSlotsForDate,
  getTimezone,
} from "../../../services/availability";
import { parseDurationMinutes } from "../../../services/recurrence";

const RescheduleSchema = z.object({
  start_time: z.string().datetime(),
  ext_contact_id: z.string().min(1),
});

export default async function handler(req: Request, res: Response) {
  try {
    const id: string = req.params.id as string;
    if (!id) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid booking ID" });
    }

    const parsed = RescheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const [existing] = await db
      .select()
      .from(booking)
      .where(
        and(
          eq(booking.id, id),
          eq(booking.extContactId, parsed.data.ext_contact_id),
          isNull(booking.deletedAt),
        ),
      )
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Not found" });
    }

    if (existing.status === "cancelled" || existing.status === "completed") {
      return res.status(409).json({
        error: "Conflict",
        message: `Cannot reschedule a ${existing.status} booking`,
      });
    }

    const serviceId: string | null = existing.bookableId;
    if (!serviceId) {
      return res.status(422).json({
        error: "Unprocessable",
        message: "Booking has no associated service",
      });
    }

    const [svc] = await db
      .select({
        c2CanReschedule: serviceTable.c2CanReschedule,
        bookLeadTime: serviceTable.bookLeadTime,
        duration: serviceTable.duration,
      })
      .from(serviceTable)
      .where(eq(serviceTable.id, serviceId))
      .limit(1);

    if (!svc) {
      return res.status(422).json({
        error: "Unprocessable",
        message: "Associated service not found",
      });
    }

    if (!svc.c2CanReschedule) {
      return res.status(403).json({
        error: "Forbidden",
        message: "Rescheduling is not allowed for this service",
      });
    }

    const timezone: string = await getTimezone();
    const newStart: Date = new Date(parsed.data.start_time);
    const now: Date = new Date();

    if (isBefore(newStart, now)) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Cannot reschedule to a past time",
      });
    }

    const leadMinutes: number = parseDurationMinutes(svc.bookLeadTime);
    const leadCutoff: Date = addMinutes(now, leadMinutes);
    if (isBefore(newStart, leadCutoff)) {
      return res.status(400).json({
        error: "Bad Request",
        message: `Must reschedule at least ${leadMinutes} minutes in advance`,
      });
    }

    const tzStart: TZDate = new TZDate(newStart, timezone);
    const dateStr: string = `${tzStart.getFullYear()}-${String(tzStart.getMonth() + 1).padStart(2, "0")}-${String(tzStart.getDate()).padStart(2, "0")}`;

    const slots = await getAvailableTimeSlotsForDate(serviceId, dateStr, existing.quantity ?? 1, {
      ignoredBookingId: existing.bookedInstanceId ?? undefined,
    });

    const requestedSlot = slots.find(
      (s) => s.start_time === newStart.toISOString() && s.available,
    );

    if (!requestedSlot) {
      return res.status(409).json({
        error: "Conflict",
        message: "Requested time slot is not available",
      });
    }

    const durationMinutes: number = parseDurationMinutes(svc.duration ?? "PT60M");
    const newEnd: Date = addMinutes(newStart, durationMinutes);

    await db
      .update(booking)
      .set({
        startTime: newStart,
        endTime: newEnd,
        endTimeDisplay: newEnd,
        lastRescheduledAt: now,
        lastRescheduledBy: "consumer",
        updatedAt: now,
      })
      .where(eq(booking.id, id));

    const [updated] = await db.select().from(booking).where(eq(booking.id, id)).limit(1);
    return res.json({ booking: updated });
  } catch (error) {
    console.error("booking.customer_reschedule.failed", {
      bookingId: req.params.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
