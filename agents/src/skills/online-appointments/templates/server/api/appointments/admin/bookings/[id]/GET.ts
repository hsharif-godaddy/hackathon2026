import type { Request, Response } from "express";
import { db } from "../../../../../db/client.js";
import {
  booking,
  answeredQuestion,
  serviceSnapshot,
  client,
  contactDetail,
  bookedInstance,
  staff,
  bookingAddon,
} from "../../../../../db/schema.js";
import { and, eq, isNull } from "drizzle-orm";

export default async function handler(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    if (!id) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid booking ID" });
    }

    const [result] = await db
      .select({
        booking,
        serviceCost: serviceSnapshot.cost,
        serviceName: serviceSnapshot.name,
        serviceDuration: serviceSnapshot.duration,
      })
      .from(booking)
      .leftJoin(serviceSnapshot, eq(booking.serviceSnapshotId, serviceSnapshot.id))
      .where(eq(booking.id, id))
      .limit(1);

    if (!result) {
      return res.status(404).json({ error: "Not found" });
    }

    const [answers, clientName, clientEmail, staffName, addons] = await Promise.all([
      db.select().from(answeredQuestion).where(eq(answeredQuestion.bookingId, id)),
      (async (): Promise<string | null> => {
        if (result.booking.bookerType !== "Client" || !result.booking.bookerId) return null;
        const [c] = await db
          .select({ firstName: client.firstName, lastName: client.lastName })
          .from(client)
          .where(eq(client.id, result.booking.bookerId))
          .limit(1);
        if (!c) return null;
        return [c.firstName, c.lastName].filter(Boolean).join(" ") || null;
      })(),
      (async (): Promise<string | null> => {
        if (result.booking.bookerType !== "Client" || !result.booking.bookerId) return null;
        const [cd] = await db
          .select({ email: contactDetail.email })
          .from(contactDetail)
          .where(
            and(
              eq(contactDetail.contactableId, result.booking.bookerId),
              eq(contactDetail.contactableType, "Client"),
              isNull(contactDetail.deletedAt),
            ),
          )
          .limit(1);
        return cd?.email ?? null;
      })(),
      (async (): Promise<string | null> => {
        if (!result.booking.bookedInstanceId) return null;
        const [inst] = await db
          .select({ staffId: bookedInstance.staffId })
          .from(bookedInstance)
          .where(eq(bookedInstance.id, result.booking.bookedInstanceId))
          .limit(1);
        if (!inst?.staffId) return null;
        const [s] = await db
          .select({ name: staff.name })
          .from(staff)
          .where(eq(staff.id, inst.staffId))
          .limit(1);
        return s?.name ?? null;
      })(),
      db
        .select({
          id: bookingAddon.id,
          title: bookingAddon.title,
          price: bookingAddon.price,
          duration: bookingAddon.duration,
        })
        .from(bookingAddon)
        .where(eq(bookingAddon.bookingId, id)),
    ]);

    return res.json({
      booking: {
        ...result.booking,
        serviceCost: result.serviceCost,
        serviceName: result.serviceName,
        serviceDuration: result.serviceDuration,
        clientName,
        clientEmail,
        staffName,
        answered_questions: answers,
        addons,
      },
    });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
