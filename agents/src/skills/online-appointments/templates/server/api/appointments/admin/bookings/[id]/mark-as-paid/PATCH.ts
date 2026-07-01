import type { Request, Response } from "express";
import { db } from "../../../../../../db/client.js";
import { booking } from "../../../../../../db/schema.js";
import { eq } from "drizzle-orm";

export default async function handler(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    if (!id) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid booking ID" });
    }

    const now = new Date();
    await db
      .update(booking)
      .set({ status: "paid", paidDate: now, updatedAt: now })
      .where(eq(booking.id, id));

    const [updated] = await db.select().from(booking).where(eq(booking.id, id)).limit(1);
    if (!updated) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.json({ booking: updated });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
