import type { Request, Response } from "express";
import { db } from "../../../../../../db/client.js";
import { service as serviceTable, staff } from "../../../../../../db/schema.js";
import { and, eq, isNull } from "drizzle-orm";

export default async function handler(req: Request, res: Response) {
  try {
    const serviceId = req.params.id as string;

    const [svc] = await db
      .select({ staffRole: serviceTable.staffRole })
      .from(serviceTable)
      .where(and(eq(serviceTable.id, serviceId), isNull(serviceTable.deletedAt)))
      .limit(1);

    if (!svc) {
      return res.status(404).json({ error: "Not Found", message: "Service not found" });
    }

    const conditions = [isNull(staff.deletedAt)];
    if (svc.staffRole) {
      conditions.push(eq(staff.role, svc.staffRole));
    }

    const members = await db
      .select({ id: staff.id, name: staff.name, role: staff.role })
      .from(staff)
      .where(and(...conditions));

    return res.json({ staff: members, staffRole: svc.staffRole ?? null });
  } catch (_error) {
    return res
      .status(500)
      .json({ error: "Internal Server Error", message: "An unexpected error occurred" });
  }
}
