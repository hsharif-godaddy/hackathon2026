import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../../../../db/client.js";
import { category } from "../../../../../db/schema.js";
import { eq } from "drizzle-orm";

const UpdateCategorySchema = z.object({
  name: z.string().min(1).max(255).optional(),
});

export default async function handler(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    if (!id) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid category ID" });
    }

    const parsed = UpdateCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const updateFields: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.name) updateFields.name = parsed.data.name;

    await db.update(category).set(updateFields).where(eq(category.id, id));

    const [updated] = await db.select().from(category).where(eq(category.id, id)).limit(1);
    if (!updated) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.json({ category: updated });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
