import type { Request, Response } from "express";
import { getAvailableTimeSlotsForDate } from "../../../../services/availability";

export default async function handler(req: Request, res: Response) {
  try {
    const serviceId = req.params.id as string;
    if (!serviceId) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid service ID" });
    }

    const date = req.query.date as string;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        error: "Bad Request",
        message: "date query parameter is required (YYYY-MM-DD)",
      });
    }

    const quantity = Math.max(1, parseInt(req.query.quantity as string) || 1);
    const staffIdsParam = (req.query.staff_ids ?? req.query.resource_ids) as string | undefined;
    const staffIds = staffIdsParam
      ? staffIdsParam.split(",").filter((s) => s.length > 0)
      : undefined;

    const slots = await getAvailableTimeSlotsForDate(serviceId, date, quantity, {
      staffIds,
      viewedBy: "merchant",
    });

    return res.json({ availability_times: slots });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
