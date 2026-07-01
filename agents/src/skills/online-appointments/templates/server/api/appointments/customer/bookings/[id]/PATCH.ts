import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../../../../db/client.js";
import { booking } from "../../../../../db/schema.js";
import { and, eq, isNull } from "drizzle-orm";

const RescheduleSchema = z.object({
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  ext_contact_id: z.string().min(1),
});

export default async function handler(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
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

    const now = new Date();
    await db
      .update(booking)
      .set({
        startTime: new Date(parsed.data.start_time),
        endTime: new Date(parsed.data.end_time),
        endTimeDisplay: new Date(parsed.data.end_time),
        lastRescheduledAt: now,
        lastRescheduledBy: "consumer",
        updatedAt: now,
      })
      .where(eq(booking.id, id));

    const [updated] = await db.select().from(booking).where(eq(booking.id, id)).limit(1);
    return res.json({ booking: updated });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
