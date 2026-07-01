import type { Request, Response } from "express";
import { db } from "../../../../../db/client.js";
import { question } from "../../../../../db/schema.js";
import { eq } from "drizzle-orm";

export default async function handler(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    if (!id) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid question ID" });
    }

    await db
      .update(question)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(question.id, id));

    return res.status(204).send();
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
