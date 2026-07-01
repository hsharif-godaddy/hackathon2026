import type { Request, Response } from "express";
import { db } from "../../../../db/client.js";
import {
  booking,
  serviceSnapshot,
  contactDetail,
  bookedInstance,
  staff,
} from "../../../../db/schema.js";
import { and, count, gte, lte, eq, isNull, inArray } from "drizzle-orm";
import { parsePagination, paginatedResponse } from "../../shared/pagination";

export default async function handler(req: Request, res: Response) {
  try {
    const { page, perPage, offset } = parsePagination(req);

    const conditions = [isNull(booking.deletedAt)];

    if (req.query.start_date) {
      conditions.push(gte(booking.startTime, new Date(req.query.start_date as string)));
    }
    if (req.query.end_date) {
      conditions.push(lte(booking.startTime, new Date(req.query.end_date as string)));
    }
    if (req.query.status) {
      conditions.push(eq(booking.status, req.query.status as string));
    }
    if (req.query.service_id) {
      conditions.push(eq(booking.bookableId, req.query.service_id as string));
      conditions.push(eq(booking.bookableType, "Service"));
    }

    const whereConditions = and(...conditions);

    const [items, totalResult] = await Promise.all([
      db
        .select({
          id: booking.id,
          status: booking.status,
          startTime: booking.startTime,
          endTime: booking.endTimeDisplay,
          quantity: booking.quantity,
          bookerId: booking.bookerId,
          bookerType: booking.bookerType,
          serviceSnapshotId: booking.serviceSnapshotId,
          bookableId: booking.bookableId,
          createdAt: booking.createdAt,
          serviceName: serviceSnapshot.name,
          serviceCost: serviceSnapshot.cost,
          bookedInstanceId: booking.bookedInstanceId,
        })
        .from(booking)
        .leftJoin(serviceSnapshot, eq(booking.serviceSnapshotId, serviceSnapshot.id))
        .where(whereConditions)
        .limit(perPage)
        .offset(offset)
        .orderBy(booking.startTime),
      db.select({ count: count() }).from(booking).where(whereConditions),
    ]);

    // Fetch client emails for booker IDs
    const clientIds = [
      ...new Set(
        items
          .filter((b) => b.bookerType === "Client" && b.bookerId)
          .map((b) => b.bookerId as string),
      ),
    ];
    const contacts =
      clientIds.length > 0
        ? await db
            .select({ contactableId: contactDetail.contactableId, email: contactDetail.email })
            .from(contactDetail)
            .where(
              and(eq(contactDetail.contactableType, "Client"), isNull(contactDetail.deletedAt)),
            )
        : [];
    const contactMap = new Map(contacts.map((c) => [c.contactableId, c.email]));

    // Resolve staff names via booked_instance → staff
    const instanceIds = [
      ...new Set(items.map((b) => b.bookedInstanceId).filter(Boolean)),
    ] as string[];
    const staffNameMap = new Map<string, string | null>();
    if (instanceIds.length > 0) {
      const instances = await db
        .select({ id: bookedInstance.id, staffId: bookedInstance.staffId })
        .from(bookedInstance)
        .where(inArray(bookedInstance.id, instanceIds));
      const staffIds = [
        ...new Set(instances.map((i) => i.staffId).filter((id): id is string => id !== null)),
      ];
      const staffMembers =
        staffIds.length > 0
          ? await db
              .select({ id: staff.id, name: staff.name })
              .from(staff)
              .where(inArray(staff.id, staffIds))
          : [];
      const staffById = new Map(staffMembers.map((s) => [s.id, s.name]));
      for (const inst of instances) {
        staffNameMap.set(inst.id, inst.staffId ? (staffById.get(inst.staffId) ?? null) : null);
      }
    }

    const results = items.map((b) => ({
      ...b,
      clientEmail:
        b.bookerType === "Client" && b.bookerId ? (contactMap.get(b.bookerId) ?? null) : null,
      staffName: b.bookedInstanceId ? (staffNameMap.get(b.bookedInstanceId) ?? null) : null,
    }));

    const totalCount = totalResult[0]?.count ?? 0;
    return res.json(paginatedResponse(results, totalCount, page, perPage));
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
