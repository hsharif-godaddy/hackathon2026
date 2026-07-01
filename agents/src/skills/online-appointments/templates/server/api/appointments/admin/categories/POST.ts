import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../../../db/client.js";
import { category } from "../../../../db/schema.js";
import { eq } from "drizzle-orm";

const CreateCategorySchema = z.object({
  name: z.string().min(1).max(255),
  parent_id: z.string().uuid().optional(),
});

export default async function handler(req: Request, res: Response) {
  try {
    const parsed = CreateCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const { generateId } = await import("../../../../db/uuid");
    const now = new Date();
    const categoryId = generateId();

    await db.insert(category).values({
      id: categoryId,
      name: parsed.data.name,
      parentId: parsed.data.parent_id ?? null,
      lft: 0,
      rgt: 0,
      depth: parsed.data.parent_id ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    });

    const [created] = await db.select().from(category).where(eq(category.id, categoryId)).limit(1);

    return res.status(201).json({ category: created });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
