import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../../../../../db/client.js";
import { categoryService } from "../../../../../../db/schema.js";
import { and, eq } from "drizzle-orm";

const UpdateServicesPositionSchema = z.object({
  service_positions: z.array(
    z.object({
      service_id: z.string().uuid(),
      lft: z.number().int().min(0),
    }),
  ),
});

export default async function handler(req: Request, res: Response) {
  try {
    const categoryId = req.params.id as string;
    if (!categoryId) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid category ID" });
    }

    const parsed = UpdateServicesPositionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    for (const pos of parsed.data.service_positions) {
      await db
        .update(categoryService)
        .set({ lft: pos.lft })
        .where(
          and(
            eq(categoryService.categoryId, categoryId),
            eq(categoryService.serviceId, pos.service_id),
          ),
        );
    }

    return res.json({ message: "Positions updated" });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
