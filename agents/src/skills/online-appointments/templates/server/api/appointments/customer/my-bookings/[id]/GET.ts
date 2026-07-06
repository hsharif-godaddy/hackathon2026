import type { Request, Response } from "express";
import { db } from "../../../../../db/client.js";
import {
  booking,
  serviceSnapshot,
  answeredQuestion,
  question,
  bookingAddon,
} from "../../../../../db/schema.js";
import { and, eq, isNull } from "drizzle-orm";

export default async function handler(req: Request, res: Response) {
  const bookingId = req.params.id as string;
  const clientId = req.query.client_id as string;

  if (!bookingId || !clientId) {
    return res.status(400).json({ error: "id and client_id are required" });
  }

  try {
    const [found] = await db
      .select()
      .from(booking)
      .where(
        and(
          eq(booking.id, bookingId),
          eq(booking.bookerId, clientId),
          eq(booking.bookerType, "Client"),
          isNull(booking.deletedAt),
        ),
      )
      .limit(1);

    if (!found) {
      return res.status(404).json({ error: "Booking not found" });
    }

    let snapshot = null;
    if (found.serviceSnapshotId) {
      const [s] = await db
        .select()
        .from(serviceSnapshot)
        .where(eq(serviceSnapshot.id, found.serviceSnapshotId))
        .limit(1);
      snapshot = s ?? null;
    }

    const [answers, addons] = await Promise.all([
      db
        .select({
          id: answeredQuestion.id,
          body: answeredQuestion.body,
          questionId: answeredQuestion.questionId,
          questionBody: question.body,
        })
        .from(answeredQuestion)
        .leftJoin(question, eq(answeredQuestion.questionId, question.id))
        .where(eq(answeredQuestion.bookingId, bookingId)),
      db
        .select({
          id: bookingAddon.id,
          title: bookingAddon.title,
          price: bookingAddon.price,
          duration: bookingAddon.duration,
        })
        .from(bookingAddon)
        .where(eq(bookingAddon.bookingId, bookingId)),
    ]);

    return res.json({ ...found, service: snapshot, answers, addons });
  } catch (error) {
    console.error("api.customer.my_booking_detail.error", {
      bookingId: req.params.id,
      clientId: req.query.client_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
