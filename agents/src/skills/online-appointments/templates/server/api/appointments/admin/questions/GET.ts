import type { Request, Response } from "express";
import { db } from "../../../../db/client.js";
import { question } from "../../../../db/schema.js";
import { asc, isNull } from "drizzle-orm";

export default async function handler(_req: Request, res: Response) {
  try {
    const questions = await db
      .select()
      .from(question)
      .where(isNull(question.deletedAt))
      .orderBy(asc(question.lft));

    return res.json({ questions });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
