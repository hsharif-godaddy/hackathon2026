import type { Request, Response } from "express";
import { db } from "../../../../../../db/client.js";
import { state } from "../../../../../../db/schema.js";
import { eq } from "drizzle-orm";

export default async function handler(req: Request, res: Response) {
  try {
    const countryId = parseInt(req.params.id as string);
    if (isNaN(countryId)) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid country ID" });
    }

    const states = await db.select().from(state).where(eq(state.countryId, countryId));

    return res.json({ states });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
