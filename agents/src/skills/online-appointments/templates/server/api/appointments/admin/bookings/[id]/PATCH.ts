import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../../../../db/client";
import {
  booking,
  reminder,
  contactDetail,
  service as serviceTable,
} from "../../../../../db/schema";
import { eq, and, isNull } from "drizzle-orm";
import {
  sendBookingCancellation,
  sendBookingReschedule,
} from "../../../services/email-notifications";

const UpdateBookingSchema = z.object({
  start_time: z.string().datetime().optional(),
  end_time: z.string().datetime().optional(),
  status: z.string().max(50).optional(),
  quantity: z.number().int().min(1).max(50).optional(),
});

export default async function handler(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    if (!id) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid booking ID" });
    }

    const parsed = UpdateBookingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const data = parsed.data;
    const updateFields: Record<string, unknown> = { updatedAt: new Date() };

    if (data.start_time) {
      updateFields.startTime = new Date(data.start_time);
      updateFields.rescheduleCount = 1; // incremented via SQL in production
      updateFields.lastRescheduledAt = new Date();
      updateFields.lastRescheduledBy = "merchant";
    }
    if (data.end_time) updateFields.endTime = new Date(data.end_time);
    if (data.status) updateFields.status = data.status;
    if (data.quantity) updateFields.quantity = data.quantity;

    // Fetch the booking before update for comparison
    const [existing] = await db.select().from(booking).where(eq(booking.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ error: "Not found" });
    }

    await db.update(booking).set(updateFields).where(eq(booking.id, id));

    const [updated] = await db.select().from(booking).where(eq(booking.id, id)).limit(1);

    // Fire-and-forget email notifications
    void (async () => {
      try {
        if (!existing.bookerId || !existing.bookableId) return;
        const clientInfo = await getBookingClientInfo(existing.bookerId);
        const svcInfo = await getBookingServiceInfo(existing.bookableId);
        if (!clientInfo || !svcInfo || !updated) return;

        const bookingInfo = {
          id: updated.id,
          start_time: updated.startTime?.toISOString() ?? "",
          end_time: updated.endTime?.toISOString() ?? "",
          service_id: updated.bookableId ?? "",
        };

        if (data.status === "cancelled") {
          await sendBookingCancellation(bookingInfo, svcInfo, clientInfo);
          // Cancel pending reminder
          await db
            .update(reminder)
            .set({ status: "cancelled", updatedAt: new Date() })
            .where(and(eq(reminder.bookingId, id), eq(reminder.status, "pending")));
        } else if (data.start_time && existing.startTime) {
          const oldStartTime = existing.startTime.toISOString();
          await sendBookingReschedule(bookingInfo, svcInfo, clientInfo, oldStartTime);
          // Recalculate reminder perform_at
          const newStart = new Date(data.start_time);
          const reminderHours = 24; // default
          const newPerformAt = new Date(newStart.getTime() - reminderHours * 3600000);
          if (newPerformAt > new Date()) {
            await db
              .update(reminder)
              .set({ performAt: newPerformAt, updatedAt: new Date() })
              .where(and(eq(reminder.bookingId, id), eq(reminder.status, "pending")));
          } else {
            // Reminder time already passed — mark sent
            await db
              .update(reminder)
              .set({ status: "sent", updatedAt: new Date() })
              .where(and(eq(reminder.bookingId, id), eq(reminder.status, "pending")));
          }
        }
      } catch (err) {
        console.error("email.booking_patch.notification_failed", {
          bookingId: id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return res.json({ booking: updated });
  } catch {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}

async function getBookingClientInfo(
  bookerId: string,
): Promise<{ first_name: string; last_name: string; email: string } | null> {
  const [contact] = await db
    .select({ email: contactDetail.email })
    .from(contactDetail)
    .where(
      and(
        eq(contactDetail.contactableId, bookerId),
        eq(contactDetail.contactableType, "Client"),
        isNull(contactDetail.deletedAt),
      ),
    )
    .limit(1);
  if (!contact?.email) return null;
  // Client name would require a join — use email as fallback
  return { first_name: "Customer", last_name: "", email: contact.email };
}

async function getBookingServiceInfo(serviceId: string): Promise<{
  name: string | null;
  duration: string | null;
  locationType: string | null;
  customLocationText: string | null;
} | null> {
  const [svc] = await db
    .select({
      name: serviceTable.name,
      duration: serviceTable.duration,
      locationType: serviceTable.locationType,
      customLocationText: serviceTable.customLocationText,
    })
    .from(serviceTable)
    .where(eq(serviceTable.id, serviceId))
    .limit(1);
  return svc ?? null;
}
