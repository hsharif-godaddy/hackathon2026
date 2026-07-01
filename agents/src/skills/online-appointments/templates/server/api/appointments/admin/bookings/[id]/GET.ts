import type { Request, Response } from "express";
import { db } from "../../../../../db/client.js";
import { booking, answeredQuestion, serviceSnapshot } from "../../../../../db/schema.js";
import { eq } from "drizzle-orm";

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
      })
      .from(booking)
      .leftJoin(serviceSnapshot, eq(booking.serviceSnapshotId, serviceSnapshot.id))
      .where(eq(booking.id, id))
      .limit(1);

    if (!result) {
      return res.status(404).json({ error: "Not found" });
    }

    const answers = await db
      .select()
      .from(answeredQuestion)
      .where(eq(answeredQuestion.bookingId, id));

    return res.json({
      booking: {
        ...result.booking,
        serviceCost: result.serviceCost,
        answered_questions: answers,
      },
    });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
