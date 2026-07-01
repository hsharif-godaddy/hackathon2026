import type { Request, Response } from "express";
import { db } from "../../../../../../db/client.js";
import { service, categoryService } from "../../../../../../db/schema.js";
import { and, eq, isNull } from "drizzle-orm";

export default async function handler(req: Request, res: Response) {
  try {
    const categoryId = req.params.id as string;
    if (!categoryId) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid category ID" });
    }

    const services = await db
      .select({
        id: service.id,
        name: service.name,
        slug: service.slug,
        description: service.description,
        locationType: service.locationType,
        costType: service.costType,
        cost: service.cost,
        salesPrice: service.salesPrice,
        duration: service.duration,
        capacity: service.capacity,
        imageUrl: service.imageUrl,
        visible: service.visible,
      })
      .from(categoryService)
      .innerJoin(service, eq(categoryService.serviceId, service.id))
      .where(
        and(
          eq(categoryService.categoryId, categoryId),
          isNull(service.deletedAt),
          eq(service.visible, true),
        ),
      )
      .orderBy(categoryService.lft);

    return res.json({ services });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
