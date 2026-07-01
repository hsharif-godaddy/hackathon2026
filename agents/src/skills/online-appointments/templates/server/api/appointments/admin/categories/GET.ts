import type { Request, Response } from "express";
import { db } from "../../../../db/client.js";
import { category } from "../../../../db/schema.js";
import { asc } from "drizzle-orm";

export default async function handler(_req: Request, res: Response) {
  try {
    const categories = await db.select().from(category).orderBy(asc(category.lft));
    return res.json({ categories });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
