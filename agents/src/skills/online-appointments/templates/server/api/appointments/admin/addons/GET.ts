/**
 * GET /api/admin/addons
 *
 * List all add-ons (excluding soft-deleted), optionally filtered by active state.
 *
 * Query parameters:
 * - active: "true" | "false" (optional) - Filter by active status
 *
 * Response:
 * - addons: Array of add-ons
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { getAddons } from "../../services/addons/addon-list.service";

const listAddonsQuerySchema = z.object({
  active: z
    .enum(["true", "false"])
    .transform((val) => val === "true")
    .optional(),
});

export default async function GET(req: Request, res: Response, next: NextFunction) {
  try {
    const query = listAddonsQuerySchema.parse(req.query);
    const addons = await getAddons(query);
    res.status(200).json({ addons });
  } catch (err) {
    if (err && typeof err === "object" && "issues" in err) {
      res.status(400).json({ error: "Validation error", details: err.issues });
      return;
    }
    next(err);
  }
}
