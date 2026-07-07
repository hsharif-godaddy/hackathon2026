import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../../../../db/client.js";
import { businessSetting } from "../../../../../db/schema.js";
import { eq } from "drizzle-orm";

const UpdateSettingSchema = z.object({
  value: z.string().max(10000),
});

export default async function handler(req: Request, res: Response) {
  try {
    const key = req.params.key as string;
    if (!key) {
      return res.status(400).json({ error: "Bad Request", message: "Key is required" });
    }

    const parsed = UpdateSettingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    await db
      .update(businessSetting)
      .set({ value: parsed.data.value, updatedAt: new Date() })
      .where(eq(businessSetting.key, key));

    const [updated] = await db
      .select()
      .from(businessSetting)
      .where(eq(businessSetting.key, key))
      .limit(1);

    if (!updated) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.json({ setting: updated });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
