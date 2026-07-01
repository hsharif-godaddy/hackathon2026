import type { Request, Response } from "express";
import { db } from "../../../../../../db/client.js";
import { service } from "../../../../../../db/schema.js";
import { and, eq, isNull } from "drizzle-orm";

export default async function handler(req: Request, res: Response) {
  try {
    const slug = req.params.slug as string;
    if (!slug) {
      return res.status(400).json({ error: "Bad Request", message: "Slug is required" });
    }

    const [result] = await db
      .select()
      .from(service)
      .where(and(eq(service.slug, slug), isNull(service.deletedAt), eq(service.visible, true)))
      .limit(1);

    if (!result) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.json({ service: result });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
