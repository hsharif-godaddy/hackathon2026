import type { Request, Response } from "express";
import { db } from "../../../../db/client.js";
import { businessSetting } from "../../../../db/schema.js";

const PUBLIC_KEYS = [
  "timezone",
  "business_name",
  "business_phone",
  "business_email",
  "business_website",
  "business_address",
  "currency",
  "date_format",
  "time_format",
  "booking_page_title",
  "booking_page_description",
  "logo_url",
  "primary_color",
  "c2_enabled",
  "c2_can_reschedule",
  "marketing_consent_enabled",
  "marketing_consent_text",
];

export default async function handler(_req: Request, res: Response) {
  try {
    const settings = await db.select().from(businessSetting);

    const config: Record<string, string | null> = {};
    for (const setting of settings) {
      if (setting.key && PUBLIC_KEYS.includes(setting.key)) {
        config[setting.key] = setting.value;
      }
    }

    return res.json({ config });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
