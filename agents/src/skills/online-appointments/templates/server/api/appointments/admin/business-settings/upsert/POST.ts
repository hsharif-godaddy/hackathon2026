import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../../../../db/client.js";
import { businessSetting } from "../../../../../db/schema.js";
import { eq } from "drizzle-orm";

const UpsertSettingSchema = z.object({
  key: z.string().min(1).max(255),
  value: z.string().max(10000),
});

export default async function handler(req: Request, res: Response) {
  try {
    const parsed = UpsertSettingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const now = new Date();
    const [existing] = await db
      .select()
      .from(businessSetting)
      .where(eq(businessSetting.key, parsed.data.key))
      .limit(1);

    if (existing) {
      await db
        .update(businessSetting)
        .set({ value: parsed.data.value, updatedAt: now })
        .where(eq(businessSetting.key, parsed.data.key));
    } else {
      await db.insert(businessSetting).values({
        key: parsed.data.key,
        value: parsed.data.value,
        createdAt: now,
        updatedAt: now,
      });
    }

    const [result] = await db
      .select()
      .from(businessSetting)
      .where(eq(businessSetting.key, parsed.data.key))
      .limit(1);

    return res.json({ setting: result });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
