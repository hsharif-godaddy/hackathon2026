import type { Request, Response } from "express";
import { db } from "../../../../../db/client.js";
import { category } from "../../../../../db/schema.js";
import { eq } from "drizzle-orm";

export default async function handler(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    if (!id) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid category ID" });
    }

    const [result] = await db.select().from(category).where(eq(category.id, id)).limit(1);
    if (!result) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.json({ category: result });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
