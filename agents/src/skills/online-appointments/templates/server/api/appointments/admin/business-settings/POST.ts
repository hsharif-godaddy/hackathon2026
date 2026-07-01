import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../../../db/client.js";
import { businessSetting } from "../../../../db/schema.js";
import { eq } from "drizzle-orm";

const CreateSettingSchema = z.object({
  key: z.string().min(1).max(255),
  value: z.string(),
});

export default async function handler(req: Request, res: Response) {
  try {
    const parsed = CreateSettingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const { generateId } = await import("../../../../db/uuid");
    const now = new Date();
    const settingId = generateId();

    await db.insert(businessSetting).values({
      id: settingId,
      key: parsed.data.key,
      value: parsed.data.value,
      createdAt: now,
      updatedAt: now,
    });

    const [created] = await db
      .select()
      .from(businessSetting)
      .where(eq(businessSetting.id, settingId))
      .limit(1);

    return res.status(201).json({ setting: created });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
