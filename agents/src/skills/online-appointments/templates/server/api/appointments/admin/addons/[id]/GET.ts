/**
 * GET /api/admin/addons/:id
 *
 * Get a single add-on by ID.
 *
 * Response: 200 { addon } | 400 validation | 404 not found
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { getAddon, AddonNotFoundError } from "../../../services/addons/addon-get.service";

const getAddonParamsSchema = z.object({
  id: z.string().min(1, "Add-on ID is required"),
});

export default async function GET(req: Request, res: Response, next: NextFunction) {
  try {
    const params = getAddonParamsSchema.parse(req.params);
    const addon = await getAddon(params.id);
    res.status(200).json({ addon });
  } catch (err) {
    if (err && typeof err === "object" && "issues" in err) {
      res.status(400).json({ error: "Validation error", details: err.issues });
      return;
    }
    if (err instanceof AddonNotFoundError) {
      res.status(404).json({ error: "Add-on not found", message: err.message });
      return;
    }
    next(err);
  }
}
