import type { Request, Response } from "express";
import { db } from "../../../../db/client.js";
import { businessSetting } from "../../../../db/schema.js";

export default async function handler(_req: Request, res: Response) {
  try {
    const settings = await db.select().from(businessSetting);
    const config: Record<string, string | null> = {};
    for (const s of settings) {
      if (s.key) config[s.key] = s.value;
    }
    return res.json({ settings: config });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
