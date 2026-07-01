import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../../../../../db/client.js";
import { category } from "../../../../../../db/schema.js";
import { eq } from "drizzle-orm";

const UpdatePositionSchema = z.object({
  lft: z.number().int().min(0),
  rgt: z.number().int().min(0),
  depth: z.number().int().min(0),
  parent_id: z.string().uuid().nullable().optional(),
});

export default async function handler(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    if (!id) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid category ID" });
    }

    const parsed = UpdatePositionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    await db
      .update(category)
      .set({
        lft: parsed.data.lft,
        rgt: parsed.data.rgt,
        depth: parsed.data.depth,
        parentId: parsed.data.parent_id ?? null,
        updatedAt: new Date(),
      })
      .where(eq(category.id, id));

    const [updated] = await db.select().from(category).where(eq(category.id, id)).limit(1);
    return res.json({ category: updated });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
