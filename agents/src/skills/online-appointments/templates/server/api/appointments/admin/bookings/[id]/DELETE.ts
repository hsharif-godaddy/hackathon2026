import type { Request, Response } from "express";
import { db } from "../../../../../db/client";
import {
  booking,
  reminder,
  contactDetail,
  service as serviceTable,
} from "../../../../../db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { sendBookingCancellation } from "../../../services/email-notifications";

export default async function handler(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    if (!id) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid booking ID" });
    }

    // Fetch booking before delete for email notification
    const [existing] = await db.select().from(booking).where(eq(booking.id, id)).limit(1);

    await db
      .update(booking)
      .set({ deletedAt: new Date(), status: "cancelled", updatedAt: new Date() })
      .where(eq(booking.id, id));

    // Cancel pending reminder
    await db
      .update(reminder)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(reminder.bookingId, id), eq(reminder.status, "pending")));

    // Fire-and-forget cancellation email
    if (existing?.bookerId && existing.bookableId) {
      const bookerId = existing.bookerId;
      const bookableId = existing.bookableId;
      void (async () => {
        try {
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
          if (!contact?.email) return;

          const [svc] = await db
            .select({
              name: serviceTable.name,
              duration: serviceTable.duration,
              locationType: serviceTable.locationType,
              customLocationText: serviceTable.customLocationText,
            })
            .from(serviceTable)
            .where(eq(serviceTable.id, bookableId))
            .limit(1);
          if (!svc) return;

          await sendBookingCancellation(
            {
              id,
              start_time: existing.startTime?.toISOString() ?? "",
              end_time: existing.endTime?.toISOString() ?? "",
              service_id: bookableId,
            },
            svc,
            { first_name: "Customer", last_name: "", email: contact.email },
          );
        } catch (err) {
          console.error("email.booking_delete.notification_failed", {
            bookingId: id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    }

    return res.status(204).send();
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
