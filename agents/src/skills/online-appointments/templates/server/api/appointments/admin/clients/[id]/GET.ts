import type { Request, Response } from "express";
import { db } from "../../../../../db/client.js";
import { client, contactDetail } from "../../../../../db/schema.js";
import { and, eq, isNull } from "drizzle-orm";

export default async function handler(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    if (!id) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid client ID" });
    }

    const [result] = await db.select().from(client).where(eq(client.id, id)).limit(1);
    if (!result) {
      return res.status(404).json({ error: "Not found" });
    }

    const [contact] = await db
      .select()
      .from(contactDetail)
      .where(
        and(
          eq(contactDetail.contactableId, id),
          eq(contactDetail.contactableType, "Client"),
          isNull(contactDetail.deletedAt),
        ),
      )
      .limit(1);

    return res.json({ client: { ...result, contact: contact ?? null } });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
