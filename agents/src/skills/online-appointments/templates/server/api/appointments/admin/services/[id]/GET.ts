import type { Request, Response } from "express";
import { db } from "../../../../../db/client.js";
import { service, serviceStaff, staff, staffSetting } from "../../../../../db/schema.js";
import { eq, and, isNull } from "drizzle-orm";

export default async function handler(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    if (!id) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid service ID" });
    }

    const [result] = await db.select().from(service).where(eq(service.id, id)).limit(1);

    if (!result) {
      return res.status(404).json({ error: "Not found" });
    }

    let staffData: { id: string; role: string; name?: string } | null = null;
    const [ss] = await db
      .select({ staffId: serviceStaff.staffId })
      .from(serviceStaff)
      .where(eq(serviceStaff.serviceId, id))
      .limit(1);

    if (ss) {
      const [staff_row] = await db.select().from(staff).where(eq(staff.id, ss.staffId)).limit(1);

      if (staff_row) {
        const settings = await db
          .select({ key: staffSetting.key, value: staffSetting.value })
          .from(staffSetting)
          .where(and(eq(staffSetting.staffId, staff_row.id), isNull(staffSetting.deletedAt)));

        const nameSetting = settings.find((s) => s.key === "name");
        staffData = {
          id: staff_row.id,
          role: staff_row.role,
          name: nameSetting?.value ?? undefined,
        };
      }
    }

    return res.json({ service: result, staff: staffData });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
