import type { Request, Response } from "express";
import { getAvailableDatesInRange, getTimezone } from "../../../../services/availability";
import { TZDate } from "@date-fns/tz";

export default async function handler(req: Request, res: Response) {
  try {
    const serviceId = req.params.id as string;
    if (!serviceId) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid service ID" });
    }

    const timezone = await getTimezone();

    let startTime = req.query.start_time as string | undefined;
    let endTime = req.query.end_time as string | undefined;

    // Default: if no params, use today + 30 days in business timezone
    startTime ??= new TZDate(new Date(), timezone).toISOString();
    if (!endTime) {
      const end = new Date();
      end.setDate(end.getDate() + 30);
      endTime = new TZDate(end, timezone).toISOString();
    }

    // Convert ISO datetime to YYYY-MM-DD in business timezone
    function toBusinessDate(value: string): string {
      const d = new TZDate(new Date(value), timezone);
      if (isNaN(d.getTime())) return "";
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }

    const startDate = toBusinessDate(startTime);
    const endDate = toBusinessDate(endTime);

    if (!startDate || !endDate) {
      return res.status(400).json({
        error: "Bad Request",
        message:
          "start_time and end_time must be valid ISO datetime strings (e.g. 2024-06-15T00:00:00Z)",
      });
    }

    const quantity = Math.max(1, parseInt(req.query.quantity as string) || 1);
    const staffIdsParam = req.query.staff_ids as string | undefined;
    const staffIds = staffIdsParam
      ? staffIdsParam.split(",").filter((s) => s.length > 0)
      : undefined;

    const dates = await getAvailableDatesInRange(serviceId, startDate, endDate, quantity, {
      staffIds,
      viewedBy: "merchant",
    });

    return res.json({ available_dates: dates });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
