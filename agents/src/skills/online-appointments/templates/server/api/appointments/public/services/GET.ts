import type { Request, Response } from "express";
import { db } from "../../../../db/client.js";
import { service, categoryService, category } from "../../../../db/schema.js";
import { and, count, eq, isNull } from "drizzle-orm";
import { parsePagination, paginatedResponse } from "../../shared/pagination";

export default async function handler(req: Request, res: Response) {
  try {
    const { page, perPage, offset } = parsePagination(req);

    const whereConditions = and(isNull(service.deletedAt), eq(service.visible, true));

    const [items, totalResult] = await Promise.all([
      db.select().from(service).where(whereConditions).limit(perPage).offset(offset),
      db.select({ count: count() }).from(service).where(whereConditions),
    ]);

    const totalCount = totalResult[0]?.count ?? 0;

    const serviceIds = items.map((s: (typeof items)[number]) => s.id);
    const categories: Record<string, Array<{ id: string; name: string | null }>> = {};

    if (serviceIds.length > 0) {
      const firstServiceId = serviceIds[0];
      const categoryRows = await db
        .select({
          serviceId: categoryService.serviceId,
          categoryId: category.id,
          categoryName: category.name,
        })
        .from(categoryService)
        .innerJoin(category, eq(categoryService.categoryId, category.id))
        .where(
          serviceIds.length === 1 && firstServiceId !== undefined
            ? eq(categoryService.serviceId, firstServiceId)
            : undefined,
        );

      for (const row of categoryRows) {
        if (row.serviceId === null) continue;
        (categories[row.serviceId] ??= []).push({
          id: row.categoryId,
          name: row.categoryName,
        });
      }
    }

    const results = items.map((s: (typeof items)[number]) => ({
      ...s,
      categories: categories[s.id] ?? [],
    }));

    return res.json(paginatedResponse(results, totalCount, page, perPage));
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
