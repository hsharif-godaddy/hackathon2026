import type { Request, Response } from "express";
import { db } from "../../../../db/client.js";
import { client, contactDetail } from "../../../../db/schema.js";
import { and, count, eq, isNull, like, or } from "drizzle-orm";
import { parsePagination, paginatedResponse } from "../../shared/pagination";

export default async function handler(req: Request, res: Response) {
  try {
    const { page, perPage, offset } = parsePagination(req);
    const search = req.query.search as string | undefined;

    const conditions = [isNull(client.deletedAt)];

    if (search) {
      const searchCondition = or(
        like(client.firstName, `%${search}%`),
        like(client.lastName, `%${search}%`),
      );
      if (searchCondition) conditions.push(searchCondition);
    }

    const whereConditions = and(...conditions);

    const [items, totalResult] = await Promise.all([
      db.select().from(client).where(whereConditions).limit(perPage).offset(offset),
      db.select({ count: count() }).from(client).where(whereConditions),
    ]);

    const clientIds = items.map((c) => c.id);
    let contacts: Array<{
      contactableId: string | null;
      email: string | null;
      phoneNumber: string | null;
    }> = [];
    if (clientIds.length > 0) {
      contacts = await db
        .select({
          contactableId: contactDetail.contactableId,
          email: contactDetail.email,
          phoneNumber: contactDetail.phoneNumber,
        })
        .from(contactDetail)
        .where(and(eq(contactDetail.contactableType, "Client"), isNull(contactDetail.deletedAt)));
    }

    const contactMap = new Map<string, { email: string | null; phone_number: string | null }>();
    for (const c of contacts) {
      if (c.contactableId) {
        contactMap.set(c.contactableId, { email: c.email, phone_number: c.phoneNumber });
      }
    }

    const results = items.map((c) => ({
      ...c,
      contact: contactMap.get(c.id) ?? null,
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
