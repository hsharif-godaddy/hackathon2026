import type { Request, Response } from "express";
import { db } from "../../../../../db/client.js";
import { staff } from "../../../../../db/schema.js";
import { and, eq, isNull } from "drizzle-orm";

export default async function handler(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    if (!id) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid staff ID" });
    }

    const [existing] = await db
      .select()
      .from(staff)
      .where(and(eq(staff.id, id), isNull(staff.deletedAt)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Not Found", message: "Staff member not found" });
    }

    await db.update(staff).set({ deletedAt: new Date() }).where(eq(staff.id, id));

    return res.status(204).send();
  } catch (_error) {
    return res
      .status(500)
      .json({ error: "Internal Server Error", message: "An unexpected error occurred" });
  }
}
