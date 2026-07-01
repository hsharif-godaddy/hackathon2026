import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../../../db/client.js";
import { staff, contactDetail } from "../../../../db/schema.js";
import { eq } from "drizzle-orm";

const CreateStaffSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  phone_number: z.string().optional(),
  role: z.string().min(1).max(100).optional(),
});

export default async function handler(req: Request, res: Response) {
  try {
    const parsed = CreateStaffSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const data = parsed.data;
    const now = new Date();

    const { generateId } = await import("../../../../db/uuid");
    const staffId = generateId();

    await db.transaction(async (tx) => {
      await tx.insert(staff).values({
        id: staffId,
        name: data.name,
        role: data.role ?? "generic",
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(contactDetail).values({
        id: generateId(),
        contactableId: staffId,
        contactableType: "Staff",
        email: data.email,
        phoneNumber: data.phone_number ?? null,
        createdAt: now,
        updatedAt: now,
      });
    });

    const [created] = await db.select().from(staff).where(eq(staff.id, staffId)).limit(1);

    return res.status(201).json({
      staff: {
        ...created,
        contact: { email: data.email, phone_number: data.phone_number ?? null },
      },
    });
  } catch (error) {
    const cause =
      error instanceof Error
        ? ((error as Error & { cause?: unknown }).cause ?? error.message)
        : error;
    console.error("[staff POST]", cause);
    return res.status(500).json({
      error: "Internal Server Error",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
