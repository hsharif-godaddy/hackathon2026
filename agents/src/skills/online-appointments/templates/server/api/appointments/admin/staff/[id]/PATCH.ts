import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../../../../db/client.js";
import { staff, contactDetail } from "../../../../../db/schema.js";
import { and, eq, isNull } from "drizzle-orm";
import { generateId } from "../../../../../db/uuid.js";

const UpdateStaffSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  role: z.string().min(1).max(100).nullable().optional(),
  email: z.string().email().optional(),
  phone_number: z.string().optional(),
});

export default async function handler(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    if (!id) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid staff ID" });
    }

    const parsed = UpdateStaffSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const [existing] = await db
      .select()
      .from(staff)
      .where(and(eq(staff.id, id), isNull(staff.deletedAt)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Not Found", message: "Staff member not found" });
    }

    const data = parsed.data;
    const now = new Date();

    const staffUpdates: Record<string, unknown> = { updatedAt: now };
    if (data.name !== undefined) staffUpdates.name = data.name;
    if (data.role !== undefined) staffUpdates.role = data.role;
    await db.update(staff).set(staffUpdates).where(eq(staff.id, id));

    if (data.email !== undefined || data.phone_number !== undefined) {
      const [existingContact] = await db
        .select()
        .from(contactDetail)
        .where(
          and(
            eq(contactDetail.contactableId, id),
            eq(contactDetail.contactableType, "Staff"),
            isNull(contactDetail.deletedAt),
          ),
        )
        .limit(1);

      if (existingContact) {
        const contactUpdates: Record<string, unknown> = { updatedAt: now };
        if (data.email !== undefined) contactUpdates.email = data.email;
        if (data.phone_number !== undefined) contactUpdates.phoneNumber = data.phone_number;
        await db
          .update(contactDetail)
          .set(contactUpdates)
          .where(eq(contactDetail.id, existingContact.id));
      } else {
        await db.insert(contactDetail).values({
          id: generateId(),
          contactableId: id,
          contactableType: "Staff",
          email: data.email ?? null,
          phoneNumber: data.phone_number ?? null,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    const [updated] = await db.select().from(staff).where(eq(staff.id, id)).limit(1);
    const [contact] = await db
      .select()
      .from(contactDetail)
      .where(
        and(
          eq(contactDetail.contactableId, id),
          eq(contactDetail.contactableType, "Staff"),
          isNull(contactDetail.deletedAt),
        ),
      )
      .limit(1);

    return res.json({
      staff: {
        ...updated,
        contact: contact ? { email: contact.email, phone_number: contact.phoneNumber } : null,
      },
    });
  } catch (_error) {
    return res
      .status(500)
      .json({ error: "Internal Server Error", message: "An unexpected error occurred" });
  }
}
