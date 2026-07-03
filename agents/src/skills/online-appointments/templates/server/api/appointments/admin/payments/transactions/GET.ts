import type { Request, Response } from "express";
import { and, count, desc, eq } from "drizzle-orm";
import { db } from "../../../../../db/client";
import { booking, client, serviceSnapshot, transaction } from "../../../../../db/schema";
import { parsePagination, paginatedResponse } from "../../../shared/pagination";

export default async function handler(req: Request, res: Response) {
  try {
    const { page, perPage, offset } = parsePagination(req);

    const conditions = [];

    if (req.query.status) {
      conditions.push(eq(transaction.status, req.query.status as string));
    }
    if (req.query.provider) {
      conditions.push(eq(transaction.provider, req.query.provider as string));
    }

    const whereConditions = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, totalResult] = await Promise.all([
      db
        .select({
          id: transaction.id,
          provider: transaction.provider,
          status: transaction.status,
          amount: transaction.amount,
          currency: transaction.currency,
          transactionId: transaction.transactionId,
          paymentMethod: transaction.paymentMethod,
          createdAt: transaction.createdAt,
          bookingId: transaction.bookingId,
          clientFirstName: client.firstName,
          clientLastName: client.lastName,
          serviceName: serviceSnapshot.name,
        })
        .from(transaction)
        .leftJoin(booking, eq(transaction.bookingId, booking.id))
        .leftJoin(client, and(eq(booking.bookerId, client.id), eq(booking.bookerType, "Client")))
        .leftJoin(serviceSnapshot, eq(booking.serviceSnapshotId, serviceSnapshot.id))
        .where(whereConditions)
        .orderBy(desc(transaction.createdAt))
        .limit(perPage)
        .offset(offset),
      db.select({ count: count() }).from(transaction).where(whereConditions),
    ]);

    const totalCount = totalResult[0]?.count ?? 0;
    return res.json(paginatedResponse(items, totalCount, page, perPage));
  } catch (err) {
    console.error("[Payment API] Operation failed", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
