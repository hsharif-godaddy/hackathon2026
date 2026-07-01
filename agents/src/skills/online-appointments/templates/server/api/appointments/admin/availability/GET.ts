import type { Request, Response } from "express";
import { db } from "../../../../db/client";
import { businessSetting } from "../../../../db/schema";
import { eq } from "drizzle-orm";

const DEFAULT_HOURS = {
  monday: { active: true, timeBlocks: [{ startTime: "09:00", endTime: "17:00" }] },
  tuesday: { active: true, timeBlocks: [{ startTime: "09:00", endTime: "17:00" }] },
  wednesday: { active: true, timeBlocks: [{ startTime: "09:00", endTime: "17:00" }] },
  thursday: { active: true, timeBlocks: [{ startTime: "09:00", endTime: "17:00" }] },
  friday: { active: true, timeBlocks: [{ startTime: "09:00", endTime: "17:00" }] },
  saturday: { active: false, timeBlocks: [] as { startTime: string; endTime: string }[] },
  sunday: { active: false, timeBlocks: [] as { startTime: string; endTime: string }[] },
};

export default async function handler(_req: Request, res: Response) {
  try {
    const [setting] = await db
      .select({ value: businessSetting.value })
      .from(businessSetting)
      .where(eq(businessSetting.key, "business_hours"))
      .limit(1);

    if (!setting?.value) {
      return res.json({ business_hours: DEFAULT_HOURS });
    }

    try {
      const parsed: unknown = JSON.parse(setting.value);
      return res.json({ business_hours: parsed });
    } catch {
      return res.json({ business_hours: DEFAULT_HOURS });
    }
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
