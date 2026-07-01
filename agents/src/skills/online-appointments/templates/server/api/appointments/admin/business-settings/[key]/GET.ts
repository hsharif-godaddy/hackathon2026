import type { Request, Response } from "express";
import { db } from "../../../../../db/client.js";
import { businessSetting } from "../../../../../db/schema.js";
import { eq } from "drizzle-orm";

export default async function handler(req: Request, res: Response) {
  try {
    const key = req.params.key as string;
    if (!key) {
      return res.status(400).json({ error: "Bad Request", message: "Key is required" });
    }

    const [result] = await db
      .select()
      .from(businessSetting)
      .where(eq(businessSetting.key, key))
      .limit(1);

    if (!result) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.json({ setting: result });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
