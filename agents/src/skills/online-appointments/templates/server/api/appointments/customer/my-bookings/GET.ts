import type { Request, Response } from "express";
import { db } from "../../../../db/client.js";
import { booking, serviceSnapshot } from "../../../../db/schema.js";
import { and, count, eq, gte, isNull, lt, ne } from "drizzle-orm";
import { parsePagination, paginatedResponse } from "../../shared/pagination";
import { ownsClient } from "../../shared/auth.js";

export default async function handler(req: Request, res: Response) {
  const clientId = req.query.client_id as string;
  if (!clientId) {
    return res.status(400).json({ error: "client_id query parameter is required" });
  }
  if (!ownsClient(req, clientId)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const tab = typeof req.query.tab === "string" ? req.query.tab : "upcoming";
  const { page, perPage, offset } = parsePagination(req);
  const now = new Date();

  const baseConditions = and(
    eq(booking.bookerId, clientId),
    eq(booking.bookerType, "Client"),
    isNull(booking.deletedAt),
  );

  const tabCondition =
    tab === "past"
      ? and(baseConditions, lt(booking.startTime, now))
      : and(baseConditions, gte(booking.startTime, now), ne(booking.status, "cancelled"));

  try {
    const [items, totalResult] = await Promise.all([
      db
        .select({
          id: booking.id,
          status: booking.status,
          startTime: booking.startTime,
          endTime: booking.endTimeDisplay,
          quantity: booking.quantity,
          serviceSnapshotId: booking.serviceSnapshotId,
        })
        .from(booking)
        .where(tabCondition)
        .orderBy(booking.startTime)
        .limit(perPage)
        .offset(offset),
      db.select({ count: count() }).from(booking).where(tabCondition),
    ]);

    const snapshotIds = items.map((b) => b.serviceSnapshotId).filter(Boolean) as string[];
    let snapshots: Array<{
      id: string;
      name: string | null;
      cost: string | null;
      duration: string | null;
    }> = [];
    if (snapshotIds.length > 0) {
      const firstSnapshotId = snapshotIds[0];
      if (!firstSnapshotId) throw new Error("unexpected empty snapshotIds");
      snapshots = await db
        .select({
          id: serviceSnapshot.id,
          name: serviceSnapshot.name,
          cost: serviceSnapshot.cost,
          duration: serviceSnapshot.duration,
        })
        .from(serviceSnapshot)
        .where(eq(serviceSnapshot.id, firstSnapshotId));

      if (snapshotIds.length > 1) {
        const rest = await Promise.all(
          snapshotIds.slice(1).map((sid) =>
            db
              .select({
                id: serviceSnapshot.id,
                name: serviceSnapshot.name,
                cost: serviceSnapshot.cost,
                duration: serviceSnapshot.duration,
              })
              .from(serviceSnapshot)
              .where(eq(serviceSnapshot.id, sid))
              .limit(1),
          ),
        );
        snapshots.push(...rest.flat());
      }
    }

    const snapshotMap = new Map(snapshots.map((s) => [s.id, s]));
    const results = items.map((b) => ({
      ...b,
      service: b.serviceSnapshotId ? (snapshotMap.get(b.serviceSnapshotId) ?? null) : null,
    }));

    const totalCount = totalResult[0]?.count ?? 0;
    return res.json(paginatedResponse(results, totalCount, page, perPage));
  } catch (_error) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
