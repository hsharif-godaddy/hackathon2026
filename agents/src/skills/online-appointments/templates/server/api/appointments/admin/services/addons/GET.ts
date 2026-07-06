/**
 * GET /api/admin/services/:id/addons
 *
 * Get all addons linked to a service.
 *
 * Response: 200 { addons: Array<Addon> } | 400 validation
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { getServiceAddons } from "../../../services/addons/addon-service.service";

const getServiceAddonsParamsSchema = z.object({
  id: z.string().min(1, "Service ID is required"),
});

export default async function GET(req: Request, res: Response, next: NextFunction) {
  try {
    const params = getServiceAddonsParamsSchema.parse(req.params);
    const addons = await getServiceAddons(params.id);
    res.status(200).json({ addons });
  } catch (err) {
    if (err && typeof err === "object" && "issues" in err) {
      res.status(400).json({ error: "Validation error", details: err.issues });
      return;
    }
    next(err);
  }
}
