import type { Request, Response } from "express";
import { db } from "../../../../../db/client.js";
import { booking } from "../../../../../db/schema.js";
import { and, eq, isNull } from "drizzle-orm";

export default async function handler(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    if (!id) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid booking ID" });
    }

    const extContactId = req.query.ext_contact_id as string;
    if (!extContactId) {
      return res.status(400).json({
        error: "Bad Request",
        message: "ext_contact_id query parameter is required",
      });
    }

    const [result] = await db
      .select()
      .from(booking)
      .where(
        and(eq(booking.id, id), eq(booking.extContactId, extContactId), isNull(booking.deletedAt)),
      )
      .limit(1);

    if (!result) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.json({ booking: result });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
