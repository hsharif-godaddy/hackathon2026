import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../../../db/client";
import { businessSetting } from "../../../../db/schema";
import { eq } from "drizzle-orm";

const TimeBlockSchema = z.object({
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM format"),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM format"),
});

const DaySchema = z.object({
  active: z.boolean(),
  timeBlocks: z.array(TimeBlockSchema),
});

const BusinessHoursSchema = z.object({
  monday: DaySchema,
  tuesday: DaySchema,
  wednesday: DaySchema,
  thursday: DaySchema,
  friday: DaySchema,
  saturday: DaySchema,
  sunday: DaySchema,
});

export default async function handler(req: Request, res: Response) {
  try {
    const parsed = BusinessHoursSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const now = new Date();
    const value = JSON.stringify(parsed.data);

    const [existing] = await db
      .select({ id: businessSetting.id })
      .from(businessSetting)
      .where(eq(businessSetting.key, "business_hours"))
      .limit(1);

    if (existing) {
      await db
        .update(businessSetting)
        .set({ value, updatedAt: now })
        .where(eq(businessSetting.id, existing.id));
    } else {
      const { generateId } = await import("../../../../db/uuid");
      await db.insert(businessSetting).values({
        id: generateId(),
        key: "business_hours",
        value,
        createdAt: now,
        updatedAt: now,
      });
    }

    return res.json({ business_hours: parsed.data });
  } catch {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
