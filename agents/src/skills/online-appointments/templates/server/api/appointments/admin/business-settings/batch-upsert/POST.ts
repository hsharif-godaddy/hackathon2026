import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../../../../db/client.js";
import { businessSetting } from "../../../../../db/schema.js";
import { eq } from "drizzle-orm";

const ArraySchema = z.array(
  z.object({
    key: z.string().min(1).max(255),
    value: z.string().max(10000),
  }),
).max(50);

const ObjectSchema = z.record(z.string().min(1).max(255), z.string().max(10000));

const BatchUpsertSchema = z.object({
  settings: z.union([ArraySchema, ObjectSchema]),
});

function normalizeSettings(
  settings: z.infer<typeof ArraySchema> | z.infer<typeof ObjectSchema>,
): Array<{ key: string; value: string }> {
  if (Array.isArray(settings)) return settings;
  return Object.entries(settings).map(([key, value]) => ({ key, value }));
}

export default async function handler(req: Request, res: Response) {
  try {
    const parsed = BatchUpsertSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const items = normalizeSettings(parsed.data.settings);
    const now = new Date();
    for (const item of items) {
      const [existing] = await db
        .select()
        .from(businessSetting)
        .where(eq(businessSetting.key, item.key))
        .limit(1);

      if (existing) {
        await db
          .update(businessSetting)
          .set({ value: item.value, updatedAt: now })
          .where(eq(businessSetting.key, item.key));
      } else {
        await db.insert(businessSetting).values({
          key: item.key,
          value: item.value,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    const allSettings = await db.select().from(businessSetting);
    const config: Record<string, string | null> = {};
    for (const s of allSettings) {
      if (s.key) config[s.key] = s.value;
    }

    return res.json({ settings: config });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
