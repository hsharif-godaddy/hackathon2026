import type { Request, Response } from "express";
import { db } from "../../../../db/client.js";
import { country } from "../../../../db/schema.js";
import { eq } from "drizzle-orm";

export default async function handler(_req: Request, res: Response) {
  try {
    const countries = await db.select().from(country).where(eq(country.enabled, true));

    return res.json({ countries });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
