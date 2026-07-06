import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../../../../db/client.js";
import { booking } from "../../../../../db/schema.js";
import { eq } from "drizzle-orm";

const ResendSchema = z.object({
  booking_id: z.string().uuid(),
});

export default async function handler(req: Request, res: Response) {
  try {
    const parsed = ResendSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const [bk] = await db
      .select()
      .from(booking)
      .where(eq(booking.id, parsed.data.booking_id))
      .limit(1);

    if (!bk) {
      return res.status(404).json({ error: "Not found" });
    }

    // TODO: wire to the email service to actually send the confirmation email
    return res.status(501).json({
      error: "Not implemented",
      message: "Email resend is not yet configured for this app.",
    });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
