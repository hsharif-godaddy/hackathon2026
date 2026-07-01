import type { Request, Response } from "express";
import { db } from "../../../../db/client.js";
import { service, serviceStaff, staff, staffSetting } from "../../../../db/schema.js";
import { count, isNull, and, inArray } from "drizzle-orm";
import { parsePagination, paginatedResponse } from "../../shared/pagination";

export default async function handler(req: Request, res: Response) {
  try {
    const { page, perPage, offset } = parsePagination(req);
    const includeDeleted = req.query.include_deleted === "true";

    const whereConditions = includeDeleted ? undefined : isNull(service.deletedAt);

    const [items, totalResult] = await Promise.all([
      db.select().from(service).where(whereConditions).limit(perPage).offset(offset),
      db.select({ count: count() }).from(service).where(whereConditions),
    ]);

    const serviceIds = items.map((s) => s.id);
    const staffMap: Record<string, { id: string; role: string; name?: string }> = {};

    if (serviceIds.length > 0) {
      const ssRows = await db
        .select({ serviceId: serviceStaff.serviceId, staffId: serviceStaff.staffId })
        .from(serviceStaff)
        .where(inArray(serviceStaff.serviceId, serviceIds));

      if (ssRows.length > 0) {
        const staffIds = [...new Set(ssRows.map((r) => r.staffId))];
        const staffMembers = await db.select().from(staff).where(inArray(staff.id, staffIds));
        const settings = await db
          .select({
            staffId: staffSetting.staffId,
            key: staffSetting.key,
            value: staffSetting.value,
          })
          .from(staffSetting)
          .where(and(inArray(staffSetting.staffId, staffIds), isNull(staffSetting.deletedAt)));

        const staffLookup = new Map(staffMembers.map((s) => [s.id, s]));
        const nameLookup = new Map(
          settings.filter((s) => s.key === "name").map((s) => [s.staffId, s.value]),
        );

        for (const ss of ssRows) {
          const s = staffLookup.get(ss.staffId);
          if (s) {
            staffMap[ss.serviceId] = {
              id: s.id,
              role: s.role,
              name: nameLookup.get(s.id) ?? undefined,
            };
          }
        }
      }
    }

    const itemsWithStaff = items.map((s) => ({
      ...s,
      staff: staffMap[s.id] ?? null,
    }));

    const totalCount = totalResult[0]?.count ?? 0;
    return res.json(paginatedResponse(itemsWithStaff, totalCount, page, perPage));
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
